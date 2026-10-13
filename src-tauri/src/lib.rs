#[cfg(desktop)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                fit_to_work_area(&window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Heuresis");
}

#[cfg(desktop)]
fn fit_to_work_area(window: &tauri::WebviewWindow) {
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => m,
        _ => match window.primary_monitor() {
            Ok(Some(m)) => m,
            _ => return,
        },
    };
    let area = monitor.work_area();
    let margin = (12.0 * monitor.scale_factor()).round() as u32;
    let max_w = area.size.width.saturating_sub(margin * 2).max(1);
    let max_h = area.size.height.saturating_sub(margin * 2).max(1);
    let Ok(size) = window.outer_size() else { return };
    if size.width <= max_w && size.height <= max_h { return; }
    let inner = window.inner_size().unwrap_or(size);
    let frame_w = size.width.saturating_sub(inner.width);
    let frame_h = size.height.saturating_sub(inner.height);
    let w = size.width.min(max_w);
    let h = size.height.min(max_h);
    let _ = window.set_size(tauri::PhysicalSize::new(
        w.saturating_sub(frame_w).max(1), h.saturating_sub(frame_h).max(1),
    ));
    let x = area.position.x + (area.size.width.saturating_sub(w) / 2) as i32;
    let y = area.position.y + (area.size.height.saturating_sub(h) / 2) as i32;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}
