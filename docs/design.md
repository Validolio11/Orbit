# Orbit · approved direction

The user approved option 5, Vercel Geist, on 2026-11-01. Direct implementation is authorized.

## Reference lock

Primary: https://vercel.com/geist/introduction

- Preserve monochrome canvas, deliberate contrast, compact 13–14px UI type, single-pixel borders, minimal decoration.
- Colors: https://vercel.com/geist/colors — gray for surfaces/borders/text, distinct hover and active surfaces; green only for actual enabled status; vendor icon colors only inside program icons.
- Materials: https://vercel.com/geist/materials — 6px everyday controls, 12px elevated panels, low elevation. The wheel itself is circular because of the product interaction, not as a general pill treatment.
- Typography: https://vercel.com/geist/typography — 24px page title, 14px labels, 13px secondary text, monospace for shortcuts and technical values. Local Geist font, Segoe UI fallback for unsupported Ukrainian characters.
- Command patterns: https://vercel.com/geist/command-menu — groups, explicit labels, Escape, keyboard operation and discoverable shortcuts. Adapted to a pointer-first radial menu from the user's brief.
- Secondary: https://www.radix-ui.com/themes/docs/theme/overview — borrow semantic light/dark token separation only.
- Motion: Refero bundled motion craft — short functional transitions; reduced-motion support.
- Media: code-native SVG icons and wheel geometry; no bitmap imagery is needed.
- User correction: radial gutters must have equal physical width at the inner and outer arcs. Use 6 viewBox units with parallel offset edges; angular gaps alone are incorrect.
- App identity: extend the existing single tilted orbit glyph into a monochrome Windows icon. Editable `assets/orbit.svg` is the source; black rounded tile, white orbit, center dot and satellite. `scripts/build-icons.cjs` exports ICO sizes 16–256px, with stronger strokes at small sizes. No generated bitmap art is needed for this geometric mark.
- Windows integration: the same identity is embedded into the executable and assigned to both native windows and the tray. Use a dedicated Orbit AppUserModelID.
- Dropdowns: apply the existing Geist surface/border/text/hover/active tokens to both the closed control and its picker; 6px control corners, 8px picker corners, 4px option corners. Chromium customizable select keeps browser-managed keyboard behavior and top-layer positioning. Technical references: https://developer.chrome.com/blog/a-customizable-select and https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select .
- Approved app discovery flow: search installed apps first, show actual program icons and versioned names, autofill target/name on explicit selection; name remains editable. File/URL fallbacks stay visible above the result popover. Advanced target/arguments use a collapsed disclosure. Preserve the 490×560 action-dialog frame and Geist tokens. Keyboard interaction follows https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ .
- Reject: decorative gradients, glass surfaces, excessive rounding, purple accents, marketing hero layout, fabricated usage statistics.
- Drag into groups: preserve the user's action-list layout. Drag the row body; editing, delete and reorder buttons retain their click behavior. An eligible group uses the existing active surface and a thin monochrome inset border; its subtitle changes to an explicit drop instruction. Invalid targets show a muted reason. No automatic group navigation while dragging. Source: user's annotated action-list screenshot and existing Geist selected/action rows.
- Updates: extend the existing settings sections with installed version, live status, check/download/install buttons and a restrained monochrome progress bar. Keep the section DOM stable during progress so settings do not flicker. Source is the user's public GitHub repository; preserve the existing Geist border, type and action roles. Installation is explicit and communicates the restart before the click.
- Wheel size: extend the approved Geist settings rows with a monochrome range control, visible percentage, reset to 100% and the existing wheel preview command. Range 60–150% in 5% increments; preserve the editor's schematic preview and apply size to the actual invoked wheel. Keep keyboard focus after saving and fit the wheel to the monitor work area. Sources: existing appearance/settings rows, user request for circle size, existing preview interaction.

## Decision ledger

| Decision | Source | Role | Purpose |
|---|---|---|---|
| Near-black default with reversible light theme | Geist colors + user | Canvas and semantic tokens | Stable visual contrast |
| White primary action in dark mode | Geist contrast roles | Primary actions only | Clear next action |
| 6px controls, 12px panels | Geist materials | Surface hierarchy | Small, disciplined rounding |
| Sidebar, menu action list, editable detail dialog | User feature brief | Management UI | Fast configuration without hiding actions |
| Circular wheel and nested group navigation | User brief | Global overlay | Mouse-first Adobe launcher workflow |
| Release, hover, click activation settings | User hover brief + accidental activation concern | Execution behavior | User controls selection commitment |
| Global native mouse listener separate from renderer | Microsoft LowLevelMouseProc | Input service | Fast callback and deterministic cleanup |

## Scope

Native Windows desktop app, Electron UI with isolated preload, local persistence, native XBUTTON1/XBUTTON2 listener. No account or cloud connection. Native side-button support must be verified on actual hardware, especially vendor-remapped buttons.
