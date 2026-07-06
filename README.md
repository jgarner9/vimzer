# Vimzer ⌨️

Personal vim-style keyboard navigation for Chrome, built around a **leader key**. Press `⌥Space`, then a single letter picks the verb: hint-jump to any element, yank a link, lock scroll focus onto a pane, step through feed items, or switch tabs — as little mouse as possible.

Inspired by Helix's `<leader>gw` word jump, Vimium's `f` hint mode, and vim's `Ctrl+D`/`Ctrl+U`.

---

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this folder

---

## The leader key — `⌥Space`

Press `⌥Space` (bound as a browser-level command, also handled in-page) and a menu bar shows the verbs:

| Key | Verb | What it does |
|---|---|---|
| `f` | **Follow** | Two-letter hint badges on every focusable element; type a code to click/focus it |
| `F` | **Follow (new tab)** | Same, but links open in a new tab |
| `y` | **Yank** | Hint badges; selecting a link copies its URL, anything else copies its text |
| `;` | **Focus** | Hint badges; selecting only moves keyboard focus — no click (great for menus/dropdowns) |
| `s` | **Scroll focus** | Badges on every scrollable area; selecting locks scroll keys onto it |
| `r` | **Region** | Step through items (articles, list rows) in the focused pane with `j`/`k`, `Enter` opens |
| `t` | **Tabs** | Overlay listing your tabs with hint codes; type a code to switch |
| `m` | **Set mark** | Next letter `a–z` saves the current scroll position |
| `'` | **Jump mark** | Next letter jumps back to a saved position |
| `Esc` | Cancel | Exits any mode |

In hint modes: type the first letter → non-matching badges dim; second letter → done. `Backspace` un-types, mistypes auto-reset.

## Always-on keys

These work whenever the page has focus and you're **not** typing in a text field:

| Action | Keybind |
|---|---|
| Half page down / up | `Ctrl + D` / `Ctrl + U` |
| Jump to top / bottom | `gg` / `G` |
| Hints (shortcut for leader → f) | macOS `⌥F` · Win/Linux `Alt+J` · in-page `Alt+F` |
| Hints in new tab | `Alt + Shift + F` |
| Scroll focus picker | `Alt + S` |

Scroll keys act on the locked scroll focus (the pane you picked with leader → `s`), falling back to the page when none is locked or the pane disappears. The text-field guard preserves native bindings like `Ctrl+U` (delete to line start in macOS inputs).

Marks remember which pane they were set in: jumping to a mark restores that pane's scroll position *and* re-locks scroll focus onto it.

---

## Keybinding notes

- **Why `⌥F` on Mac but `Alt+J` elsewhere?** Chrome reserves `Alt+F` for the browser menu on Windows/Linux and silently refuses to register it as an extension command. There's no such conflict on macOS. `Alt+F` is additionally handled in-page on every platform.
- **Already installed?** Chrome only applies suggested command keys on a fresh install. Rebind at `chrome://extensions/shortcuts` or remove and re-load the unpacked extension.
- `Cmd+`-based command shortcuts are unreliable for extensions; customize at `chrome://extensions/shortcuts`.

## Customizing hint characters

In `content.js`, edit the `HINT_CHARS` constant at the top:

```js
const HINT_CHARS = "asdfghjklqwertyuiopzxcvbnm";
```

Home-row characters (`asdfghjkl`) come first by default, so the most common hints are the easiest to type.

---

## Architecture

```
manifest.json     - Extension config, command declarations, permissions
background.js     - Service worker; relays commands → content script,
                    injects on demand, answers tab-list queries
content.js        - Modal state machine: leader, hints (follow/yank/
                    focus/scroll), region stepping, marks, tab switcher,
                    always-on scroll keys
hints.css         - Badges, status/menu bar, toast, region highlight,
                    tab switcher overlay
popup.html        - Popup cheatsheet
```

---

## Known limitations

- **The URL bar is a hard wall.** When the omnibox has focus, macOS turns `⌥`-chords into characters before Chrome's shortcut dispatch sees them, and even a command that fires can't pull keyboard focus back to the page — Chrome walls browser UI off from extensions on purpose (same reason Vimium goes inert there). Click or tab back into the page first.
- Content scripts can't run on `chrome://` pages or the Web Store — Chrome restriction. The tab switcher works *from* any normal page but can't be opened while such a page is focused.
- Marks are per-tab and in-memory; they reset on navigation/reload.
- Region stepping relies on semantic markup (`article`, `li`, `tr`, ARIA roles); div-soup pages may yield no items.
- Hint badges use `fixed` positions; scrolling while hints are up causes drift (re-activate).

## Roadmap

- [x] Leader-key model (`⌥Space`)
- [x] Copy/yank mode
- [x] Focus-only hints
- [x] Scroll-position marks
- [x] Region stepping (v1, semantic items)
- [x] Hint-based tab switcher
- [ ] Optional `j`/`k` line scrolling (config flag, off by default to avoid shadowing site shortcuts)
- [ ] `?` help overlay from idle (leader menu already lists verbs)
- [ ] Options page for custom keymaps instead of editing `content.js`
- [ ] Per-site disable list
- [ ] Tab switcher extras: close (`x`), reopen, move
- [ ] Region stepping v2: repeated-structure detection for non-semantic pages
- [ ] Persistent marks (survive reload via `chrome.storage`)
