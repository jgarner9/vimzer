# Vimzer ⌨️

Personal vim-style keyboard navigation for Chrome. Jump to any focusable element with two-letter hint codes, lock "scroll focus" onto any scrollable pane, and drive the page with vim scroll keys — as little mouse as possible.

Inspired by Helix's `<leader>gw` word jump, Vimium's `f` hint mode, and vim's `Ctrl+D`/`Ctrl+U`.

---

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this folder

---

## Hint mode

| Action | Keybind |
|---|---|
| Activate hints | macOS: `⌥F` · Windows/Linux: `Alt + J` (`Alt + F` also works on any platform while the page has focus) |
| Activate hints (open in new tab) | `Alt + Shift + F` |
| Cancel | `Esc` |
| Undo last typed char | `Backspace` |

1. Press `⌥F` → amber two-letter badges appear on every focusable element
2. Type the first letter → non-matching hints dim out
3. Type the second letter → element is clicked/focused

**Smart activation:** links are clicked (or opened in a new tab with `Alt+Shift+F`), buttons are clicked, inputs/textareas/selects are focused ready to type, everything else gets `.focus()`.

## Scroll mode

| Action | Keybind |
|---|---|
| Pick scroll focus | `Alt + S` |
| Half page down / up | `Ctrl + D` / `Ctrl + U` |
| Jump to top | `gg` |
| Jump to bottom | `G` |

Pages often have several scrollable areas — the page itself, a sidebar, a chat pane, a code block. `Alt+S` badges each one (the page itself is always `aa`); type a code to lock **scroll focus** onto that container. It flashes an amber outline to confirm, and from then on `Ctrl+D` / `Ctrl+U` / `gg` / `G` scroll *it* instead of the page.

- Scroll focus resets to the page when you navigate, or automatically if the container disappears from the DOM (SPA re-renders).
- Scroll keys are ignored while you're typing in an input, textarea, or contenteditable — `Ctrl+U`'s native "delete to line start" in macOS text fields survives.
- `gg`/`G` are plain-letter keys and only act outside text fields; `j`/`k` line scrolling is deliberately left to sites (Gmail, GitHub, YouTube use them) — see roadmap.

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
manifest.json     - Extension config, command declarations
background.js     - Service worker; relays commands → content script,
                    injects on demand into tabs that predate the install
content.js        - Hint + scroll logic: element discovery, code gen,
                    key handling, scroll-focus state
hints.css         - Badge, status bar, and scroll-focus outline styles
popup.html        - Popup showing keybinds
```

---

## Known limitations

- **The URL bar is a hard wall.** When the omnibox has focus, macOS turns `⌥F` into `ƒ` before Chrome's shortcut dispatch sees it, and even a command that fires can't pull keyboard focus back to the page — Chrome walls browser UI off from extensions on purpose (same reason Vimium goes inert there). Click or tab back into the page first.
- Content scripts can't run on `chrome://` pages or the Web Store — Chrome restriction.
- Pages that swallow all keyboard events at the document level may interfere.
- Hint badges use `fixed` positions; scrolling while hints are up causes drift (re-activate).

## Roadmap

- [ ] Optional `j`/`k` line scrolling (config flag, off by default to avoid shadowing site shortcuts)
- [ ] Hint-based tab switcher (badges over a tab list, type to jump)
- [ ] `?` help overlay showing all active keybinds
- [ ] Options page for custom keymaps instead of editing `content.js`
- [ ] Per-site disable list
- [ ] Vim-style marks (`m` + letter to save a scroll position, `'` + letter to return)
