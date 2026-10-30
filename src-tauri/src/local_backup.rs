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

const FORMAT: &str = "heuresis-complete-local-v2";
const MEDIA_CHUNK_LIMIT: usize = 512 * 1024;
const REQUIRED_TABLES: &[&str] = &[
    "knowledge_subjects", "knowledge_topics", "knowledge_records",
    "knowledge_practice_events", "knowledge_mistake_modes", "knowledge_entries",
    "heuresis_collections", "heuresis_packs", "heuresis_cards",
    "heuresis_card_types", "heuresis_tags", "heuresis_card_tags",
    "heuresis_study_templates", "heuresis_catalogues", "heuresis_card_relations",
    "heuresis_card_stats", "heuresis_pack_stats", "heuresis_sessions",
    "heuresis_card_events", "heuresis_card_state_changes",
    "capital_reading_items", "capital_reading_quotes", "capital_reading_history",
    "page_backgrounds",
];

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
    if segments.len() < 3 || !matches!(segments[0], "heuresis-card-media" | "page-background-media" | "heuresis-catalogue-media") || segments[1] != user_id || segments.len() > 9
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
        || snapshot.pointer("/offline_recovery/format").and_then(Value::as_str) != Some("heuresis-account-offline-journal-v1")
        || snapshot.pointer("/offline_recovery/entries").and_then(Value::as_array).is_none()
        || snapshot.pointer("/offline_recovery/legacy_unassigned_count").and_then(Value::as_u64).is_none()
    {
        return Err("Incomplete or mismatched backup snapshot.".into());
    }
    // If the database unexpectedly returns nothing, do not create an
    // apparently healthy backup that might later displace the last good one.
    let table_map = snapshot.get("tables").and_then(Value::as_object)
        .ok_or("Snapshot has no tables.")?;
    for name in REQUIRED_TABLES {
        if table_map.get(*name).and_then(Value::as_array).is_none() {
            return Err(format!("Backup missing required table: {name}"));
        }
    }
    let older_days = complete_days(&dir);
    if let Some(latest) = older_days.first() {
        let old_path = dir.join(target(latest)).join("snapshot.json");
        if let Ok(bytes) = fs::read(old_path) {
            if let Ok(previous) = serde_json::from_slice::<Value>(&bytes) {
                for name in ["knowledge_records", "knowledge_subjects", "heuresis_cards", "capital_reading_items", "capital_reading_quotes"] {
                    let earlier = previous.pointer(&format!("/tables/{name}"))
                        .and_then(Value::as_array).map_or(0, Vec::len);
                    let current = table_map.get(name).and_then(Value::as_array)
                        .map_or(0, Vec::len);
                    if earlier > 0 && current == 0 {
                        return Err(format!("Refusing to back up a suddenly empty {name} table; previous backup preserved."));
                    }
                    if earlier >= 20 && current * 2 < earlier {
                        return Err(format!("Suspiciously large loss of {name} rows; previous backups preserved."));
                    }
                }
            }
        }
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
    for name in REQUIRED_TABLES {
        if tables.get(*name).and_then(Value::as_array).is_none() {
            return Err(format!("Missing required backup table: {name}"));
        }
    }
    let mut counts = BTreeMap::new();
    for (name, rows) in tables {
        counts.insert(name.clone(), rows.as_array().ok_or(format!("Invalid table: {name}"))?.len());
    }
    let offline = snapshot.get("offline_recovery").and_then(Value::as_object).ok_or("Missing offline recovery journal.")?;
    if offline.get("format").and_then(Value::as_str) != Some("heuresis-account-offline-journal-v1") {
        return Err("Invalid offline recovery format.".into());
    }
    let pending = offline.get("entries").and_then(Value::as_array).ok_or("Missing offline recovery records.")?;
    let legacy_count = offline.get("legacy_unassigned_count").and_then(Value::as_u64)
        .ok_or("Missing unassigned queue count.")?;
    for item in pending {
        if item.get("id").and_then(Value::as_str).is_none()
            || item.get("url").and_then(Value::as_str).is_none()
            || item.get("method").and_then(Value::as_str).is_none()
        {
            return Err("Invalid offline recovery record.".into());
        }
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
        "pending_offline_writes": pending.len(), "legacy_unassigned_count": legacy_count,
    });
    let mut file = fs::File::create(stage.join("manifest.json")).map_err(|e| e.to_string())?;
    file.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    let final_path = dir.join(target(&day));
    fs::rename(&stage, &final_path).map_err(|e| format!("Could not publish completed backup: {e}"))?;
    prune_old(&dir);
    Ok(final_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_account_dates_and_media_paths() {
        let uid = "11111111-2222-3333-4444-555555555555";
        assert!(ensure_account(uid).is_ok());
        assert!(ensure_account("../outside").is_err());
        assert!(ensure_day("2026-10-21").is_ok());
        assert!(ensure_day("2026/10/21").is_err());
        assert!(safe_media_path(uid, &format!("heuresis-card-media/{uid}/abc/img.png")).is_ok());
        assert!(safe_media_path(uid, &format!("heuresis-card-media/{uid}/../secret")).is_err());
        assert!(safe_media_path(uid, "page-background-media/other/abc.png").is_err());
        assert!(safe_media_path(uid, &format!("heuresis-catalogue-media/{uid}/0f8e-4d.jpg")).is_ok());
        assert!(safe_media_path(uid, "heuresis-catalogue-media/other/abc.png").is_err());
        assert!(safe_media_path(uid, &format!("unknown-bucket/{uid}/abc.png")).is_err());
    }

    #[test]
    fn chronological_day_buckets_are_stable() {
        assert_eq!(civil_day("1970-01-01"), 0);
        assert_eq!(civil_day("2026-10-22") - civil_day("2026-10-21"), 1);
        assert_eq!(civil_day("2026-11-01") - civil_day("2026-10-31"), 1);
    }
}
