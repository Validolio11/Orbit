//! Geist controls: buttons, icon buttons, switches, segmented controls, selects and setting rows.

use super::theme::{Palette, Weight, font, paint_icon, pal, text};
use egui::{Align2, Color32, CornerRadius, Rect, Response, Sense, Stroke, StrokeKind, Ui, Vec2};

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Secondary,
    Primary,
    Ghost,
    Danger,
}

pub struct Button<'a> {
    label: &'a str,
    icon: Option<&'a str>,
    kind: Kind,
    small: bool,
    enabled: bool,
    icon_size: f32,
}
impl<'a> Button<'a> {
    pub fn new(label: &'a str) -> Self {
        Button {
            label,
            icon: None,
            kind: Kind::Secondary,
            small: false,
            enabled: true,
            icon_size: 15.0,
        }
    }
    pub fn icon(mut self, icon: &'a str, size: f32) -> Self {
        self.icon = Some(icon);
        self.icon_size = size;
        self
    }
    pub fn primary(mut self) -> Self {
        self.kind = Kind::Primary;
        self
    }
    pub fn ghost(mut self) -> Self {
        self.kind = Kind::Ghost;
        self
    }
    pub fn danger(mut self) -> Self {
        self.kind = Kind::Danger;
        self
    }
    pub fn small(mut self) -> Self {
        self.small = true;
        self
    }
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
    pub fn show(self, ui: &mut Ui) -> Response {
        let p = pal(ui.ctx());
        let (height, size, pad) = if self.small {
            (29.0, 11.0, 9.0)
        } else {
            (35.0, 12.0, 12.0)
        };
        let galley =
            ui.painter()
                .layout_no_wrap(self.label.to_string(), font(size, Weight::Medium), p.text);
        let icon_w = self
            .icon
            .map(|_| self.icon_size + if self.label.is_empty() { 0.0 } else { 7.0 })
            .unwrap_or(0.0);
        let width = galley.size().x + icon_w + pad * 2.0;
        let sense = if self.enabled {
            Sense::click()
        } else {
            Sense::hover()
        };
        let (rect, response) = ui.allocate_exact_size(Vec2::new(width, height), sense);
        if ui.is_rect_visible(rect) {
            let hovered = response.hovered() && self.enabled;
            let (mut fill, mut stroke, mut fg) = match self.kind {
                Kind::Primary => (p.primary, p.primary, p.on_primary),
                Kind::Ghost => (Color32::TRANSPARENT, Color32::TRANSPARENT, p.text),
                Kind::Danger => (p.bg, p.line_strong, p.error),
                Kind::Secondary => (p.bg, p.line_strong, p.text),
            };
            if hovered {
                match self.kind {
                    Kind::Primary => fill = fill.gamma_multiply(0.9),
                    _ => {
                        fill = p.hover;
                        if self.kind != Kind::Ghost {
                            stroke = p.faint;
                        }
                    }
                }
            }
            if !self.enabled {
                fg = fg.gamma_multiply(0.4);
                fill = fill.gamma_multiply(if self.kind == Kind::Primary { 0.4 } else { 1.0 });
            }
            let painter = ui.painter();
            painter.rect(rect, 6, fill, Stroke::new(1.0, stroke), StrokeKind::Inside);
            let mut x = rect.left() + pad;
            if let Some(icon) = self.icon {
                paint_icon(
                    ui,
                    Rect::from_min_size(
                        egui::pos2(x, rect.center().y - self.icon_size / 2.0),
                        Vec2::splat(self.icon_size),
                    ),
                    icon,
                    fg,
                );
                x += icon_w;
            }
            painter.text(
                egui::pos2(x, rect.center().y),
                Align2::LEFT_CENTER,
                self.label,
                font(size, Weight::Medium),
                fg,
            );
            if response.has_focus() {
                painter.rect_stroke(
                    rect.expand(3.0),
                    8,
                    Stroke::new(2.0, p.text),
                    StrokeKind::Outside,
                );
            }
        }
        if self.enabled {
            response.on_hover_cursor(egui::CursorIcon::PointingHand)
        } else {
            response
        }
    }
}

