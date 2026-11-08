//! Geist design tokens (the same values as the Electron stylesheet), fonts and painting helpers.

use super::icon_paths;
use egui::{
    Color32, FontData, FontDefinitions, FontFamily, FontId, Id, Rect, RichText, Stroke, Ui,
};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palette {
    pub dark: bool,
    pub bg: Color32,
    pub panel: Color32,
    pub subtle: Color32,
    pub hover: Color32,
    pub active: Color32,
    pub line: Color32,
    pub line_strong: Color32,
    pub text: Color32,
    pub muted: Color32,
    pub faint: Color32,
    pub primary: Color32,
    pub on_primary: Color32,
    pub green: Color32,
    pub error: Color32,
}

const fn hex(v: u32) -> Color32 {
    Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
}

pub const DARK: Palette = Palette {
    dark: true,
    bg: hex(0x0a0a0a),
    panel: hex(0x111111),
    subtle: hex(0x151515),
    hover: hex(0x1c1c1c),
    active: hex(0x262626),
    line: hex(0x262626),
    line_strong: hex(0x383838),
    text: hex(0xededed),
    muted: hex(0xa1a1a1),
    faint: hex(0x8a8a8a),
    primary: hex(0xededed),
    on_primary: hex(0x0a0a0a),
    green: hex(0x6cde9b),
    error: hex(0xff8585),
};
pub const LIGHT: Palette = Palette {
    dark: false,
    bg: hex(0xffffff),
    panel: hex(0xfafafa),
    subtle: hex(0xf5f5f5),
    hover: hex(0xeeeeee),
    active: hex(0xe5e5e5),
    line: hex(0xe5e5e5),
    line_strong: hex(0xd1d1d1),
    text: hex(0x171717),
    muted: hex(0x666666),
    faint: hex(0x666666),
    primary: hex(0x171717),
    on_primary: hex(0xffffff),
    green: hex(0x187543),
    error: hex(0xbd2525),
};

pub fn set_palette(ctx: &egui::Context, palette: Palette) {
    ctx.data_mut(|d| d.insert_temp(Id::unique("orbit-palette"), palette));
    let mut visuals = if palette.dark {
        egui::Visuals::dark()
    } else {
        egui::Visuals::light()
    };
    visuals.panel_fill = palette.bg;
    visuals.window_fill = palette.bg;
    visuals.extreme_bg_color = palette.bg;
    visuals.faint_bg_color = palette.subtle;
    visuals.override_text_color = Some(palette.text);
    visuals.selection.bg_fill = palette.text.gamma_multiply(0.25);
    visuals.selection.stroke = Stroke::new(1.0, palette.text);
    visuals.text_edit_bg_color = Some(palette.bg);
    visuals.window_stroke = Stroke::new(1.0, palette.line_strong);
    visuals.window_corner_radius = 12.into();
    visuals.menu_corner_radius = 8.into();
    visuals.popup_shadow = egui::Shadow {
        offset: [0, 12],
        blur: 40,
        spread: 0,
        color: Color32::from_black_alpha(if palette.dark { 100 } else { 35 }),
    };
    for (state, fill) in [
        (&mut visuals.widgets.inactive, palette.bg),
        (&mut visuals.widgets.hovered, palette.hover),
        (&mut visuals.widgets.active, palette.active),
        (&mut visuals.widgets.open, palette.hover),
    ] {
        state.bg_fill = fill;
        state.weak_bg_fill = fill;
        state.corner_radius = 6.into();
        state.bg_stroke = Stroke::new(1.0, palette.line_strong);
        state.fg_stroke = Stroke::new(1.0, palette.text);
        state.expansion = 0.0;
    }
    visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, palette.line);
    visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0, palette.text);
    ctx.set_visuals(visuals);
}
pub fn pal(ctx: &egui::Context) -> Palette {
    ctx.data(|d| d.get_temp(Id::unique("orbit-palette")))
        .unwrap_or(DARK)
}

pub fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let mut add = |name: &str, bytes: &'static [u8]| {
        fonts
            .font_data
            .insert(name.into(), Arc::new(FontData::from_static(bytes)));
    };
    add(
        "geist",
        include_bytes!("../../assets/fonts/Geist-Regular.ttf"),
    );
    add(
        "geist-medium",
        include_bytes!("../../assets/fonts/Geist-Medium.ttf"),
    );
    add(
        "geist-semibold",
        include_bytes!("../../assets/fonts/Geist-SemiBold.ttf"),
    );
    add(
        "geist-mono",
        include_bytes!("../../assets/fonts/GeistMono-Regular.ttf"),
    );
    let fallback: Vec<String> = fonts
        .families
        .get(&FontFamily::Proportional)
        .cloned()
        .unwrap_or_default();
    let family = |first: &str| {
        let mut list = vec![first.to_string()];
        list.extend(fallback.iter().cloned());
        list
    };
    fonts
        .families
        .insert(FontFamily::Proportional, family("geist"));
    fonts
        .families
        .insert(FontFamily::Name("medium".into()), family("geist-medium"));
    fonts.families.insert(
        FontFamily::Name("semibold".into()),
        family("geist-semibold"),
    );
    let mut mono = vec!["geist-mono".to_string()];
    mono.extend(fallback.iter().cloned());
    fonts.families.insert(FontFamily::Monospace, mono);
    ctx.set_fonts(fonts);
    ctx.global_style_mut(|style| {
        style.spacing.item_spacing = egui::vec2(8.0, 8.0);
        style.spacing.button_padding = egui::vec2(12.0, 7.0);
        style.spacing.interact_size.y = 29.0;
        style.interaction.selectable_labels = false;
        style
            .text_styles
            .insert(egui::TextStyle::Body, FontId::proportional(13.0));
        style
            .text_styles
            .insert(egui::TextStyle::Button, FontId::proportional(12.0));
        style
            .text_styles
            .insert(egui::TextStyle::Small, FontId::proportional(11.0));
        style
            .text_styles
            .insert(egui::TextStyle::Monospace, FontId::monospace(11.0));
        style.text_styles.insert(
            egui::TextStyle::Heading,
            FontId::new(27.0, FontFamily::Name("semibold".into())),
        );
    });
}

#[derive(Clone, Copy)]
pub enum Weight {
    Regular,
    Medium,
    Semibold,
    Mono,
}
pub fn font(size: f32, weight: Weight) -> FontId {
    FontId::new(
        size,
        match weight {
            Weight::Regular => FontFamily::Proportional,
            Weight::Medium => FontFamily::Name("medium".into()),
            Weight::Semibold => FontFamily::Name("semibold".into()),
            Weight::Mono => FontFamily::Monospace,
        },
    )
}
pub fn text(s: impl Into<String>, size: f32, weight: Weight, color: Color32) -> RichText {
    RichText::new(s.into())
        .font(font(size, weight))
        .color(color)
}

// ---------- Icons ----------

/// Paints a line icon tinted with `color` into `rect`.
pub fn paint_icon(ui: &Ui, rect: Rect, name: &str, color: Color32) {
    let name = if icon_paths::exists(name) {
        name
    } else {
        "app"
    };
    let uri = format!("bytes://orbit-icon/{name}.svg");
    egui::Image::from_bytes(uri, icon_paths::svg(name).into_bytes())
        .tint(color)
        .paint_at(ui, rect);
}
/// Allocates and paints an icon inline.
pub fn icon(ui: &mut Ui, name: &str, size: f32, color: Color32) -> egui::Response {
    let (rect, response) = ui.allocate_exact_size(egui::vec2(size, size), egui::Sense::hover());
    paint_icon(ui, rect, name, color);
    response
}
