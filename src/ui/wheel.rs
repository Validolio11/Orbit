//! Paints the radial menu and reports what the pointer is over. Shared by the editor preview and the wheel window.

use super::item_icon::{IconCache, IconSource, paint_item_icon};
use super::theme::{Palette, Weight, font, paint_icon};
use crate::model::{Action, Kind, geometry};
use crate::shared::Foreground;
use egui::epaint::{Mesh, PathShape, PathStroke};
use egui::{Align2, Color32, Pos2, Rect, Stroke, Ui, Vec2};

#[derive(Clone, Copy, PartialEq)]
pub enum Style {
    Preview,
    Overlay,
}

/// Editor drag feedback: the dragged item, the sibling under the pointer, and the center as a "move up" target.
#[derive(Clone, Default)]
pub struct DragView {
    pub source: Option<String>,
    pub target: Option<String>,
    pub center: Option<Option<String>>,
}

pub struct WheelView<'a> {
    pub items: &'a [Action],
    pub title: &'a str,
    pub selected: Option<&'a str>,
    pub back: bool,
    pub add_slot: bool,
    pub add_item: Option<&'a Foreground>,
    pub add_selected: bool,
    pub drag: Option<&'a DragView>,
    pub style: Style,
    /// 0..1 for the opening animation.
    pub appear: f32,
}

/// What lies under a point of the wheel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hit {
    Center,
    Item(usize),
    Add,
    Nothing,
}

pub struct Geometry {
    pub center: Pos2,
    pub scale: f32,
    pub count: usize,
}
impl Geometry {
    pub fn new(rect: Rect, items: usize, add_slot: bool) -> Self {
        let slot = add_slot && items > 0;
        Geometry {
            center: rect.center(),
            scale: rect.width() / 480.0,
            count: items + slot as usize,
        }
    }
    pub fn local(&self, p: Pos2) -> Vec2 {
        (p - self.center) / self.scale
    }
    pub fn at(&self, local: [f32; 2]) -> Pos2 {
        self.center + Vec2::new(local[0], local[1]) * self.scale
    }
    pub fn slot_center(&self, index: usize) -> Pos2 {
        let a = geometry::slot_angle(index, self.count);
        self.center + Vec2::new(a.cos(), a.sin()) * 150.0 * self.scale
    }
    /// The hit test used for clicks and hover. Items are 74×64 buttons around their slot; sectors are the ring.
    pub fn hit(&self, p: Pos2, items: usize, inner: f32, outer: f32) -> Hit {
        let local = self.local(p);
        if local.length() <= 74.4 {
            return Hit::Center;
        }
        match geometry::sector_at(local.x, local.y, self.count, inner, outer) {
            Some(i) if i < items => Hit::Item(i),
            Some(_) => Hit::Add,
            None => Hit::Nothing,
        }
    }
}