/// A square tool button with a line icon (29×29 by default).
pub fn icon_button(
    ui: &mut Ui,
    icon: &str,
    icon_size: f32,
    tooltip: &str,
    danger: bool,
    enabled: bool,
) -> Response {
    icon_button_sized(
        ui,
        icon,
        icon_size,
        Vec2::splat(29.0),
        tooltip,
        danger,
        enabled,
    )
}
pub fn icon_button_sized(
    ui: &mut Ui,
    icon: &str,
    icon_size: f32,
    size: Vec2,
    tooltip: &str,
    danger: bool,
    enabled: bool,
) -> Response {
    let p = pal(ui.ctx());
    let (rect, response) = ui.allocate_exact_size(
        size,
        if enabled {
            Sense::click()
        } else {
            Sense::hover()
        },
    );
    let hovered = response.hovered() && enabled;
    if hovered {
        ui.painter().rect_filled(rect, 5, p.hover);
    }
    let color = if !enabled {
        p.muted.gamma_multiply(0.4)
    } else if hovered {
        if danger { p.error } else { p.text }
    } else {
        p.muted
    };
    paint_icon(
        ui,
        Rect::from_center_size(rect.center(), Vec2::splat(icon_size)),
        icon,
        color,
    );
    let response = if tooltip.is_empty() {
        response
    } else {
        response.on_hover_text(tooltip)
    };
    if enabled {
        response.on_hover_cursor(egui::CursorIcon::PointingHand)
    } else {
        response
    }
}

/// The on/off switch.
pub fn toggle(ui: &mut Ui, on: bool, enabled: bool, label: &str) -> Response {
    let p = pal(ui.ctx());
    let (rect, response) = ui.allocate_exact_size(
        Vec2::new(36.0, 20.0),
        if enabled {
            Sense::click()
        } else {
            Sense::hover()
        },
    );
    let t = ui.ctx().animate_bool_with_time(response.id, on, 0.12);
    let fill = if on { p.primary } else { p.active };
    let alpha = if enabled { 1.0 } else { 0.4 };
    ui.painter().rect(
        rect,
        10,
        fill.gamma_multiply(alpha),
        Stroke::new(
            1.0,
            if on { p.primary } else { p.line_strong }.gamma_multiply(alpha),
        ),
        StrokeKind::Inside,
    );
    let x = egui::lerp(rect.left() + 10.0..=rect.right() - 10.0, t);
    ui.painter().circle_filled(
        egui::pos2(x, rect.center().y),
        7.0,
        if on { p.on_primary } else { p.muted }.gamma_multiply(alpha),
    );
    response.widget_info(|| egui::WidgetInfo::selected(egui::Role::CheckBox, enabled, on, label));
    if enabled {
        response.on_hover_cursor(egui::CursorIcon::PointingHand)
    } else {
        response
    }
}

/// Buttons side by side, one of them active. Returns the clicked index.
pub fn segmented(ui: &mut Ui, options: &[(&str, &str)], active: usize) -> Option<usize> {
    let p = pal(ui.ctx());
    let mut clicked = None;
    let frame = egui::Frame::new()
        .stroke(Stroke::new(1.0, p.line_strong))
        .corner_radius(7)
        .inner_margin(3.0);
    frame.show(ui, |ui| {
        ui.spacing_mut().item_spacing.x = 2.0;
        ui.with_layout(egui::Layout::left_to_right(egui::Align::Center), |ui| {
            for (i, (icon, label)) in options.iter().enumerate() {
                let galley = ui.painter().layout_no_wrap(
                    label.to_string(),
                    font(12.0, Weight::Medium),
                    p.text,
                );
                let (rect, response) = ui.allocate_exact_size(
                    Vec2::new(galley.size().x + 14.0 + 7.0 + 20.0, 29.0),
                    Sense::click(),
                );
                let selected = i == active;
                if selected {
                    ui.painter().rect_filled(rect, 5, p.active);
                } else if response.hovered() {
                    ui.painter().rect_filled(rect, 5, p.hover);
                }
                let color = if selected { p.text } else { p.muted };
                paint_icon(
                    ui,
                    Rect::from_min_size(
                        egui::pos2(rect.left() + 10.0, rect.center().y - 7.0),
                        Vec2::splat(14.0),
                    ),
                    icon,
                    color,
                );
                ui.painter().text(
                    egui::pos2(rect.left() + 31.0, rect.center().y),
                    Align2::LEFT_CENTER,
                    *label,
                    font(12.0, Weight::Medium),
                    color,
                );
                if response
                    .on_hover_cursor(egui::CursorIcon::PointingHand)
                    .clicked()
                {
                    clicked = Some(i);
                }
            }
        });
    });
    clicked
}

