//! Durable, account-scoped, versioned snapshots of the *entire* Heuresis library.
//! Kept in Documents/Heuresis/Backups/<user-id>, not in Tauri's evictable WebView cache.
//! Nothing here writes to, deletes, or restores the live Supabase database.
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;

const FORMAT: &str = "heuresis-complete-local-v1";
const MEDIA_CHUNK_LIMIT: usize = 512 * 1024;

fn ensure_account(user_id: &str) -> Result<(), String> {
    if user_id.len() != 36 || !user_id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("Invalid backup account ID.".into());
    }
    Ok(())
}

fn ensure_day(day: &str) -> Result<(), String> {
    let b = day.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-'
        || b.iter().enumerate().any(|(i, ch)| i != 4 && i != 7 && !ch.is_ascii_digit())
    {
        return Err("Invalid backup date.".into());
    }
    let month = day[5..7].parse::<u32>().unwrap_or(0);
    let date = day[8..10].parse::<u32>().unwrap_or(0);
    if !(1..=12).contains(&month) || !(1..=31).contains(&date) {
        return Err("Invalid backup date.".into());
    }
    Ok(())
}

fn folder(app: &tauri::AppHandle, user_id: &str) -> Result<PathBuf, String> {
    ensure_account(user_id)?;
    Ok(app.path().document_dir().map_err(|e| format!("Windows Documents folder unavailable: {e}"))?
        .join("Heuresis").join("Backups").join(user_id))
}

fn target(day: &str) -> String { format!("Heuresis-{day}") }
fn staging(day: &str) -> String { format!(".Heuresis-{day}.incomplete") }

