/**
 * HintMode - content script
 * Helix-style two-letter keyboard navigation for Chrome
 */

(function () {
  "use strict";

  // The background worker injects this script on demand into tabs that predate
  // the extension install; don't register everything twice.
  if (window.__hintModeLoaded) return;
  window.__hintModeLoaded = true;

  // ─── Config ──────────────────────────────────────────────────────────────────

  // Home-row biased hint alphabet. Pairs are generated in order, so frequent
  // keys come first. Customize to taste.
  const HINT_CHARS = "asdfghjklqwertyuiopzxcvbnm";

  // Focusable element selectors
  const FOCUSABLE_SELECTORS = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']",
    "label[for]",
    "summary",
  ].join(", ");

  // ─── State ───────────────────────────────────────────────────────────────────

  let active = false;
  let newTabMode = false;
  let typed = "";
  let hints = []; // [{ code, element, badge }]
  let statusBar = null;

  // ─── Entry point ─────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ACTIVATE_HINTS") {
      if (active) {
        deactivate();
      } else {
        activate(msg.newTab);
      }
    }
  });

  // In-page fallback keybind: Chrome refuses to bind Alt+F as an extension
  // command (it collides with the browser menu shortcut), so handle it here.
  document.addEventListener("keydown", handleKeyDown, true);

  // ─── Activation ──────────────────────────────────────────────────────────────

  function activate(openInNewTab = false) {
    active = true;
    newTabMode = openInNewTab;
    typed = "";

    const elements = getVisibleFocusable();
    if (elements.length === 0) {
      deactivate();
      return;
    }

    const codes = generateCodes(elements.length);

    hints = elements.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const badge = createBadge(codes[i], rect);
      document.body.appendChild(badge);
      return { code: codes[i], element: el, badge };
    });

    statusBar = createStatusBar(elements.length);
    document.body.appendChild(statusBar);
  }

  function deactivate() {
    active = false;
    typed = "";
    hints.forEach(({ badge }) => badge.remove());
    hints = [];
    if (statusBar) {
      statusBar.remove();
      statusBar = null;
    }
  }

  // ─── Key handling ────────────────────────────────────────────────────────────

  function handleKeyDown(e) {
    // Alt+F toggles hint mode; Alt+Shift+F toggles new-tab mode. Match on
    // e.code so this works even where Alt+F produces a character (ƒ on macOS).
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyF") {
      e.preventDefault();
      e.stopPropagation();
      if (active) {
        deactivate();
      } else {
        activate(e.shiftKey);
      }
      return;
    }

    if (!active) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
      return;
    }

    // Backspace to undo last typed char
    if (e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      typed = typed.slice(0, -1);
      updateHints();
      return;
    }

    const char = e.key.toLowerCase();
    if (!HINT_CHARS.includes(char)) return;

    e.preventDefault();
    e.stopPropagation();

    typed += char;
    updateHints();
  }

  function updateHints() {
    updateStatusBar();

    // Check for exact match
    const match = hints.find((h) => h.code === typed);
    if (match) {
      activateElement(match.element);
      deactivate();
      return;
    }

    // Filter: show matching prefixes, dim others
    let anyVisible = false;
    hints.forEach(({ code, badge }) => {
      const matches = code.startsWith(typed);
      badge.classList.toggle("hintmode-dim", !matches);

      if (matches) {
        anyVisible = true;
        // Re-render badge text with matched portion highlighted
        renderBadgeText(badge, code, typed.length);
      }
    });

    // If nothing matches, reset (mistype recovery)
    if (!anyVisible) {
      typed = "";
      hints.forEach(({ code, badge }) => {
        badge.classList.remove("hintmode-dim");
        renderBadgeText(badge, code, 0);
      });
      updateStatusBar();
    }
  }

  function activateElement(el) {
    try {
      // Scroll into view if needed
      el.scrollIntoView({ block: "nearest", inline: "nearest" });

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type")?.toLowerCase();
      const isLink = tag === "a" && el.href;
      const isClickable =
        tag === "button" ||
        tag === "summary" ||
        type === "button" ||
        type === "submit" ||
        type === "reset" ||
        type === "checkbox" ||
        type === "radio" ||
        el.getAttribute("role") === "button";

      if (isLink && newTabMode) {
        window.open(el.href, "_blank", "noopener");
      } else if (isLink || isClickable) {
        el.click();
      } else {
        el.focus();
      }
    } catch (err) {
      console.warn("[HintMode] Could not activate element:", err);
    }
  }

  // ─── Element discovery ────────────────────────────────────────────────────────

  function getVisibleFocusable() {
    const all = document.querySelectorAll(FOCUSABLE_SELECTORS);
    const viewport = {
      top: 0,
      left: 0,
      bottom: window.innerHeight,
      right: window.innerWidth,
    };

    return Array.from(all).filter((el) => {
      if (!isVisible(el)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      // Must overlap the viewport
      return (
        rect.bottom > viewport.top &&
        rect.top < viewport.bottom &&
        rect.right > viewport.left &&
        rect.left < viewport.right
      );
    });
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) < 0.05) return false;
    return true;
  }

  // ─── Hint code generation ─────────────────────────────────────────────────────

  function generateCodes(count) {
    const chars = HINT_CHARS.split("");
    const codes = [];

    // Single-char hints first (up to chars.length)
    // Then two-char combos, home-row first
    for (const a of chars) {
      if (codes.length >= count) break;
      // Reserve single chars only if we don't need two-char codes for overflow
      // Always use two chars for consistency (cleaner UX)
      for (const b of chars) {
        if (codes.length >= count) break;
        codes.push(a + b);
      }
    }

    return codes.slice(0, count);
  }

  // ─── DOM helpers ─────────────────────────────────────────────────────────────

  function createBadge(code, rect) {
    const badge = document.createElement("div");
    badge.className = "hintmode-badge";

    renderBadgeText(badge, code, 0);

    // Position at top-left corner of element
    badge.style.top = `${Math.max(0, rect.top)}px`;
    badge.style.left = `${Math.max(0, rect.left)}px`;

    return badge;
  }

  function renderBadgeText(badge, code, matchedLen) {
    badge.innerHTML = "";
    for (let i = 0; i < code.length; i++) {
      const span = document.createElement("span");
      span.textContent = code[i];
      span.className = i < matchedLen ? "hint-char-matched" : "hint-char-pending";
      badge.appendChild(span);
    }
  }

  function createStatusBar(count) {
    const bar = document.createElement("div");
    bar.className = "hintmode-statusbar";
    bar.innerHTML = `
      <span class="status-mode">HINT</span>
      <span class="status-typed" id="hintmode-typed">_</span>
      <span class="status-count" id="hintmode-count">${count} targets</span>
      ${newTabMode ? '<span class="status-newtab">⌥ new tab</span>' : ""}
    `;
    return bar;
  }

  function updateStatusBar() {
    if (!statusBar) return;
    const typedEl = statusBar.querySelector("#hintmode-typed");
    const countEl = statusBar.querySelector("#hintmode-count");
    if (typedEl) typedEl.textContent = typed || "_";
    if (countEl) {
      const visible = hints.filter((h) => h.code.startsWith(typed)).length;
      countEl.textContent = `${visible} target${visible !== 1 ? "s" : ""}`;
    }
  }
})();
