//! Orbit's configuration (the same `settings.json` the Electron version wrote), its validation,
//! and the pure operations the editor and the wheel perform on it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_ITEMS: usize = 12;
pub const MAX_MENUS: usize = 20;
/// Groups can be nested four levels deep.
pub const MAX_GROUP_DEPTH: usize = 4;
pub const DEFAULT_WHEEL_SIZE: u32 = 520;
pub const MIN_WHEEL_SIZE: u32 = 312;
pub const MAX_WHEEL_SIZE: u32 = 780;
pub const HOVER_DELAYS: [u32; 8] = [150, 250, 350, 500, 750, 1000, 1500, 2000];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Activation {
    Release,
    Hover,
    Click,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupOpen {
    Hover,
    Click,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    App,
    Folder,
    Script,
    System,
    Group,
}

impl Kind {
    pub const ALL: [Kind; 5] = [
        Kind::App,
        Kind::Folder,
        Kind::Script,
        Kind::System,
        Kind::Group,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Kind::App => "Застосунок",
            Kind::Folder => "Папка",
            Kind::Script => "Скрипт",
            Kind::System => "Windows",
            Kind::Group => "Група",
        }
    }
    pub fn icon(self) -> &'static str {
        match self {
            Kind::App => "app",
            Kind::Folder => "folder",
            Kind::Script => "script",
            Kind::System => "system",
            Kind::Group => "group",
        }
    }
}

impl Activation {
    pub const ALL: [Activation; 3] = [Activation::Release, Activation::Hover, Activation::Click];
    pub fn label(self) -> &'static str {
        match self {
            Activation::Release => "Відпускання кнопки",
            Activation::Hover => "Наведення курсора",
            Activation::Click => "Клацання мишею",
        }
    }
}
impl GroupOpen {
    pub const ALL: [GroupOpen; 2] = [GroupOpen::Hover, GroupOpen::Click];
    pub fn label(self) -> &'static str {
        match self {
            GroupOpen::Hover => "Наведення курсора",
            GroupOpen::Click => "Клацання мишею",
        }
    }
}

/// Windows commands in the order the action dialog shows them: (id, name, icon).
pub const SYSTEM_ACTIONS: [(&str, &str, &str); 25] = [
    ("explorer", "Провідник", "folder"),
    ("task-manager", "Диспетчер завдань", "tasks"),
    ("settings", "Параметри Windows", "settings"),
    ("control-panel", "Панель керування", "sliders"),
    ("recycle-bin", "Кошик", "trash"),
    ("search", "Пошук Windows", "search"),
    ("run", "Виконати", "run"),
    ("task-view", "Усі вікна", "windows"),
    ("desktop", "Показати робочий стіл", "desktop"),
    ("lock", "Заблокувати комп’ютер", "lock"),
    ("screenshot", "Знімок екрана", "screenshot"),
    ("clipboard", "Буфер обміну", "clipboard"),
    ("emoji", "Емодзі", "emoji"),
    ("dictation", "Голосове введення", "mic"),
    ("notifications", "Сповіщення", "bell"),
    ("mute", "Вимкнути / увімкнути звук", "volumeMute"),
    ("volume-down", "Зменшити гучність", "volumeDown"),
    ("volume-up", "Збільшити гучність", "volumeUp"),
    ("sound-settings", "Налаштування звуку", "volume"),
    ("bluetooth", "Bluetooth", "bluetooth"),
    ("media-prev", "Попередній трек", "trackPrev"),
    ("media-play", "Відтворення / пауза", "playPause"),
    ("media-next", "Наступний трек", "trackNext"),
    ("calculator", "Калькулятор", "calculator"),
    ("notepad", "Блокнот", "notepad"),
];
pub fn system_name(id: &str) -> Option<&'static str> {
    SYSTEM_ACTIONS.iter().find(|a| a.0 == id).map(|a| a.1)
}
pub fn system_icon(id: &str) -> Option<&'static str> {
    SYSTEM_ACTIONS.iter().find(|a| a.0 == id).map(|a| a.2)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub children: Vec<Action>,
}