fn safe_media_path(user_id: &str, path: &str) -> Result<PathBuf, String> {
    let segments: Vec<&str> = path.split('/').collect();
    if segments.len() < 3 || !matches!(segments[0], "heuresis-card-media" | "page-background-media") || segments[1] != user_id || segments.len() > 9
        || segments.iter().any(|segment| {
            segment.is_empty() || *segment == "." || *segment == ".." || segment.len() > 160
                || !segment.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
    {
        return Err("Unsafe media path in backup.".into());
    }
    Ok(segments.iter().collect())
}

fn is_complete(path: &Path) -> bool {
    if !path.join("snapshot.json").is_file() || !path.join("manifest.json").is_file() {
        return false;
    }
    let Ok(bytes) = fs::read(path.join("manifest.json")) else { return false };
    serde_json::from_slice::<Value>(&bytes).ok()
        .and_then(|v| v.get("complete").and_then(Value::as_bool)).unwrap_or(false)
}

fn complete_days(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut days = entries.flatten().filter_map(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        let day = name.strip_prefix("Heuresis-")?;
        ensure_day(day).ok()?;
        if is_complete(&entry.path()) { Some(day.to_string()) } else { None }
    }).collect::<Vec<_>>();
    days.sort_by(|a, b| b.cmp(a));
    days
}

// Days from the Gregorian civil epoch; week buckets are used only for retention.
fn civil_day(day: &str) -> i64 {
    let mut y = day[0..4].parse::<i64>().unwrap_or(1970);
    let m = day[5..7].parse::<i64>().unwrap_or(1);
    let d = day[8..10].parse::<i64>().unwrap_or(1);
    y -= if m <= 2 { 1 } else { 0 };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn prune_old(dir: &Path) {
    let days = complete_days(dir);
    let mut keep: HashSet<String> = days.iter().take(7).cloned().collect();
    let mut weeks = HashSet::new();
    let mut months = HashSet::new();
    for day in days.iter().skip(7) {
        let week = (civil_day(day) + 3).div_euclid(7);
        if weeks.len() < 4 && weeks.insert(week) { keep.insert(day.clone()); }
        let month = day[..7].to_string();
        if months.len() < 3 && months.insert(month) { keep.insert(day.clone()); }
    }
    for day in days {
        if !keep.contains(&day) {
            // Ignore failures: never turn a successful new backup into an error.
            let _ = fs::remove_dir_all(dir.join(target(&day)));
        }
    }
}

#[tauri::command]
pub fn local_backup_status(app: tauri::AppHandle, user_id: String, day: String) -> Result<Value, String> {
    ensure_day(&day)?;
    let dir = folder(&app, &user_id)?;
    let days = complete_days(&dir);
    Ok(json!({
        "directory": dir.to_string_lossy(),
        "today_exists": days.iter().any(|d| d == &day),
        "latest_day": days.first(),
        "backup_count": days.len(),
    }))
}

#[tauri::command]
pub fn local_backup_begin(app: tauri::AppHandle, user_id: String, day: String, snapshot: Value) -> Result<(), String> {
    ensure_day(&day)?;
    let dir = folder(&app, &user_id)?;
    if snapshot.get("format").and_then(Value::as_str) != Some(FORMAT)
        || snapshot.get("user_id").and_then(Value::as_str) != Some(user_id.as_str())
        || snapshot.get("day").and_then(Value::as_str) != Some(day.as_str())
        || snapshot.get("tables").and_then(Value::as_object).is_none()
        || snapshot.get("media_paths").and_then(Value::as_array).is_none()
    {
        return Err("Incomplete or mismatched backup snapshot.".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if dir.join(target(&day)).exists() {
        return Err("Today's completed backup already exists (or needs manual inspection).".into());
    }
    let stage = dir.join(staging(&day));
    if stage.exists() { fs::remove_dir_all(&stage).map_err(|e| e.to_string())?; }
    fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(stage.join("snapshot.json")).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_backup_media_chunk(app: tauri::AppHandle, user_id: String, day: String, media_path: String, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
    ensure_day(&day)?;
    if bytes.is_empty() || bytes.len() > MEDIA_CHUNK_LIMIT { return Err("Invalid media chunk size.".into()); }
    let relative = safe_media_path(&user_id, &media_path)?;
    let stage = folder(&app, &user_id)?.join(staging(&day));
    if !stage.join("snapshot.json").exists() { return Err("No active backup snapshot.".into()); }
    let path = stage.join("media").join(relative);
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let mut f = OpenOptions::new().write(true).create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    let current_len = f.metadata().map_err(|e| e.to_string())?.len();
    if current_len != offset { return Err("Media chunk offset mismatch; backup is incomplete.".into()); }
    f.write_all(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_backup_finish(app: tauri::AppHandle, user_id: String, day: String) -> Result<String, String> {
    ensure_day(&day)?;
    let dir = folder(&app, &user_id)?;
    let stage = dir.join(staging(&day));
    let snapshot: Value = serde_json::from_slice(&fs::read(stage.join("snapshot.json")).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Backup JSON invalid: {e}"))?;
    if snapshot.get("format").and_then(Value::as_str) != Some(FORMAT)
        || snapshot.get("user_id").and_then(Value::as_str) != Some(user_id.as_str())
        || snapshot.get("day").and_then(Value::as_str) != Some(day.as_str()) {
        return Err("Backup contents do not match this account/date.".into());
    }
    let tables = snapshot.get("tables").and_then(Value::as_object).ok_or("Missing backup tables.")?;
    let mut counts = BTreeMap::new();
    for (name, rows) in tables {
        counts.insert(name.clone(), rows.as_array().ok_or(format!("Invalid table: {name}"))?.len());
    }
    let paths = snapshot.get("media_paths").and_then(Value::as_array).ok_or("Missing media list.")?;
    let mut unique = HashSet::new();
    for item in paths {
        let path = item.as_str().ok_or("Invalid media path.")?;
        if !unique.insert(path) { return Err("Duplicate media path.".into()); }
        let relative = safe_media_path(&user_id, path)?;
        let media = stage.join("media").join(relative);
        if !media.is_file() || media.metadata().map_err(|e| e.to_string())?.len() == 0 {
            return Err(format!("Missing or empty media file: {path}"));
        }
        fs::File::open(&media).map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
    }
    let manifest = json!({
        "format": FORMAT, "complete": true, "user_id": user_id, "day": day,
        "created_at": snapshot.get("created_at"), "tables": counts, "media_count": paths.len(),
    });
    let mut file = fs::File::create(stage.join("manifest.json")).map_err(|e| e.to_string())?;
    file.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    let final_path = dir.join(target(&day));
    fs::rename(&stage, &final_path).map_err(|e| format!("Could not publish completed backup: {e}"))?;
    prune_old(&dir);
    Ok(final_path.to_string_lossy().into_owned())
}
