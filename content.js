/**
 * Vimzer - content script
 * Vim-style keyboard navigation for Chrome: hint jumps + scroll focus
 */

(function () {
  "use strict";

  // The background worker injects this script on demand into tabs that predate
  // the extension install; don't register everything twice.
  if (window.__vimzerLoaded) return;
  window.__vimzerLoaded = true;

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

  // Double-tap window for the `gg` chord
  const GG_WINDOW_MS = 500;

  // How long the scroll-target outline flash stays visible
  const SCROLL_FLASH_MS = 1200;

  // ─── State ───────────────────────────────────────────────────────────────────

  let active = false;
  let hintKind = "links"; // "links" | "scroll"
  let newTabMode = false;
  let typed = "";
  let hints = []; // [{ code, element, badge }]
  let statusBar = null;

  let scrollTarget = null; // null = the page itself
  let lastGPress = 0;

  // ─── Entry point ─────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ACTIVATE_HINTS") {
      if (active) {
        deactivate();
      } else {
        activate({ kind: "links", newTab: msg.newTab });
      }
    }
  });

  // In-page keybinds. Chrome refuses to bind Alt+F as an extension command on
  // Windows/Linux (browser menu conflict), and the scroll keys are page-local
  // by design, so everything is handled here in a capture-phase listener.
  document.addEventListener("keydown", handleKeyDown, true);

  // ─── Activation ──────────────────────────────────────────────────────────────

  function activate({ kind, newTab = false }) {
    const elements = kind === "scroll" ? getScrollableAreas() : getVisibleFocusable();
    if (elements.length === 0) return;

    active = true;
    hintKind = kind;
    newTabMode = newTab;
    typed = "";

    const codes = generateCodes(elements.length);

    hints = elements.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const badge = createBadge(codes[i], rect);
      document.body.appendChild(badge);
      return { code: codes[i], element: el, badge };
    });

    statusBar = createStatusBar(kind === "scroll" ? "SCROLL" : "HINT", elements.length);
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
        activate({ kind: "links", newTab: e.shiftKey });
      }
      return;
    }

    // Alt+S toggles the scroll-focus picker
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyS") {
      e.preventDefault();
      e.stopPropagation();
      if (active) {
        deactivate();
      } else {
        activate({ kind: "scroll" });
      }
      return;
    }

    if (active) {
      handleHintKey(e);
    } else {
      handleScrollKey(e);
    }
  }

  function handleHintKey(e) {
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

    // Leave shortcuts like Ctrl+C alone while hints are up
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const char = e.key.toLowerCase();
    if (char.length !== 1 || !HINT_CHARS.includes(char)) return;

    e.preventDefault();
    e.stopPropagation();

    typed += char;
    updateHints();
  }

  function handleScrollKey(e) {
    if (isEditable(e.target) || isEditable(document.activeElement)) return;

    // Ctrl+D / Ctrl+U: half page down / up
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      if (e.code === "KeyD" || e.code === "KeyU") {
        e.preventDefault();
        e.stopPropagation();
        halfPage(e.code === "KeyD" ? 1 : -1);
      }
      return;
    }

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // G: jump to bottom; gg: jump to top
    if (e.code === "KeyG") {
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        lastGPress = 0;
        scrollToEdge(1);
      } else {
        const now = Date.now();
        if (now - lastGPress < GG_WINDOW_MS) {
          e.preventDefault();
          e.stopPropagation();
          lastGPress = 0;
          scrollToEdge(-1);
        } else {
          lastGPress = now;
        }
      }
    }
  }

  function updateHints() {
    updateStatusBar();

    // Check for exact match
    const match = hints.find((h) => h.code === typed);
    if (match) {
      const { element } = match;
      const kind = hintKind;
      deactivate();
      if (kind === "scroll") {
        selectScrollTarget(element);
      } else {
        activateElement(element);
      }
      return;
    }

    // Filter: show matching prefixes, dim others
    let anyVisible = false;
    hints.forEach(({ code, badge }) => {
      const matches = code.startsWith(typed);
      badge.classList.toggle("vimzer-dim", !matches);

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
        badge.classList.remove("vimzer-dim");
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
      console.warn("[Vimzer] Could not activate element:", err);
    }
  }

  // ─── Scroll focus ────────────────────────────────────────────────────────────

  function rootScroller() {
    return document.scrollingElement || document.documentElement;
  }

  function selectScrollTarget(el) {
    const isRoot = el === rootScroller() || el === document.documentElement || el === document.body;
    scrollTarget = isRoot ? null : el;

    const flashEl = isRoot ? document.documentElement : el;
    flashEl.classList.add("vimzer-scroll-target");
    setTimeout(() => flashEl.classList.remove("vimzer-scroll-target"), SCROLL_FLASH_MS);
  }

  // Returns the locked container, or null meaning "scroll the page".
  // Drops the lock if the container left the DOM or stopped being scrollable.
  function getScroller() {
    if (
      scrollTarget &&
      scrollTarget.isConnected &&
      scrollTarget.scrollHeight > scrollTarget.clientHeight
    ) {
      return scrollTarget;
    }
    scrollTarget = null;
    return null;
  }

  function halfPage(dir) {
    const t = getScroller();
    if (t) {
      t.scrollBy({ top: (dir * t.clientHeight) / 2, behavior: "smooth" });
    } else {
      window.scrollBy({ top: (dir * window.innerHeight) / 2, behavior: "smooth" });
    }
  }

  function scrollToEdge(dir) {
    const t = getScroller() || rootScroller();
    t.scrollTo({ top: dir > 0 ? t.scrollHeight : 0, behavior: "smooth" });
  }

  function getScrollableAreas() {
    const root = rootScroller();
    const areas = [root];

    for (const el of document.body.getElementsByTagName("*")) {
      if (el === root || el === document.body) continue;
      if (el.clientHeight < 60) continue;
      if (el.scrollHeight <= el.clientHeight + 10) continue;

      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") continue;

      if (!isVisible(el)) continue;
      if (!overlapsViewport(el.getBoundingClientRect())) continue;

      areas.push(el);
    }

    return areas;
  }

  function isEditable(el) {
    if (!el || el === document.body) return false;
    const tag = el.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

  // ─── Element discovery ────────────────────────────────────────────────────────

  function getVisibleFocusable() {
    const all = document.querySelectorAll(FOCUSABLE_SELECTORS);

    return Array.from(all).filter((el) => {
      if (!isVisible(el)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      return overlapsViewport(rect);
    });
  }

  function overlapsViewport(rect) {
    return (
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth
    );
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

    // Two-char combos, home-row first. Always two chars for consistency.
    for (const a of chars) {
      if (codes.length >= count) break;
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
    badge.className = "vimzer-badge";

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

  function createStatusBar(mode, count) {
    const bar = document.createElement("div");
    bar.className = "vimzer-statusbar";
    bar.innerHTML = `
      <span class="status-mode">${mode}</span>
      <span class="status-typed" id="vimzer-typed">_</span>
      <span class="status-count" id="vimzer-count">${count} targets</span>
      ${newTabMode ? '<span class="status-newtab">⌥ new tab</span>' : ""}
    `;
    return bar;
  }

  function updateStatusBar() {
    if (!statusBar) return;
    const typedEl = statusBar.querySelector("#vimzer-typed");
    const countEl = statusBar.querySelector("#vimzer-count");
    if (typedEl) typedEl.textContent = typed || "_";
    if (countEl) {
      const visible = hints.filter((h) => h.code.startsWith(typed)).length;
      countEl.textContent = `${visible} target${visible !== 1 ? "s" : ""}`;
    }
  }
})();