impl Action {
    pub fn new(kind: Kind, name: impl Into<String>, target: impl Into<String>) -> Self {
        Action {
            id: new_id(),
            name: name.into(),
            kind,
            target: target.into(),
            args: String::new(),
            icon: String::new(),
            children: Vec::new(),
        }
    }
    pub fn is_group(&self) -> bool {
        self.kind == Kind::Group
    }
    /// Depth of nested groups below and including this item (0 for a plain action).
    pub fn group_height(&self) -> usize {
        if self.is_group() {
            1 + self
                .children
                .iter()
                .map(Action::group_height)
                .max()
                .unwrap_or(0)
        } else {
            0
        }
    }
    pub fn description(&self) -> String {
        match self.kind {
            Kind::Group => format!(
                "{} {} у вкладеному меню",
                self.children.len(),
                if self.children.len() == 1 {
                    "дія"
                } else {
                    "дій"
                }
            ),
            Kind::System => system_name(&self.target)
                .unwrap_or("Системна команда")
                .to_string(),
            _ if self.target.is_empty() => "Виберіть шлях до застосунку".into(),
            _ => self.target.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Menu {
    pub id: String,
    pub name: String,
    #[serde(default = "orbit_icon")]
    pub icon: String,
    pub items: Vec<Action>,
}
fn orbit_icon() -> String {
    "orbit".into()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub theme: Theme,
    pub trigger_button: u8,
    pub activation_mode: Activation,
    pub group_open_mode: GroupOpen,
    pub hover_delay: u32,
    pub enabled: bool,
    pub reduced_motion: bool,
    pub close_on_outside_click: bool,
    pub launch_at_login: bool,
    pub wheel_add_slot: bool,
    pub intro_pending: bool,
    pub wheel_size: u32,
    pub menus: Vec<Menu>,
    pub active_menu_id: String,
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn actions_word(count: usize) -> &'static str {
    if count % 10 == 1 && count % 100 != 11 {
        "дію"
    } else if [2, 3, 4].contains(&(count % 10)) && ![12, 13, 14].contains(&(count % 100)) {
        "дії"
    } else {
        "дій"
    }
}

// ---------- Validation ----------

fn text(
    value: Option<&Value>,
    name: &str,
    maximum: usize,
    required: bool,
) -> Result<String, String> {
    match value {
        None | Some(Value::Null) if !required => Ok(String::new()),
        Some(Value::String(s)) if s.chars().count() <= maximum && !s.contains('\0') => {
            Ok(s.clone())
        }
        _ => Err(format!("Неправильне значення: {name}.")),
    }
}

/// Store apps are launched through their catalog id: `app-id:<family>!<app>`.
pub fn validate_packaged_target(target: &str, args: &str) -> Result<String, String> {
    let error = || "Неправильний ідентифікатор застосунку Windows.".to_string();
    let id = target.strip_prefix("app-id:").ok_or_else(error)?;
    let part = |p: &str| {
        !p.is_empty()
            && p.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    };
    let mut parts = id.split('!');
    let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(error());
    };
    if id.len() > 128 || !part(a) || !part(b) {
        return Err(error());
    }
    if !args.trim().is_empty() {
        return Err("Застосунки Windows з каталогу не підтримують додаткові аргументи.".into());
    }
    Ok(id.to_string())
}

fn validate_action(
    value: &Value,
    depth: usize,
    ids: &mut std::collections::HashSet<String>,
) -> Result<Action, String> {
    let object = value.as_object().ok_or("Неправильна дія.")?;
    if depth > MAX_GROUP_DEPTH {
        return Err("Групи можуть мати не більше чотирьох вкладених рівнів.".into());
    }
    let id = text(object.get("id"), "ідентифікатор дії", 100, true)?;
    if id.is_empty() || !ids.insert(id.clone()) {
        return Err("Ідентифікатори дій мають бути унікальними й непорожніми.".into());
    }
    let kind: Kind = serde_json::from_value(object.get("kind").cloned().unwrap_or(Value::Null))
        .map_err(|_| "Непідтримуваний тип дії.")?;
    let name = text(object.get("name"), "назва дії", 100, true)?
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("Дії потрібна назва.".into());
    }
    let target = text(object.get("target"), "шлях", 4096, false)?;
    let args = text(object.get("args"), "аргументи", 4096, false)?;
    let icon = text(object.get("icon"), "значок", 100, false)?;
    if target.to_ascii_lowercase().starts_with("app-id:") {
        if kind != Kind::App {
            return Err(
                "Ідентифікатор застосунку Windows можна використовувати лише для застосунків."
                    .into(),
            );
        }
        validate_packaged_target(&target, &args)?;
    }
    if kind == Kind::System && system_name(&target).is_none() {
        return Err("Непідтримувана дія Windows.".into());
    }
    let mut children = Vec::new();
    if kind == Kind::Group {
        let list = object
            .get("children")
            .and_then(Value::as_array)
            .ok_or("Група може містити до 12 дій.")?;
        if list.len() > MAX_ITEMS {
            return Err("Група може містити до 12 дій.".into());
        }
        for child in list {
            children.push(validate_action(child, depth + 1, ids)?);
        }
    }
    Ok(Action {
        id,
        name,
        kind,
        target,
        args,
        icon,
        children,
    })
}

/// Checks a configuration from disk, an import or the editor, filling in defaults for optional fields.
pub fn validate(value: &Value) -> Result<Settings, String> {
    let object = value
        .as_object()
        .ok_or("Неправильна або завелика конфігурація.")?;
    if value.to_string().len() > 1024 * 1024 {
        return Err("Неправильна або завелика конфігурація.".into());
    }
    if object.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("Непідтримувана версія конфігурації.".into());
    }
    let enumeration =
        |key: &str, error: &str| object.get(key).cloned().ok_or_else(|| error.to_string());
    let theme: Theme = serde_json::from_value(enumeration("theme", "Неправильна тема.")?)
        .map_err(|_| "Неправильна тема.")?;
    let trigger_button = match object.get("triggerButton").and_then(Value::as_u64) {
        Some(4) => 4,
        Some(5) => 5,
        _ => return Err("Виберіть кнопку миші 4 або 5.".into()),
    };
    let activation_mode: Activation = serde_json::from_value(enumeration(
        "activationMode",
        "Неправильний спосіб запуску.",
    )?)
    .map_err(|_| "Неправильний спосіб запуску.")?;
    let group_open_mode = match object.get("groupOpenMode") {
        None => GroupOpen::Hover,
        Some(v) => {
            serde_json::from_value(v.clone()).map_err(|_| "Неправильний спосіб відкриття груп.")?
        }
    };
    let hover_delay = object
        .get("hoverDelay")
        .and_then(Value::as_u64)
        .filter(|d| (150..=2000).contains(d))
        .ok_or("Затримка наведення має бути від 150 до 2000 мс.")? as u32;
    let flag = |key: &str, default: Option<bool>| -> Result<bool, String> {
        match (object.get(key), default) {
            (Some(Value::Bool(b)), _) => Ok(*b),
            (None, Some(d)) => Ok(d),
            _ => Err("Неправильні значення налаштувань.".into()),
        }
    };
    let wheel_size = match object.get("wheelSize") {
        None => DEFAULT_WHEEL_SIZE,
        Some(v) => {
            v.as_u64()
                .filter(|s| (MIN_WHEEL_SIZE as u64..=MAX_WHEEL_SIZE as u64).contains(s))
                .ok_or("Розмір колеса має бути цілим числом від 312 до 780.")? as u32
        }
    };
    let list = object
        .get("menus")
        .and_then(Value::as_array)
        .filter(|m| !m.is_empty() && m.len() <= MAX_MENUS)
        .ok_or("Створіть від 1 до 20 меню.")?;
    let mut ids = std::collections::HashSet::new();
    let mut menus = Vec::new();
    for menu in list {
        let m = menu.as_object().ok_or("Неправильне меню.")?;
        let id = text(m.get("id"), "ідентифікатор меню", 100, true)?;
        if id.is_empty() || !ids.insert(id.clone()) {
            return Err("Ідентифікатори меню мають бути унікальними.".into());
        }
        let items = m
            .get("items")
            .and_then(Value::as_array)
            .filter(|i| i.len() <= MAX_ITEMS)
            .ok_or("Кожне колесо може мати до 12 дій.")?;
        let name = text(m.get("name"), "назва меню", 100, true)?
            .trim()
            .to_string();
        if name.is_empty() {
            return Err("Меню потрібна назва.".into());
        }
        let icon = match m.get("icon") {
            None => "orbit".into(),
            v => text(v, "значок меню", 100, true)?,
        };
        let items = items
            .iter()
            .map(|item| validate_action(item, 0, &mut ids))
            .collect::<Result<Vec<_>, _>>()?;
        menus.push(Menu {
            id,
            name,
            icon,
            items,
        });
    }
    let active_menu_id = text(object.get("activeMenuId"), "активне меню", 100, true)?;
    if !menus.iter().any(|m| m.id == active_menu_id) {
        return Err("Активного меню не існує.".into());
    }
    Ok(Settings {
        version: 1,
        theme,
        trigger_button,
        activation_mode,
        group_open_mode,
        hover_delay,
        enabled: flag("enabled", None)?,
        reduced_motion: flag("reducedMotion", None)?,
        close_on_outside_click: flag("closeOnOutsideClick", Some(true))?,
        launch_at_login: flag("launchAtLogin", Some(true))?,
        wheel_add_slot: flag("wheelAddSlot", Some(true))?,
        intro_pending: flag("introPending", Some(false))?,
        wheel_size,
        menus,
        active_menu_id,
    })
}

