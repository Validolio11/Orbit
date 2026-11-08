//! Orbit — a mouse-first radial launcher for Windows.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod app;
mod catalog;
mod install;
mod launcher;
mod model;
mod platform;
mod shared;
mod storage;
mod ui;
mod updater;

use platform::{Instance, os};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Installed Adobe programs, so a fresh wheel never starts with broken actions.
fn adobe_actions() -> Vec<model::Action> {
    let find = |product: &str, exe: &str| -> Option<String> {
        for root in ["ProgramFiles", "ProgramFiles(x86)"]
            .iter()
            .filter_map(|k| std::env::var(k).ok())
        {
            let adobe = Path::new(&root).join("Adobe");
            let mut dirs: Vec<PathBuf> = std::fs::read_dir(&adobe)
                .ok()?
                .flatten()
                .filter(|e| e.file_name().to_string_lossy().starts_with(product))
                .map(|e| e.path())
                .collect();
            dirs.sort();
            dirs.reverse();
            for dir in dirs {
                for candidate in [
                    dir.join(exe),
                    dir.join("Support Files").join(exe),
                    dir.join("Support Files")
                        .join("Contents")
                        .join("Windows")
                        .join(exe),
                ] {
                    if candidate.is_file() {
                        return Some(candidate.display().to_string());
                    }
                }
            }
        }
        None
    };
    [
        (
            "illustrator",
            "Illustrator",
            "Adobe Illustrator",
            "Illustrator.exe",
        ),
        (
            "after-effects",
            "After Effects",
            "Adobe After Effects",
            "AfterFX.exe",
        ),
        ("photoshop", "Photoshop", "Adobe Photoshop", "Photoshop.exe"),
    ]
    .into_iter()
    .filter_map(|(id, name, product, exe)| {
        find(product, exe).map(|target| model::Action {
            id: id.into(),
            name: name.into(),
            kind: model::Kind::App,
            target,
            args: String::new(),
            icon: id.into(),
            children: vec![],
        })
    })
    .collect()
}

fn main() -> eframe::Result {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let has = |flag: &str| args.iter().any(|a| a == flag);
    // CI: the executable starts, its bundled assets load and the default settings validate.
    if has("--self-test") {
        let ok = model::default_settings("C:\\Docs", vec![])
            .checked()
            .is_ok()
            && image::load_from_memory(include_bytes!("../assets/orbit-256.png")).is_ok()
            && ui::icon_paths::exists("orbit");
        std::process::exit(if ok { 0 } else { 1 });
    }
    if cfg!(windows) && install::launched_as_setup(&args) {
        if let Err(error) = install::install(
            has("/silent") || has("--silent"),
            !has("/nolaunch") && !has("--nolaunch"),
        ) {
            eprintln!("Orbit: {error}");
            std::process::exit(1);
        }
        return Ok(());
    }
    if has("--uninstall") {
        install::uninstall();
        return Ok(());
    }
    let data = storage::data_dir();
    // Task Scheduler starts the elevated copy; the normal start left its mode (--hidden, --show or --quit) in a file.
    let mut mode = if has("--quit") {
        "--quit"
    } else if has("--hidden") {
        "--hidden"
    } else {
        "--show"
    }
    .to_string();
    if has("--elevated-task") {
        if let Ok(saved) = std::fs::read_to_string(data.join("admin-start-mode")) {
            mode = saved.trim().to_string();
        }
        let _ = std::fs::remove_file(data.join("admin-start-mode"));
    } else if os::admin_hand_over(&mode, &data) {
        return Ok(());
    }
    if let Instance::Forwarded = os::single_instance(mode == "--quit") {
        return Ok(());
    }
    if mode == "--quit" {
        return Ok(());
    }
    if has("--updated") {
        install::refresh_uninstall_entry();
    }
    updater::cleanup(&data.join("updates"));

    let documents = dirs::document_dir()
        .map(|d| d.display().to_string())
        .unwrap_or_default();
    let (settings, loaded) = storage::load(&data.join("settings.json"), || {
        model::default_settings(&documents, adobe_actions())
    });
    let notice = match &loaded {
        storage::Loaded::FromBackup(file) => Some((
            "Налаштування Orbit відновлено з резервної копії.".to_string(),
            format!(
                "Основний файл був пошкоджений, тож останні зміни перед цим могли не зберегтися. Пошкоджений файл збережено як:\n{}",
                file.display()
            ),
        )),
        storage::Loaded::Reset(file) => Some((
            "Не вдалося прочитати налаштування Orbit.".to_string(),
            format!(
                "Меню скинуто до початкових. Попередній файл збережено як:\n{}",
                file.display()
            ),
        )),
        _ => None,
    };
    let first_run = matches!(loaded, storage::Loaded::Fresh);
    let store = storage::Store::new(settings, data.join("settings.json"));
    if first_run {
        let _ = store.save(store.get());
    }
    let repaint: Arc<std::sync::OnceLock<egui::Context>> = Arc::new(std::sync::OnceLock::new());
    let notify: Arc<dyn Fn() + Send + Sync> = {
        let r = repaint.clone();
        Arc::new(move || {
            if let Some(c) = r.get() {
                c.request_repaint();
            }
        })
    };
    let catalog = catalog::Catalog::new(data.join("app-catalog.json"), notify);
    let shared = Arc::new(shared::Shared::new(
        store,
        catalog,
        ui::item_icon::IconCache::default(),
    ));

    let icon = image::load_from_memory(include_bytes!("../assets/orbit-256.png"))
        .ok()
        .map(|i| {
            let i = i.to_rgba8();
            egui::IconData {
                width: i.width(),
                height: i.height(),
                rgba: i.into_raw(),
            }
        });
    let mut viewport = egui::ViewportBuilder::default()
        .with_title(shared::MAIN_TITLE)
        .with_inner_size([1260.0, 860.0])
        .with_min_inner_size([1050.0, 720.0])
        .with_decorations(false)
        .with_visible(mode != "--hidden");
    if let Some(icon) = icon {
        viewport = viewport.with_icon(Arc::new(icon));
    }
    let options = eframe::NativeOptions {
        viewport,
        centered: true,
        ..Default::default()
    };
    let launch = app::Launch { notice, first_run };
    eframe::run_native(
        "Orbit",
        options,
        Box::new(move |cc| {
            let _ = repaint.set(cc.egui_ctx.clone());
            Ok(Box::new(app::App::new(cc, shared, launch)))
        }),
    )
}
