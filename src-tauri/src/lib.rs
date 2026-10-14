#[cfg(desktop)]
use tauri::{Emitter, Manager};

/// The quick Notebook capture window stays alive, hidden at launch, so the
/// global shortcut can raise it without constructing another WebView.
#[cfg(desktop)]
fn show_quick_capture_handle(app: &tauri::AppHandle, mode: &str) -> Result<(), String> {
    let window = app.get_webview_window("quick-capture")
        .ok_or_else(|| "Quick Capture has not been initialised.".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    let _ = window.emit("heuresis:quick-open", mode);
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn show_quick_capture(app: tauri::AppHandle, mode: Option<String>) -> Result<(), String> {
    let mode = mode.as_deref().unwrap_or("note");
    if !matches!(mode, "note" | "mistake" | "lesson") {
        return Err("Unsupported quick capture mode.".into());
    }
    show_quick_capture_handle(&app, mode)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![show_quick_capture]);

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

                if let Some(window) = app.get_webview_window("main") {
                    fit_to_work_area(&window);
                }

                // Create exactly one lightweight Notebook Capture webview.
                // This is separate from the existing Study-card Capture popup.
                WebviewWindowBuilder::new(
                    app,
                    "quick-capture",
                    WebviewUrl::App("index.html?quick=1".into()),
                )
                .title("Quick Capture · Heuresis")
                .inner_size(490.0, 348.0)
                .min_inner_size(210.0, 90.0)
                .decorations(false)
                .resizable(true)
                .always_on_top(true)
                .visible(false)
                .center()
                .build()?;

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, shortcut, event| {
                            if event.state() == ShortcutState::Pressed
                                && shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::Space)
                            {
                                let _ = show_quick_capture_handle(app, "note");
                            }
                        })
                        .build(),
                )?;
                let shortcut = Shortcut::new(
                    Some(Modifiers::CONTROL | Modifiers::ALT),
                    Code::Space,
                );
                // Another app may own the shortcut. Do not prevent Heuresis
                // from starting: the visible Capture button remains usable.
                if let Err(err) = app.global_shortcut().register(shortcut) {
                    eprintln!("Heuresis Ctrl+Alt+Space shortcut unavailable: {err}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if window.label() == "quick-capture" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
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