impl Settings {
    /// Re-validates after an edit; the editor never saves anything the loader would reject.
    pub fn checked(self) -> Result<Settings, String> {
        validate(&serde_json::to_value(&self).map_err(|e| e.to_string())?)
    }

    pub fn active_menu_index(&self) -> usize {
        self.menus
            .iter()
            .position(|m| m.id == self.active_menu_id)
            .unwrap_or(0)
    }
    pub fn current_menu(&self) -> &Menu {
        &self.menus[self.active_menu_index()]
    }

    /// Drops group ids that no longer exist, so the path always points at a real group.
    pub fn trim_group_path(&self, path: &[String]) -> Vec<String> {
        let mut items = &self.current_menu().items;
        let mut next = Vec::new();
        for id in path {
            match items.iter().find(|i| &i.id == id && i.is_group()) {
                Some(g) => {
                    next.push(id.clone());
                    items = &g.children;
                }
                None => break,
            }
        }
        next
    }
    /// Items of the group a (trimmed) path points at, with that level's title.
    pub fn level(&self, path: &[String]) -> (&Vec<Action>, &str) {
        let menu = self.current_menu();
        let (mut items, mut name) = (&menu.items, menu.name.as_str());
        for id in path {
            match items.iter().find(|i| &i.id == id && i.is_group()) {
                Some(g) => {
                    items = &g.children;
                    name = &g.name;
                }
                None => break,
            }
        }
        (items, name)
    }
    pub fn level_mut(&mut self, path: &[String]) -> &mut Vec<Action> {
        let index = self.active_menu_index();
        let mut items = &mut self.menus[index].items;
        for id in path {
            let Some(position) = items.iter().position(|i| &i.id == id && i.is_group()) else {
                break;
            };
            items = &mut items[position].children;
        }
        items
    }

