//! State shared by the editor window, the wheel window and the input thread.

use crate::catalog::Catalog;
use crate::model::{self, Action, Kind, MAX_ITEMS};
use crate::platform::{self, AdminStatus, Rect, os};
use crate::storage::Store;
use crate::ui::item_icon::IconCache;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;

pub fn overlay_id() -> egui::ViewportId {
    egui::ViewportId::from_hash_of("orbit-wheel")
}
pub const MAIN_TITLE: &str = "Orbit";
pub const OVERLAY_TITLE: &str = "Orbit — колесо";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    Mouse,
    Keyboard,
    Preview,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Foreground {
    pub name: String,
    pub target: String,
    pub args: String,
}

/// Messages for the editor window.
#[derive(Clone, Debug)]
pub enum AppEvent {
    ShowMain,
    Navigate { group_path: Vec<String>, add: bool },
    Toast(String, bool),
    ActionError { id: String, error: String },
    Quit,
}

#[derive(Clone, Debug, Default)]
pub struct Runtime {
    pub hook_ready: bool,
    pub hook_error: Option<String>,
    pub shortcut: bool,
    pub admin: AdminStatus,
}

/// The wheel window. The input thread opens and closes it; the wheel's own UI does the rest.
pub struct WheelState {
    pub visible: bool,
    pub session: u64,
    pub trigger: Trigger,
    /// Ids of the open groups, outermost first.
    pub stack: Vec<String>,
    pub selected: Option<usize>,
    pub selected_at: Option<Instant>,
    pub foreground: Option<Foreground>,
    pub busy: bool,
    /// The trigger button went up while the wheel was open.
    pub released: bool,
    pub opened_at: Instant,
    /// Wheel diameter in points, after fitting it to the screen.
    pub size: f32,
    pub bounds: Rect,
    pub scale: f32,
    /// Pointer position when a group opened; small moves around it are ignored.
    pub origin: Option<egui::Pos2>,
    pub focus_keyboard: bool,
    /// Last pointer position seen by the wheel, to react only to movement.
    pub pointer: Option<egui::Pos2>,
    /// Off Windows the wheel window is shown through egui viewport commands.
    pub pending_show: Option<bool>,
}

pub struct Shared {
    pub store: Store,
    pub catalog: Catalog,
    pub icons: IconCache,
    pub ctx: OnceLock<egui::Context>,
    pub wheel: Mutex<WheelState>,
    pub events: Mutex<Vec<AppEvent>>,
    pub runtime: Mutex<Runtime>,
    pub overlay_window: AtomicIsize,
    pub main_window: AtomicIsize,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Shared {
    pub fn new(store: Store, catalog: Catalog, icons: IconCache) -> Self {
        Shared {
            store,
            catalog,
            icons,
            ctx: OnceLock::new(),
            events: Mutex::new(Vec::new()),
            runtime: Mutex::new(Runtime::default()),
            overlay_window: AtomicIsize::new(0),
            main_window: AtomicIsize::new(0),
            wheel: Mutex::new(WheelState {
                visible: false,
                session: 0,
                trigger: Trigger::Preview,
                stack: vec![],
                selected: None,
                selected_at: None,
                foreground: None,
                busy: false,
                released: false,
                opened_at: Instant::now(),
                size: 520.0,
                bounds: Rect::default(),
                scale: 1.0,
                origin: None,
                focus_keyboard: false,
                pointer: None,
                pending_show: None,
            }),
        }
    }
    pub fn wheel(&self) -> MutexGuard<'_, WheelState> {
        lock(&self.wheel)
    }
    pub fn runtime(&self) -> Runtime {
        lock(&self.runtime).clone()
    }
    pub fn set_runtime(&self, change: impl FnOnce(&mut Runtime)) {
        change(&mut lock(&self.runtime));
        self.repaint_main();
    }
    pub fn send(&self, event: AppEvent) {
        lock(&self.events).push(event);
        self.repaint_main();
    }
    pub fn take_events(&self) -> Vec<AppEvent> {
        std::mem::take(&mut lock(&self.events))
    }
    pub fn repaint_main(&self) {
        if let Some(ctx) = self.ctx.get() {
            ctx.request_repaint();
        }
    }
    pub fn repaint_wheel(&self) {
        if let Some(ctx) = self.ctx.get() {
            ctx.request_repaint_of(overlay_id());
        }
    }

    fn window(&self, slot: &AtomicIsize, title: &str) -> Option<isize> {
        let known = slot.load(Ordering::Acquire);
        if known != 0 {
            return Some(known);
        }
        let found = os::find_own_window(title)?;
        slot.store(found, Ordering::Release);
        Some(found)
    }

    pub fn show_main(&self) {
        if let Some(hwnd) = self.window(&self.main_window, MAIN_TITLE) {
            os::show_window(hwnd);
        }
        self.send(AppEvent::ShowMain);
    }