/// A dropdown with the Geist control look. Returns the newly chosen index.
pub fn select(
    ui: &mut Ui,
    id: &str,
    options: &[String],
    current: usize,
    width: f32,
) -> Option<usize> {
    let p = pal(ui.ctx());
    let mut chosen = None;
    let label = options.get(current).cloned().unwrap_or_default();
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 35.0), Sense::click());
    let hovered = response.hovered();
    ui.painter().rect(
        rect,
        6,
        if hovered { p.hover } else { p.bg },
        Stroke::new(1.0, if hovered { p.faint } else { p.line_strong }),
        StrokeKind::Inside,
    );
    ui.painter().text(
        egui::pos2(rect.left() + 12.0, rect.center().y),
        Align2::LEFT_CENTER,
        &label,
        font(12.0, Weight::Medium),
        p.text,
    );
    paint_icon(
        ui,
        Rect::from_center_size(
            egui::pos2(rect.right() - 16.0, rect.center().y),
            Vec2::splat(14.0),
        ),
        "down",
        p.muted,
    );
    let response = response.on_hover_cursor(egui::CursorIcon::PointingHand);
    egui::Popup::menu(&response)
        .id(egui::Id::unique(id))
        .width(width)
        .show(|ui| {
            ui.set_min_width(width - 12.0);
            for (i, option) in options.iter().enumerate() {
                let (row, r) =
                    ui.allocate_exact_size(Vec2::new(width - 12.0, 30.0), Sense::click());
                if i == current || r.hovered() {
                    ui.painter()
                        .rect_filled(row, 4, if i == current { p.active } else { p.hover });
                }
                ui.painter().text(
                    egui::pos2(row.left() + 10.0, row.center().y),
                    Align2::LEFT_CENTER,
                    option,
                    font(12.0, Weight::Regular),
                    p.text,
                );
                if r.clicked() {
                    chosen = Some(i);
                    ui.close();
                }
            }
        });
    chosen
}

/// A settings row: title and note on the left, the control on the right, a divider above.
pub fn setting_row(ui: &mut Ui, title: &str, note: &str, control: impl FnOnce(&mut Ui)) {
    let p = pal(ui.ctx());
    let top = ui.cursor().top();
    ui.painter()
        .hline(ui.max_rect().x_range(), top, Stroke::new(1.0, p.line));
    ui.add_space(16.0);
    ui.horizontal(|ui| {
        ui.add_space(20.0);
        let control_width = 280.0;
        let width = (ui.available_width() - control_width - 20.0).max(200.0);
        ui.vertical(|ui| {
            ui.set_width(width);
            ui.label(text(title, 13.0, Weight::Medium, p.text));
            if !note.is_empty() {
                ui.add(egui::Label::new(text(note, 12.0, Weight::Regular, p.muted)).wrap());
            }
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.add_space(20.0);
            control(ui);
        });
    });
    ui.add_space(16.0);
}

/// A bordered section of rounded settings rows.
pub fn section(ui: &mut Ui, p: &Palette, title: Option<(&str, &str)>, body: impl FnOnce(&mut Ui)) {
    egui::Frame::new()
        .stroke(Stroke::new(1.0, p.line))
        .corner_radius(10)
        .fill(p.bg)
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.spacing_mut().item_spacing.y = 0.0;
            if let Some((heading, note)) = title {
                ui.add_space(18.0);
                ui.horizontal(|ui| {
                    ui.add_space(20.0);
                    ui.vertical(|ui| {
                        ui.label(text(heading, 15.0, Weight::Medium, p.text));
                        ui.add_space(4.0);
                        ui.label(text(note, 12.0, Weight::Regular, p.muted));
                    });
                });
                ui.add_space(18.0);
            }
            body(ui);
        });
}

pub fn kbd(ui: &mut Ui, label: &str) {
    let p = pal(ui.ctx());
    egui::Frame::new()
        .stroke(Stroke::new(1.0, p.line_strong))
        .corner_radius(4)
        .inner_margin(egui::Margin::symmetric(5, 2))
        .show(ui, |ui| {
            ui.label(text(label, 11.0, Weight::Mono, p.muted));
        });
}

/// A one-line text field in the Geist control style.
pub fn text_field(ui: &mut Ui, id: &str, value: &mut String, hint: &str, width: f32) -> Response {
    let p = pal(ui.ctx());
    let inner = egui::Frame::new()
        .stroke(Stroke::new(1.0, p.line_strong))
        .corner_radius(6)
        .fill(p.bg)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.add(
                egui::TextEdit::singleline(value)
                    .id(egui::Id::unique(id))
                    .frame(egui::Frame::NONE)
                    .hint_text(text(hint, 13.0, Weight::Regular, p.faint))
                    .font(font(13.0, Weight::Regular))
                    .text_color(p.text)
                    .desired_width(width - 22.0)
                    .char_limit(4096),
            )
        });
    let response = inner.inner;
    if response.has_focus() {
        ui.painter().rect_stroke(
            inner.response.rect,
            6,
            Stroke::new(1.0, p.text),
            StrokeKind::Inside,
        );
    }
    response
}

pub fn corner(r: u8) -> CornerRadius {
    CornerRadius::same(r)
}