    pub fn find(&self, id: &str) -> Option<Location> {
        fn walk(
            items: &[Action],
            id: &str,
            indices: &mut Vec<usize>,
            groups: &mut Vec<String>,
        ) -> bool {
            for (i, item) in items.iter().enumerate() {
                indices.push(i);
                if item.id == id {
                    return true;
                }
                if item.is_group() {
                    groups.push(item.id.clone());
                    if walk(&item.children, id, indices, groups) {
                        return true;
                    }
                    groups.pop();
                }
                indices.pop();
            }
            false
        }
        for (menu, m) in self.menus.iter().enumerate() {
            let (mut indices, mut groups) = (Vec::new(), Vec::new());
            if walk(&m.items, id, &mut indices, &mut groups) {
                return Some(Location {
                    menu,
                    indices,
                    groups,
                });
            }
        }
        None
    }
    pub fn get(&self, location: &Location) -> &Action {
        let mut item = &self.menus[location.menu].items[location.indices[0]];
        for &i in &location.indices[1..] {
            item = &item.children[i];
        }
        item
    }
    pub fn action(&self, id: &str) -> Option<&Action> {
        self.find(id).map(|l| self.get(&l))
    }
    /// The list that holds the located item.
    pub fn siblings_mut(&mut self, location: &Location) -> &mut Vec<Action> {
        let mut items = &mut self.menus[location.menu].items;
        for &i in &location.indices[..location.indices.len() - 1] {
            items = &mut items[i].children;
        }
        items
    }
    pub fn siblings(&self, location: &Location) -> &Vec<Action> {
        let mut items = &self.menus[location.menu].items;
        for &i in &location.indices[..location.indices.len() - 1] {
            items = &items[i].children;
        }
        items
    }

    /// Every action of every menu with its menu and group names, for the library page.
    pub fn flatten(&self) -> Vec<(&Action, &Menu, Vec<&str>)> {
        fn walk<'a>(
            items: &'a [Action],
            menu: &'a Menu,
            path: Vec<&'a str>,
            out: &mut Vec<(&'a Action, &'a Menu, Vec<&'a str>)>,
        ) {
            for item in items {
                out.push((item, menu, path.clone()));
                if item.is_group() {
                    let mut next = path.clone();
                    next.push(&item.name);
                    walk(&item.children, menu, next, out);
                }
            }
        }
        let mut out = Vec::new();
        for menu in &self.menus {
            walk(&menu.items, menu, Vec::new(), &mut out);
        }
        out
    }
}

/// Where an action sits: its menu, the index at every level, and the ids of the groups above it.
#[derive(Clone, Debug, PartialEq)]
pub struct Location {
    pub menu: usize,
    pub indices: Vec<usize>,
    pub groups: Vec<String>,
}
impl Location {
    pub fn depth(&self) -> usize {
        self.indices.len() - 1
    }
    pub fn index(&self) -> usize {
        *self.indices.last().unwrap()
    }
}

// ---------- Moving actions (drag and drop, outward buttons) ----------

/// Why an action cannot be dropped on a group, or None when it can.
pub fn move_error(state: &Settings, source_id: &str, group_id: &str) -> Option<&'static str> {
    let Some(source) = state.find(source_id) else {
        return Some("Дію для переміщення не знайдено.");
    };
    let Some(target) = state.find(group_id) else {
        return Some("Групу призначення не знайдено.");
    };
    let (source_item, target_item) = (state.get(&source), state.get(&target));
    if !target_item.is_group() {
        return Some("Перемістити дію можна лише в групу.");
    }
    if source_id == group_id {
        return Some("Групу не можна перемістити в саму себе.");
    }
    fn contains(item: &Action, id: &str) -> bool {
        item.id == id || item.is_group() && item.children.iter().any(|c| contains(c, id))
    }
    if contains(source_item, group_id) {
        return Some("Групу не можна перемістити у власну вкладену групу.");
    }
    if source.groups.last().map(String::as_str) == Some(group_id) {
        return None;
    }
    if target_item.children.len() >= MAX_ITEMS {
        return Some("У цій групі вже 12 дій. Спочатку звільніть місце.");
    }
    let subtree = if source_item.is_group() && !source_item.children.is_empty() {
        source_item.group_height()
    } else {
        0
    };
    if target.depth() + 1 + subtree > MAX_GROUP_DEPTH {
        return Some("Переміщення перевищить обмеження у чотири вкладені рівні.");
    }
    None
}

fn take(state: &mut Settings, location: &Location) -> Action {
    state.siblings_mut(location).remove(location.index())
}

pub fn move_to_group(
    state: &Settings,
    source_id: &str,
    group_id: &str,
) -> Result<Settings, String> {
    if let Some(error) = move_error(state, source_id, group_id) {
        return Err(error.into());
    }
    let mut next = state.clone();
    let source = next.find(source_id).unwrap();
    if source.groups.last().map(String::as_str) == Some(group_id) {
        return Ok(next);
    }
    let item = take(&mut next, &source);
    let target = next.find(group_id).unwrap();
    let mut items = &mut next.menus[target.menu].items;
    for &i in &target.indices[..target.indices.len() - 1] {
        items = &mut items[i].children;
    }
    items[target.index()].children.push(item);
    Ok(next)
}