    /// Opens the wheel around a point (physical pixels), or the cursor.
    pub fn open_wheel(&self, trigger: Trigger, point: Option<(i32, i32)>, foreground_pid: u32) {
        let settings = self.store.get();
        if trigger != Trigger::Preview && settings.intro_pending {
            let store = self.store.clone();
            std::thread::spawn(move || {
                let _ = store.update(|s| s.intro_pending = false);
            });
        }
        let (x, y) = point.unwrap_or_else(os::cursor);
        let (area, scale) = os::work_area(x, y);
        let wheel = settings.wheel_size as f32;
        let side = ((600f32).max(wheel + 80.0) * scale).round() as i32;
        let (width, height) = (side.min(area.width), side.min(area.height));
        let bounds = Rect {
            x: (x - width / 2).min(area.x + area.width - width).max(area.x),
            y: (y - height / 2)
                .min(area.y + area.height - height)
                .max(area.y),
            width,
            height,
        };
        let session = {
            let mut w = self.wheel();
            w.session += 1;
            w.visible = true;
            w.trigger = trigger;
            w.stack.clear();
            w.selected = None;
            w.selected_at = None;
            w.foreground = None;
            w.busy = false;
            w.released = false;
            w.opened_at = Instant::now();
            w.origin = None;
            w.focus_keyboard = false;
            w.pointer = None;
            w.size = wheel
                .min(width as f32 / scale - 30.0)
                .min(height as f32 / scale - 60.0)
                .max(0.0);
            w.bounds = bounds;
            w.scale = scale;
            w.pending_show = Some(true);
            w.session
        };
        if let Some(hwnd) = self.window(&self.overlay_window, OVERLAY_TITLE) {
            os::place_window(hwnd, bounds, trigger != Trigger::Mouse);
        }
        os::set_escape(true);
        self.repaint_wheel();
        // Off Windows the editor window applies the show through viewport commands.
        if !cfg!(windows) {
            self.repaint_main();
        }
        if foreground_pid != 0 && foreground_pid != std::process::id() {
            self.resolve_foreground(foreground_pid, session);
        }
    }

    /// Finds the program that was in front, for the wheel's "+" slot, without holding up the wheel.
    fn resolve_foreground(&self, pid: u32, session: u64) {
        let shared = crate::app::shared();
        std::thread::spawn(move || {
            let path = os::process_path(pid);
            if !model::foreground_candidate(&path, &platform::own_exe()) {
                return;
            }
            let found = shared.catalog.find_executable(&path);
            // Store apps start only through their catalog entry, never from WindowsApps.
            if found.is_none() && path.to_lowercase().contains("\\windowsapps\\") {
                return;
            }
            let foreground = found
                .map(|e| Foreground {
                    name: e.name,
                    target: e.target,
                    args: e.args,
                })
                .unwrap_or_else(|| {
                    let stem = model::file_stem(&path);
                    let mut chars = stem.chars();
                    let name = chars
                        .next()
                        .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
                        .unwrap_or_default();
                    Foreground {
                        name,
                        target: path.clone(),
                        args: String::new(),
                    }
                });
            let mut w = shared.wheel();
            if w.session == session && w.visible {
                w.foreground = Some(foreground);
                drop(w);
                shared.repaint_wheel();
            }
        });
    }

    pub fn close_wheel(&self) {
        {
            let mut w = self.wheel();
            if !w.visible {
                return;
            }
            w.visible = false;
            w.session += 1;
            w.selected = None;
            w.pending_show = Some(false);
        }
        if let Some(hwnd) = self.window(&self.overlay_window, OVERLAY_TITLE) {
            os::hide_window(hwnd);
        }
        os::set_escape(false);
        self.repaint_wheel();
        if !cfg!(windows) {
            self.repaint_main();
        }
    }

    /// A click anywhere on screen closes the wheel when it lands outside the ring.
    pub fn outside_click(&self, x: i32, y: i32) {
        let (visible, bounds, size, scale) = {
            let w = self.wheel();
            (w.visible, w.bounds, w.size, w.scale)
        };
        if !visible || !self.store.read(|s| s.close_on_outside_click) {
            return;
        }
        let (cx, cy) = (
            bounds.x as f32 + bounds.width as f32 / 2.0,
            bounds.y as f32 + bounds.height as f32 / 2.0,
        );
        if (x as f32 - cx).hypot(y as f32 - cy) > 207.0 / 480.0 * size * scale {
            self.close_wheel();
        }
    }

    /// Runs an action from the wheel; a failure opens the editor on that action.
    pub fn launch(&self, action: Action) {
        self.close_wheel();
        let shared = crate::app::shared();
        std::thread::spawn(move || {
            if let Err(error) = crate::launcher::execute(&action) {
                shared.show_main();
                shared.send(AppEvent::ActionError {
                    id: action.id,
                    error,
                });
            }
        });
    }

    /// The "+" slot: adds the program that was in front to the open wheel level.
    pub fn add_foreground(&self) -> Result<String, String> {
        let (foreground, stack) = {
            let w = self.wheel();
            (w.foreground.clone(), w.stack.clone())
        };
        let foreground = foreground.ok_or("Не вдалося визначити програму.")?;
        let mut action = Action::new(Kind::App, foreground.name, foreground.target);
        action.args = foreground.args;
        action.icon = "app".into();
        let id = action.id.clone();
        let mut next = self.store.get();
        let level = next.level_mut(&stack);
        if level.len() >= MAX_ITEMS {
            return Err("У цьому колесі вже 12 дій.".into());
        }
        level.push(action);
        self.store.save(next)?;
        self.repaint_main();
        Ok(id)
    }

    pub fn open_add_dialog(&self, group_path: Vec<String>) {
        self.close_wheel();
        self.show_main();
        self.send(AppEvent::Navigate {
            group_path,
            add: true,
        });
    }
}
