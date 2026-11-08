//! Action icons: the program's own Shell icon when there is one, otherwise a line icon or an Adobe badge.

use super::theme::{Palette, Weight, font, paint_icon};
use crate::model::{Kind, system_icon, validate_packaged_target};
use egui::{Color32, CornerRadius, Rect, TextureHandle, Ui};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

enum Slot {
    Loading,
    Ready(TextureHandle),
    Missing,
}

/// Program icons, loaded by two background workers and shared by both windows.
#[derive(Clone, Default)]
pub struct IconCache {
    inner: Arc<Mutex<(HashMap<String, Slot>, VecDeque<String>, usize)>>,
}

fn shell_path(target: &str) -> Option<String> {
    if target.starts_with("app-id:") {
        return validate_packaged_target(target, "")
            .ok()
            .map(|id| format!("shell:AppsFolder\\{id}"));
    }
    let lower = target.to_ascii_lowercase();
    let local = target.as_bytes().get(1) == Some(&b':')
        && (lower.ends_with(".exe") || lower.ends_with(".lnk"));
    local.then(|| target.to_string())
}

impl IconCache {
    pub fn get(&self, ctx: &egui::Context, target: &str) -> Option<TextureHandle> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match inner.0.get(target) {
            Some(Slot::Ready(texture)) => return Some(texture.clone()),
            Some(_) => return None,
            None => {}
        }
        if shell_path(target).is_none() || inner.0.len() > 400 {
            inner.0.insert(target.to_string(), Slot::Missing);
            return None;
        }
        inner.0.insert(target.to_string(), Slot::Loading);
        inner.1.push_back(target.to_string());
        if inner.2 < 2 {
            inner.2 += 1;
            let (cache, ctx) = (self.clone(), ctx.clone());
            std::thread::spawn(move || cache.work(ctx));
        }
        None
    }

    fn work(&self, ctx: egui::Context) {
        loop {
            let next = {
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                match inner.1.pop_front() {
                    Some(t) => t,
                    None => {
                        inner.2 -= 1;
                        return;
                    }
                }
            };
            let image = shell_path(&next).and_then(|p| crate::platform::os::app_icon(&p));
            let slot = match image {
                Some(icon) => Slot::Ready(ctx.load_texture(
                    format!("app-icon:{next}"),
                    egui::ColorImage::from_rgba_premultiplied(
                        [icon.width, icon.height],
                        &icon.rgba,
                    ),
                    egui::TextureOptions::LINEAR,
                )),
                None => Slot::Missing,
            };
            self.inner
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .0
                .insert(next, slot);
            ctx.request_repaint();
            ctx.request_repaint_of(crate::shared::overlay_id());
        }
    }
}

/// What an icon is drawn from; actions, catalog results and the "+" slot's program all fit.
pub struct IconSource<'a> {
    pub kind: Kind,
    pub name: &'a str,
    pub target: &'a str,
    pub icon: &'a str,
}
impl<'a> From<&'a crate::model::Action> for IconSource<'a> {
    fn from(a: &'a crate::model::Action) -> Self {
        IconSource {
            kind: a.kind,
            name: &a.name,
            target: &a.target,
            icon: &a.icon,
        }
    }
}

pub fn paint_item_icon(
    ui: &Ui,
    rect: Rect,
    source: IconSource,
    color: Color32,
    palette: &Palette,
    icons: &IconCache,
) {
    if source.kind == Kind::App && !source.target.is_empty() {
        if let Some(texture) = icons.get(ui.ctx(), source.target) {
            egui::Image::new(&texture)
                .corner_radius(CornerRadius::same((rect.width() * 0.12) as u8))
                .paint_at(ui, rect);
            return;
        }
    }
    let name = source.name.to_lowercase();
    let adobe = if name.contains("illustrator") {
        Some((
            "Ai",
            Color32::from_rgb(0xff, 0x9a, 0x00),
            Color32::from_rgb(0x30, 0x1b, 0x00),
        ))
    } else if name.contains("after effects") {
        Some((
            "Ae",
            Color32::from_rgb(0xb4, 0xa1, 0xff),
            Color32::from_rgb(0x21, 0x14, 0x4a),
        ))
    } else if name.contains("photoshop") {
        Some((
            "Ps",
            Color32::from_rgb(0x54, 0xb8, 0xff),
            Color32::from_rgb(0x06, 0x1f, 0x39),
        ))
    } else if name == "adobe" {
        Some(("A", palette.text, Color32::TRANSPARENT))
    } else {
        None
    };
    if let Some((label, fg, bg)) = adobe {
        let painter = ui.painter();
        painter.rect_filled(rect, 4, bg);
        let size = if label == "A" {
            rect.height() * 0.9
        } else {
            rect.height() * 0.57
        };
        painter.text(
            rect.center(),
            egui::Align2::CENTER_CENTER,
            label,
            font(
                size,
                if label == "A" {
                    Weight::Regular
                } else {
                    Weight::Semibold
                },
            ),
            fg,
        );
        return;
    }
    let aliases = |i: &str| match i {
        "globe" => Some("browser"),
        "files" => Some("folder"),
        "activity" => Some("tasks"),
        _ => None,
    };
    let browser = source.icon.to_lowercase().contains("browser")
        || ["браузер", "browser", "chrome", "edge", "вебпошук"]
            .iter()
            .any(|w| name.contains(w));
    let guessed = if source.kind == Kind::System {
        system_icon(source.target).unwrap_or("system")
    } else if browser {
        "browser"
    } else {
        source.kind.icon()
    };
    let glyph = if super::icon_paths::exists(source.icon) {
        source.icon
    } else {
        aliases(source.icon).unwrap_or(guessed)
    };
    paint_icon(ui, rect, glyph, color);
}