pub fn move_to_root(state: &Settings, source_id: &str) -> Result<Settings, String> {
    let source = state
        .find(source_id)
        .ok_or("Дію для переміщення не знайдено.")?;
    if source.depth() > 0 && state.menus[source.menu].items.len() >= MAX_ITEMS {
        return Err(
            "У головному меню вже 12 дій. Спочатку видаліть зайву дію або перемістіть її в групу."
                .into(),
        );
    }
    let mut next = state.clone();
    if source.depth() == 0 {
        return Ok(next);
    }
    let item = take(&mut next, &source);
    next.menus[source.menu].items.push(item);
    Ok(next)
}

pub fn reorder(state: &Settings, source_id: &str, target_id: &str) -> Result<Settings, String> {
    let source = state
        .find(source_id)
        .ok_or("Дію для переміщення не знайдено.")?;
    let target = state
        .find(target_id)
        .ok_or("Дію призначення не знайдено.")?;
    if source.menu != target.menu
        || source.indices[..source.depth()] != target.indices[..target.depth()]
        || source.depth() != target.depth()
    {
        return Err("Змінити порядок можна лише між діями одного рівня меню.".into());
    }
    let mut next = state.clone();
    let items = next.siblings_mut(&source);
    let item = items.remove(source.index());
    items.insert(target.index(), item);
    Ok(next)
}

pub fn move_to_parent(state: &Settings, source_id: &str) -> Result<Settings, String> {
    let source = state
        .find(source_id)
        .ok_or("Дію для переміщення не знайдено.")?;
    if source.depth() == 0 {
        return Ok(state.clone());
    }
    let mut parent = source.clone();
    parent.indices.pop();
    if state.siblings(&parent).len() >= MAX_ITEMS {
        return Err("На рівні вище вже 12 дій. Спочатку звільніть місце в цьому меню.".into());
    }
    let mut next = state.clone();
    let item = take(&mut next, &source);
    next.siblings_mut(&parent).push(item);
    Ok(next)
}

/// Swaps an action with the one above it.
pub fn move_up(state: &Settings, id: &str) -> Option<Settings> {
    let location = state.find(id)?;
    if location.index() == 0 {
        return None;
    }
    let mut next = state.clone();
    next.siblings_mut(&location)
        .swap(location.index(), location.index() - 1);
    Some(next)
}

pub fn remove(state: &Settings, id: &str) -> Settings {
    let mut next = state.clone();
    if let Some(location) = next.find(id) {
        take(&mut next, &location);
    }
    next
}

/// Gives every action of a copied menu a new id.
pub fn renew_ids(items: &mut [Action]) {
    for item in items {
        item.id = new_id();
        renew_ids(&mut item.children);
    }
}

// ---------- Launch helpers ----------

/// Splits an argument string the way Windows programs read their command line.
pub fn parse_arguments(value: &str) -> Result<Vec<String>, String> {
    let chars: Vec<char> = value.chars().collect();
    let (mut args, mut current, mut quoted, mut started) =
        (Vec::new(), String::new(), false, false);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' {
            let mut slashes = 1;
            while chars.get(i + 1) == Some(&'\\') {
                slashes += 1;
                i += 1;
            }
            if chars.get(i + 1) == Some(&'"') {
                current.push_str(&"\\".repeat(slashes / 2));
                if slashes % 2 == 1 {
                    current.push('"');
                } else {
                    quoted = !quoted;
                }
                i += 1;
            } else {
                current.push_str(&"\\".repeat(slashes));
            }
            started = true;
        } else if c == '"' {
            if quoted && chars.get(i + 1) == Some(&'"') {
                current.push('"');
                i += 1;
            } else {
                quoted = !quoted;
            }
            started = true;
        } else if c.is_whitespace() && !quoted {
            if started {
                args.push(std::mem::take(&mut current));
                started = false;
            }
        } else {
            current.push(c);
            started = true;
        }
        i += 1;
    }
    if quoted {
        return Err("Закрийте лапки в аргументах.".into());
    }
    if started {
        args.push(current);
    }
    Ok(args)
}

