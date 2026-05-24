# HintMode 🎯

Helix-style two-letter keyboard navigation for Chrome. Press a keybind and every focusable element on the page gets a two-letter badge — type the code to jump there instantly.

Inspired by Helix's `<leader>gw` word jump and Vimium's `f` hint mode.

---

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `hintmode-extension/` folder

---

## Usage

| Action | Keybind |
|---|---|
| Activate hint mode | `Alt + F` |
| Activate hints (open in new tab) | `Alt + Shift + F` |
| Cancel hint mode | `Esc` |
| Undo last typed char | `Backspace` |

**Hint mode flow:**
1. Press `Alt+F` → amber hint badges appear on every focusable element
2. Type the first letter → non-matching hints dim out
3. Type the second letter → element is focused/clicked

**Smart activation:**
- Links → clicked (or opened in new tab with `Alt+Shift+F`)
- Buttons → clicked
- Inputs / textareas / selects → focused (ready to type)
- Everything else → `.focus()` called

---

## Customizing Keybinds

Chrome doesn't allow extensions to use `Cmd+` shortcuts reliably, but you can change the keybinds at:

```
chrome://extensions/shortcuts
```

Find **HintMode** and set whatever you prefer.

---

## Customizing Hint Characters

In `content.js`, edit the `HINT_CHARS` constant at the top:

```js
const HINT_CHARS = "asdfghjklqwertyuiopzxcvbnm";
```

Home-row characters (`asdfghjkl`) come first by default, so the most common hints are the easiest to type.

---

## Architecture

```
manifest.json     - Extension config, command declarations
background.js     - Service worker; relays keyboard commands → content script
content.js        - All hint logic: element discovery, code gen, key handling
hints.css         - Badge and status bar styles (injected into every page)
popup.html        - Popup showing keybinds and tips
```

---

## Known Limitations

- Some heavily sandboxed pages (e.g. Chrome settings, `chrome://` pages) can't be accessed by content scripts — this is a Chrome restriction
- Pages that block all keyboard events at the document level may interfere
- Hints are positioned with `fixed` coordinates, so fast scrolling while hints are active can cause minor drift (just re-activate)