pub fn paint(
    ui: &Ui,
    rect: Rect,
    view: &WheelView,
    p: &Palette,
    icons: &IconCache,
    hover: Option<Pos2>,
) -> Geometry {
    let painter = ui.painter_at(rect.expand(40.0));
    let g = Geometry::new(rect, view.items.len(), view.add_slot);
    let s = g.scale;
    let overlay = view.style == Style::Overlay;
    let alpha = view.appear;
    let fade = |c: Color32| c.gamma_multiply(alpha);
    // Dashed guide circle.
    let guide = if overlay {
        p.line_strong.gamma_multiply(0.3)
    } else {
        p.line_strong.gamma_multiply(0.6)
    };
    for i in 0..90 {
        let a0 = i as f32 / 90.0 * std::f32::consts::TAU;
        let a1 = a0 + std::f32::consts::TAU / 90.0 * 0.25;
        painter.line_segment(
            [
                g.at([224.0 * a0.cos(), 224.0 * a0.sin()]),
                g.at([224.0 * a1.cos(), 224.0 * a1.sin()]),
            ],
            Stroke::new(0.7, fade(guide)),
        );
    }
    let hovered = hover.map(|h| g.hit(h, view.items.len(), 92.0, 207.0));
    let drag = view.drag.cloned().unwrap_or_default();
    for index in 0..g.count {
        let is_add = index >= view.items.len();
        let item = view.items.get(index);
        let id = item.map(|i| i.id.as_str());
        let selected = if is_add {
            view.add_selected
        } else {
            view.selected.is_some() && view.selected == id
        };
        let is_target = id.is_some() && drag.target.as_deref() == id;
        let is_source = id.is_some() && drag.source.as_deref() == id;
        let hot = !overlay && hovered == Some(if is_add { Hit::Add } else { Hit::Item(index) });
        let (outer, inner) = geometry::sector_outline(index, g.count, 92.0, 207.0, 6.0, 48);
        let mut fill = if selected || hot { p.active } else { p.panel };
        let mut stroke = if selected {
            if overlay { p.text } else { p.muted }
        } else {
            p.line_strong
        };
        if is_target {
            stroke = p.text;
            fill = p.active;
        }
        if is_source {
            fill = fill.gamma_multiply(0.4);
        }
        let mut mesh = Mesh::default();
        for (o, i) in outer.iter().zip(inner.iter()) {
            let base = mesh.vertices.len() as u32;
            mesh.colored_vertex(g.at(*o), fade(fill));
            mesh.colored_vertex(g.at(*i), fade(fill));
            if base >= 2 {
                mesh.add_triangle(base - 2, base - 1, base);
                mesh.add_triangle(base - 1, base + 1, base);
            }
        }
        painter.add(mesh);
        let outline: Vec<Pos2> = outer
            .iter()
            .map(|q| g.at(*q))
            .chain(inner.iter().rev().map(|q| g.at(*q)))
            .collect();
        let width = if is_target {
            1.5
        } else if overlay {
            1.0
        } else {
            0.8
        };
        painter.add(PathShape::closed_line(
            outline,
            PathStroke::new(width, fade(stroke)),
        ));
        // Icon and label.
        let center = g.slot_center(index);
        let color = if selected || hot { p.text } else { p.muted };
        let color = fade(if is_source {
            color.gamma_multiply(0.4)
        } else {
            color
        });
        let icon_size = 25.0
            * if overlay {
                s.max(0.8)
            } else {
                s.clamp(0.6, 1.0)
            };
        let label_size = if overlay { 11.0 } else { 9.0 } * s.clamp(0.75, 1.2);
        let icon_rect =
            Rect::from_center_size(center - Vec2::new(0.0, 8.0 * s), Vec2::splat(icon_size));
        let label = if is_add {
            view.add_item.map(|f| f.name.as_str()).unwrap_or("Додати")
        } else {
            item.map(|i| i.name.as_str()).unwrap_or("")
        };
        if is_add {
            if let Some(app) = view.add_item {
                paint_item_icon(
                    ui,
                    icon_rect,
                    IconSource {
                        kind: Kind::App,
                        name: &app.name,
                        target: &app.target,
                        icon: "app",
                    },
                    color,
                    p,
                    icons,
                );
                let badge = Rect::from_center_size(
                    icon_rect.right_bottom() - Vec2::splat(2.0),
                    Vec2::splat(14.0),
                );
                painter.circle(badge.center(), 7.0, p.bg, Stroke::new(1.0, p.line_strong));
                paint_icon(ui, badge.shrink(2.0), "plus", color);
            } else {
                paint_icon(
                    ui,
                    Rect::from_center_size(
                        icon_rect.center(),
                        Vec2::splat(22.0 * s.clamp(0.6, 1.2)),
                    ),
                    "plus",
                    color,
                );
            }
        } else if let Some(item) = item {
            paint_item_icon(ui, icon_rect, IconSource::from(item), color, p, icons);
            if item.kind == Kind::Group {
                painter.text(
                    center + Vec2::new(0.0, 27.0 * s),
                    Align2::CENTER_CENTER,
                    "···",
                    font(13.0 * s.clamp(0.7, 1.0), Weight::Regular),
                    fade(p.faint),
                );
            }
        }
        let max_width =
            (geometry::label_width(geometry::slot_angle(index, g.count), g.count).min(84.0) * s)
                .max(30.0);
        let galley = ui.fonts_mut(|f| {
            f.layout(
                label.to_string(),
                font(label_size, Weight::Regular),
                color,
                max_width,
            )
        });
        // Labels are one line; longer names end with an ellipsis like the stylesheet's text-overflow.
        let galley = if galley.rows.len() > 1 {
            ellipsize(ui, label, label_size, color, max_width)
        } else {
            galley
        };
        painter.galley(
            Pos2::new(
                center.x - galley.size().x / 2.0,
                icon_rect.bottom() + 5.0 * s,
            ),
            galley,
            color,
        );
    }
    // Center.
    let radius = 0.155 * rect.width();
    let center_state = drag.center.clone();
    let center_hot = !overlay && hovered == Some(Hit::Center) && view.back;
    let (fill, stroke) = match &center_state {
        Some(None) => (p.active, p.text),
        Some(Some(_)) => (p.subtle, p.line_strong),
        None => (if center_hot { p.subtle } else { p.bg }, p.line_strong),
    };
    painter.circle(g.center, radius, fade(fill), Stroke::new(1.0, fade(stroke)));
    let icon_size = if view.back { 24.0 } else { 30.0 } * s.clamp(0.6, 1.3);
    paint_icon(
        ui,
        Rect::from_center_size(g.center - Vec2::new(0.0, 18.0 * s), Vec2::splat(icon_size)),
        if view.back { "back" } else { "orbit" },
        fade(p.text),
    );
    let title_size = if overlay { 16.0 } else { 14.0 } * s.clamp(0.7, 1.2);
    let title = ellipsize(ui, view.title, title_size, p.text, radius * 1.7);
    painter.galley(
        Pos2::new(g.center.x - title.size().x / 2.0, g.center.y + 4.0 * s),
        title,
        fade(p.text),
    );
    let small = match &center_state {
        Some(Some(error)) => error.clone(),
        Some(None) => "Перемістити на рівень вище".into(),
        None => {
            if view.back {
                "Назад".into()
            } else {
                format!("{} дій", view.items.len())
            }
        }
    };
    painter.text(
        g.center + Vec2::new(0.0, 32.0 * s),
        Align2::CENTER_CENTER,
        small,
        font(
            if overlay { 10.0 } else { 9.0 } * s.clamp(0.7, 1.2),
            Weight::Regular,
        ),
        fade(p.muted),
    );
    if view.items.is_empty() {
        painter.text(
            Pos2::new(g.center.x, rect.top() + rect.height() * 0.8),
            Align2::CENTER_CENTER,
            "Додайте першу дію",
            font(12.0, Weight::Regular),
            fade(p.muted),
        );
    }
    g
}

fn ellipsize(
    ui: &Ui,
    label: &str,
    size: f32,
    color: Color32,
    max_width: f32,
) -> std::sync::Arc<egui::Galley> {
    let mut job = egui::text::LayoutJob::simple_singleline(
        label.to_string(),
        font(size, Weight::Regular),
        color,
    );
    job.wrap = egui::text::TextWrapping {
        max_width,
        max_rows: 1,
        break_anywhere: true,
        overflow_character: Some('…'),
    };
    ui.fonts_mut(|f| f.layout_job(job))
}