pub fn base_name(path: &str) -> String {
    let trimmed = path.trim_end_matches(['\\', '/']);
    trimmed
        .rsplit(['\\', '/'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}
pub fn extension(path: &str) -> String {
    let base = base_name(path);
    base.rfind('.')
        .filter(|&i| i > 0)
        .map(|i| base[i..].to_ascii_lowercase())
        .unwrap_or_default()
}
/// The folder name in the wheel comes from the folder itself unless the user types another one.
pub fn folder_name(target: &str) -> String {
    base_name(target)
}
/// A file's wheel name is its name without the extension.
pub fn file_stem(target: &str) -> String {
    let base = base_name(target);
    match base.rfind('.') {
        Some(i) if i > 0 => base[..i].to_string(),
        _ => base,
    }
}

pub const SCRIPT_EXTENSIONS: [&str; 4] = [".ps1", ".py", ".js", ".cjs"];

/// Turns a path dragged in from Explorer into an action, or None when Orbit cannot launch it.
pub fn dropped_action(path: &str, is_directory: bool) -> Option<Action> {
    if is_directory {
        let mut a = Action::new(Kind::Folder, folder_name(path), path);
        a.icon = "folder".into();
        return Some(a);
    }
    let ext = extension(path);
    let kind = if [".exe", ".lnk"].contains(&ext.as_str()) {
        Kind::App
    } else if SCRIPT_EXTENSIONS.contains(&ext.as_str()) {
        Kind::Script
    } else {
        return None;
    };
    let mut action = Action::new(kind, file_stem(path), path);
    if kind == Kind::App {
        action.icon = "app".into();
    }
    Some(action)
}

const SHELL_PROCESSES: [&str; 10] = [
    "explorer.exe",
    "applicationframehost.exe",
    "searchhost.exe",
    "searchapp.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "textinputhost.exe",
    "lockapp.exe",
    "systemsettings.exe",
    "orbit.exe",
];
/// The Windows shell and Orbit itself are never offered as "add the program you are in".
pub fn foreground_candidate(exe: &str, own_exe: &str) -> bool {
    let bytes = exe.as_bytes();
    let drive =
        bytes.len() > 7 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    if !drive || !exe.to_ascii_lowercase().ends_with(".exe") || exe.len() > 1024 {
        return false;
    }
    if exe.eq_ignore_ascii_case(own_exe) {
        return false;
    }
    !SHELL_PROCESSES.contains(&base_name(exe).to_ascii_lowercase().as_str())
}

// ---------- Wheel geometry (480×480 design units) ----------

pub mod geometry {
    use std::f32::consts::PI;
    /// Index of the sector under a point relative to the center, or None in the hub or outside the ring.
    pub fn sector_at(x: f32, y: f32, count: usize, inner: f32, outer: f32) -> Option<usize> {
        let radius = x.hypot(y);
        if count == 0 || radius < inner || radius > outer {
            return None;
        }
        let step = 360.0 / count as f32;
        let angle = ((y.atan2(x).to_degrees()) + 90.0 + step / 2.0 + 360.0) % 360.0;
        Some((angle / step).floor() as usize % count)
    }
    /// Angle (radians) of the middle of a sector; sector 0 is at the top.
    pub fn slot_angle(index: usize, count: usize) -> f32 {
        (-90.0 + index as f32 * 360.0 / count as f32).to_radians()
    }
    /// Outline of a sector with parallel gutters of `gap` units at both arcs, as points around the origin.
    pub fn sector_outline(
        index: usize,
        count: usize,
        inner: f32,
        outer: f32,
        gap: f32,
        segments: usize,
    ) -> (Vec<[f32; 2]>, Vec<[f32; 2]>) {
        let step = 2.0 * PI / count as f32;
        let a = -PI / 2.0 + index as f32 * step - step / 2.0;
        let b = a + step;
        let (io, oo) = ((gap / (2.0 * inner)).asin(), (gap / (2.0 * outer)).asin());
        let arc = |r: f32, from: f32, to: f32| {
            (0..=segments)
                .map(|i| {
                    let t = from + (to - from) * i as f32 / segments as f32;
                    [r * t.cos(), r * t.sin()]
                })
                .collect::<Vec<_>>()
        };
        (arc(outer, a + oo, b - oo), arc(inner, a + io, b - io))
    }
    /// Widest label whose corners stay inside the sector, clear of its gutter.
    pub fn label_width(angle: f32, count: usize) -> f32 {
        if count < 3 {
            return 104.0;
        }
        let (x, y, half) = (150.0 * angle.cos(), 150.0 * angle.sin(), PI / count as f32);
        let (start, end) = (angle - half, angle + half);
        let fits = |w: f32| {
            [-w / 2.0, w / 2.0].iter().all(|dx| {
                [0.0f32, 28.0].iter().all(|dy| {
                    let (px, py) = (x + dx, y + dy);
                    start.cos() * py - start.sin() * px >= 3.0
                        && px * end.sin() - py * end.cos() >= 3.0
                })
            })
        };
        let (mut low, mut high) = (0.0f32, 84.0f32);
        for _ in 0..12 {
            let mid = (low + high) / 2.0;
            if fits(mid) { low = mid } else { high = mid }
        }
        low
    }
}

// ---------- Defaults ----------

pub fn default_settings(documents: &str, adobe: Vec<Action>) -> Settings {
    let action = |id: &str, name: &str, kind: Kind, target: &str, icon: &str| Action {
        id: id.into(),
        name: name.into(),
        kind,
        target: target.into(),
        args: String::new(),
        icon: icon.into(),
        children: Vec::new(),
    };
    let mut items = Vec::new();
    if !adobe.is_empty() {
        let mut group = action("adobe", "Adobe", Kind::Group, "", "adobe");
        group.children = adobe;
        items.push(group);
    }
    items.extend([
        action("documents", "Документи", Kind::Folder, documents, "folder"),
        action(
            "browser",
            "Вебпошук",
            Kind::App,
            "https://www.google.com",
            "globe",
        ),
        action("explorer", "Провідник", Kind::System, "explorer", "files"),
        action(
            "screenshot",
            "Знімок екрана",
            Kind::System,
            "screenshot",
            "screenshot",
        ),
        action(
            "task-manager",
            "Диспетчер завдань",
            Kind::System,
            "task-manager",
            "activity",
        ),
        action("mute", "Вимкнути звук", Kind::System, "mute", "volume"),
        action(
            "settings",
            "Параметри Windows",
            Kind::System,
            "settings",
            "settings",
        ),
    ]);
    Settings {
        version: 1,
        theme: Theme::Dark,
        trigger_button: 4,
        activation_mode: Activation::Hover,
        group_open_mode: GroupOpen::Hover,
        hover_delay: 350,
        enabled: true,
        reduced_motion: false,
        close_on_outside_click: true,
        launch_at_login: true,
        wheel_add_slot: true,
        intro_pending: true,
        wheel_size: DEFAULT_WHEEL_SIZE,
        active_menu_id: "main".into(),
        menus: vec![Menu {
            id: "main".into(),
            name: "Головне меню".into(),
            icon: "orbit".into(),
            items,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn action(id: &str) -> Action {
        Action {
            id: id.into(),
            name: id.into(),
            kind: Kind::App,
            target: format!("C:\\Apps\\{id}.exe"),
            args: "--profile=work".into(),
            icon: "app".into(),
            children: vec![],
        }
    }
    fn group(id: &str, children: Vec<Action>) -> Action {
        Action {
            id: id.into(),
            name: id.into(),
            kind: Kind::Group,
            target: String::new(),
            args: String::new(),
            icon: "group".into(),
            children,
        }
    }
    fn settings(items: Vec<Action>) -> Settings {
        let mut s = default_settings("C:\\Docs", vec![]);
        s.menus[0].items = items;
        s.checked().unwrap()
    }

    #[test]
    fn reads_the_electron_settings_format() {
        let value = json!({"version":1,"theme":"dark","enabled":true,"reducedMotion":false,"triggerButton":4,"activationMode":"hover","hoverDelay":350,
            "activeMenuId":"main","menus":[{"id":"main","name":"Main","items":[{"id":"a","name":" A ","kind":"app","target":"C:\\a.exe"}]}]});
        let s = validate(&value).unwrap();
        assert_eq!(s.menus[0].items[0].name, "A");
        assert!(
            s.close_on_outside_click && s.launch_at_login && s.wheel_add_slot && !s.intro_pending
        );
        assert_eq!(s.wheel_size, 520);
        assert_eq!(s.group_open_mode, GroupOpen::Hover);
        let round = serde_json::to_value(&s).unwrap();
        assert_eq!(round["triggerButton"], 4);
        assert_eq!(validate(&round).unwrap(), s);
    }

    #[test]
    fn rejects_invalid_configurations() {
        let base = serde_json::to_value(default_settings("C:\\Docs", vec![])).unwrap();
        for (key, value) in [
            ("triggerButton", json!(3)),
            ("theme", json!("blue")),
            ("hoverDelay", json!(100)),
            ("wheelSize", json!(900)),
            ("activeMenuId", json!("missing")),
            ("menus", json!([])),
        ] {
            let mut v = base.clone();
            v[key] = value;
            assert!(validate(&v).is_err(), "{key}");
        }
        let mut v = base.clone();
        v["menus"][0]["items"][1]["id"] = v["menus"][0]["items"][0]["id"].clone();
        assert!(validate(&v).is_err());
        let mut v = base.clone();
        v["menus"][0]["items"][2]["target"] = json!("format-disk");
        assert!(validate(&v).is_err());
        let mut deep = json!({"id":"g0","name":"g","kind":"group","children":[]});
        for i in 1..6 {
            deep = json!({"id":format!("g{i}"),"name":"g","kind":"group","children":[deep]});
        }
        let mut v = base;
        v["menus"][0]["items"] = json!([deep]);
        assert!(validate(&v).is_err());
    }

    #[test]
    fn packaged_targets_are_strict() {
        assert_eq!(
            validate_packaged_target("app-id:Microsoft.Photos_8wekyb!App", "").unwrap(),
            "Microsoft.Photos_8wekyb!App"
        );
        assert!(validate_packaged_target("app-id:bad id!App", "").is_err());
        assert!(validate_packaged_target("app-id:A!B", "--x").is_err());
        assert!(validate_packaged_target("app-id:A!B!C", "").is_err());
    }

    #[test]
    fn moving_into_a_group_keeps_metadata_and_does_not_mutate() {
        let original = settings(vec![
            action("illustrator"),
            group("adobe", vec![action("photoshop")]),
            action("browser"),
        ]);
        let moved = move_to_group(&original, "illustrator", "adobe").unwrap();
        assert_eq!(
            moved.menus[0]
                .items
                .iter()
                .map(|i| i.id.as_str())
                .collect::<Vec<_>>(),
            ["adobe", "browser"]
        );
        assert_eq!(
            moved.menus[0].items[0].children[1],
            original.menus[0].items[0]
        );
        assert_eq!(original.menus[0].items.len(), 3);
        assert!(moved.clone().checked().is_ok());
    }

    #[test]
    fn move_rules() {
        let full = settings(vec![
            group("full", (0..12).map(|i| action(&format!("a{i}"))).collect()),
            action("x"),
            group("g", vec![]),
        ]);
        assert!(move_error(&full, "x", "full").is_some());
        assert_eq!(
            move_error(&full, "a4", "full"),
            None,
            "same-parent drop is a no-op"
        );
        assert_eq!(move_to_group(&full, "a4", "full").unwrap(), full);
        assert!(move_error(&full, "g", "g").is_some());
        assert!(move_error(&full, "x", "a1").is_some());
        let nested = settings(vec![group("outer", vec![group("inner", vec![])])]);
        assert!(move_error(&nested, "outer", "inner").is_some());
    }

    #[test]
    fn root_parent_and_reorder() {
        let s = settings(vec![
            action("a"),
            group("g", vec![action("b"), group("h", vec![action("c")])]),
        ]);
        let root = move_to_root(&s, "c").unwrap();
        assert_eq!(root.menus[0].items.last().unwrap().id, "c");
        let parent = move_to_parent(&s, "c").unwrap();
        assert_eq!(
            parent.menus[0].items[1]
                .children
                .iter()
                .map(|i| i.id.as_str())
                .collect::<Vec<_>>(),
            ["b", "h", "c"]
        );
        let reordered = reorder(&s, "g", "a").unwrap();
        assert_eq!(reordered.menus[0].items[0].id, "g");
        assert!(reorder(&s, "a", "b").is_err());
        assert_eq!(move_up(&s, "g").unwrap().menus[0].items[0].id, "g");
        let full_root = settings(
            (0..12)
                .map(|i| action(&format!("r{i}")))
                .chain([])
                .collect(),
        );
        let mut with_group = full_root.clone();
        with_group.menus[0].items[11] = group("g", vec![action("z")]);
        assert!(move_to_root(&with_group, "z").is_err());
        assert!(move_to_parent(&with_group, "z").is_err());
    }

    #[test]
    fn group_paths_and_locations() {
        let s = settings(vec![group("g", vec![group("h", vec![action("c")])])]);
        assert_eq!(
            s.trim_group_path(&["g".into(), "missing".into()]),
            vec!["g".to_string()]
        );
        assert_eq!(s.level(&["g".into(), "h".into()]).1, "h");
        let l = s.find("c").unwrap();
        assert_eq!(l.groups, ["g", "h"]);
        assert_eq!(s.get(&l).id, "c");
        assert_eq!(s.flatten().len(), 3);
    }

    #[test]
    fn windows_argument_parsing() {
        assert_eq!(
            parse_arguments(r#""C:\Project files\scene.aep" --profile=work"#).unwrap(),
            [r"C:\Project files\scene.aep", "--profile=work"]
        );
        assert_eq!(parse_arguments(r#"a\\"b c" d"#).unwrap(), [r"a\b c", "d"]);
        assert_eq!(parse_arguments(r#"say \"hi\""#).unwrap(), ["say", "\"hi\""]);
        assert_eq!(parse_arguments(r#""""#).unwrap(), [""]);
        assert!(parse_arguments(r#""open"#).is_err());
    }

    #[test]
    fn dropped_files_and_foreground() {
        assert_eq!(
            dropped_action(r"C:\Tools\Blender.exe", false).unwrap().name,
            "Blender"
        );
        assert_eq!(dropped_action(r"C:\Work\", true).unwrap().name, "Work");
        assert_eq!(
            dropped_action(r"C:\s\render.PS1", false).unwrap().kind,
            Kind::Script
        );
        assert!(dropped_action(r"C:\notes.txt", false).is_none());
        assert!(foreground_candidate(
            r"C:\Apps\Figma.exe",
            r"C:\Orbit\Orbit.exe"
        ));
        assert!(!foreground_candidate(r"C:\Windows\explorer.exe", ""));
        assert!(!foreground_candidate(
            r"C:\Orbit\Orbit.exe",
            r"c:\orbit\orbit.exe"
        ));
        assert!(!foreground_candidate("relative.exe", ""));
    }

    #[test]
    fn wheel_geometry() {
        use geometry::*;
        assert_eq!(sector_at(0.0, -150.0, 8, 84.0, 230.0), Some(0));
        assert_eq!(sector_at(150.0, 0.0, 8, 84.0, 230.0), Some(2));
        assert_eq!(sector_at(-150.0, 0.0, 8, 84.0, 230.0), Some(6));
        assert_eq!(sector_at(0.0, 0.0, 8, 84.0, 230.0), None);
        assert_eq!(sector_at(0.0, -250.0, 8, 84.0, 230.0), None);
        for count in [1, 2, 3, 5, 8, 12] {
            for i in 0..count {
                let a = slot_angle(i, count);
                assert_eq!(
                    sector_at(150.0 * a.cos(), 150.0 * a.sin(), count, 84.0, 230.0),
                    Some(i)
                );
            }
        }
        // Gutters: both edges sit exactly 3 units from the shared radial boundary.
        let count = 8;
        let (outer, inner) = sector_outline(0, count, 92.0, 207.0, 6.0, 8);
        let start = -std::f32::consts::PI / 2.0 - std::f32::consts::PI / count as f32;
        let offset = |p: [f32; 2]| -start.sin() * p[0] + start.cos() * p[1];
        assert!(
            (offset(outer[0]) - 3.0).abs() < 0.01
                && (offset(*inner.first().unwrap()) - 3.0).abs() < 0.01
        );
        assert!(label_width(slot_angle(0, 12), 12) > 20.0);
    }

    #[test]
    fn words() {
        assert_eq!(actions_word(1), "дію");
        assert_eq!(actions_word(3), "дії");
        assert_eq!(actions_word(11), "дій");
        assert_eq!(actions_word(22), "дії");
        assert_eq!(file_stem(r"C:\a\Render scene.ps1"), "Render scene");
    }
}
