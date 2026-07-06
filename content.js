/**
 * Vimzer - content script
 * Vim-style keyboard navigation for Chrome: leader key, hint jumps,
 * scroll focus, yank, region stepping, marks, and a tab switcher.
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

  // What counts as an "item" when stepping through a region
  const REGION_ITEM_SELECTORS =
    'article, li, tr, [role="article"], [role="listitem"], [role="row"]';

  const GG_WINDOW_MS = 500; // double-tap window for the `gg` chord
  const FLASH_MS = 1200; // scroll-target outline flash
  const TOAST_MS = 1600;

  // ─── State ───────────────────────────────────────────────────────────────────

  // "idle" | "leader" | "hints" | "tabs" | "region" | "mark-set" | "mark-jump"
  let mode = "idle";

  // What selecting a hint does: "click" | "newtab" | "yank" | "focus" | "scroll"
  let hintAction = "click";

  let typed = "";
  let hints = []; // [{ code, element, badge }]
  let bar = null; // active status/menu bar
  let tabPanel = null; // tab switcher overlay
  let tabRows = []; // [{ code, tabId, row }]
  let toastEl = null;
  let toastTimer = 0;

  let scrollTarget = null; // null = the page itself
  let marks = {}; // letter -> { el, top }
  let regionItems = [];
  let regionIndex = -1;
  let lastGPress = 0;

  // ─── Entry points ────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ACTIVATE_HINTS") {
      if (mode !== "idle") {
        reset();
      } else {
        startHints(msg.newTab ? "newtab" : "click");
      }
    } else if (msg.type === "ENTER_LEADER") {
      if (mode !== "idle") {
        reset();
      } else {
        enterLeader();
      }
    }
  });

  // All in-page keybinds live in one capture-phase listener. The leader chord
  // is also a browser-level command, and Alt+F stays as a direct chord because
  // Chrome refuses to bind it as a command on Windows/Linux (menu conflict).
  document.addEventListener("keydown", handleKeyDown, true);

  // ─── Key dispatch ────────────────────────────────────────────────────────────

  function handleKeyDown(e) {
    // Alt+Space: the leader. Match on e.code so it works where Option+Space
    // produces a character (non-breaking space on macOS).
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "Space") {
      e.preventDefault();
      e.stopPropagation();
      if (mode !== "idle") {
        reset();
      } else {
        enterLeader();
      }
      return;
    }

    // Direct chords (kept alongside the leader): Alt+F hints, Alt+S scroll picker
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyF") {
      e.preventDefault();
      e.stopPropagation();
      if (mode !== "idle") {
        reset();
      } else {
        startHints(e.shiftKey ? "newtab" : "click");
      }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyS") {
      e.preventDefault();
      e.stopPropagation();
      if (mode !== "idle") {
        reset();
      } else {
        startHints("scroll");
      }
      return;
    }

    if (mode !== "idle" && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      reset();
      return;
    }

    switch (mode) {
      case "leader":
        handleLeaderKey(e);
        break;
      case "hints":
        handleHintKey(e);
        break;
      case "tabs":
        handleTabsKey(e);
        break;
      case "region":
        handleRegionKey(e);
        break;
      case "mark-set":
      case "mark-jump":
        handleMarkKey(e);
        break;
      default:
        handleScrollKey(e);
    }
  }

  // ─── Leader mode ─────────────────────────────────────────────────────────────

  function enterLeader() {
    mode = "leader";
    showBar(
      "LEADER",
      `<span class="leader-menu">
        <b>f</b> follow · <b>F</b> new tab · <b>y</b> yank · <b>;</b> focus ·
        <b>s</b> scroll · <b>r</b> region · <b>t</b> tabs · <b>m</b> mark · <b>'</b> jump
      </span>`
    );
  }

  function handleLeaderKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    removeBar();
    mode = "idle";

    switch (e.key) {
      case "f":
        startHints("click");
        break;
      case "F":
        startHints("newtab");
        break;
      case "y":
        startHints("yank");
        break;
      case ";":
        startHints("focus");
        break;
      case "s":
        startHints("scroll");
        break;
      case "r":
        enterRegion();
        break;
      case "t":
        openTabSwitcher();
        break;
      case "m":
        mode = "mark-set";
        showBar("MARK", "set mark: press a–z");
        break;
      case "'":
        mode = "mark-jump";
        showBar("MARK", "jump to mark: press a–z");
        break;
      // anything else: leader silently cancels
    }
  }

  // ─── Hint mode (follow / new tab / yank / focus / scroll picker) ─────────────

  function startHints(action) {
    const elements = action === "scroll" ? getScrollableAreas() : getVisibleFocusable();
    if (elements.length === 0) {
      toast("no targets");
      return;
    }

    mode = "hints";
    hintAction = action;
    typed = "";

    const codes = generateCodes(elements.length);

    hints = elements.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const badge = createBadge(codes[i], rect);
      document.body.appendChild(badge);
      return { code: codes[i], element: el, badge };
    });

    const labels = {
      click: "HINT",
      newtab: "HINT",
      yank: "YANK",
      focus: "FOCUS",
      scroll: "SCROLL",
    };
    showBar(
      labels[action],
      `<span class="status-typed" id="vimzer-typed">_</span>
       <span class="status-count" id="vimzer-count">${elements.length} targets</span>
       ${action === "newtab" ? '<span class="status-newtab">⌥ new tab</span>' : ""}`
    );
  }

  function handleHintKey(e) {
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

  function updateHints() {
    updateHintBar();

    // Check for exact match
    const match = hints.find((h) => h.code === typed);
    if (match) {
      const { element } = match;
      const action = hintAction;
      reset();
      selectHint(element, action);
      return;
    }

    // Filter: show matching prefixes, dim others
    let anyVisible = false;
    hints.forEach(({ code, badge }) => {
      const matches = code.startsWith(typed);
      badge.classList.toggle("vimzer-dim", !matches);

      if (matches) {
        anyVisible = true;
        renderBadgeText(badge, code, typed.length);
      }
    });

    // If nothing matches, reset typed (mistype recovery)
    if (!anyVisible) {
      typed = "";
      hints.forEach(({ code, badge }) => {
        badge.classList.remove("vimzer-dim");
        renderBadgeText(badge, code, 0);
      });
      updateHintBar();
    }
  }

  function selectHint(el, action) {
    switch (action) {
      case "scroll":
        selectScrollTarget(el);
        break;
      case "yank":
        yankElement(el);
        break;
      case "focus":
        try {
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
          el.focus();
        } catch (err) {
          console.warn("[Vimzer] Could not focus element:", err);
        }
        break;
      default:
        activateElement(el, action === "newtab");
    }
  }

  function activateElement(el, newTab) {
    try {
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

      if (isLink && newTab) {
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

  // ─── Yank ────────────────────────────────────────────────────────────────────

  function yankElement(el) {
    const tag = el.tagName.toLowerCase();
    let text;
    if (tag === "a" && el.href) {
      text = el.href;
    } else if (tag === "input" || tag === "textarea") {
      text = el.value;
    } else {
      text = (el.textContent || "").trim();
    }
    if (!text) {
      toast("nothing to yank");
      return;
    }
    copyText(text);
  }

  function copyText(text) {
    const done = () => toast(`yanked: ${truncate(text, 60)}`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
    } else {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      toast("copy failed");
    }
    ta.remove();
  }

  // ─── Scroll focus + always-on scroll keys ────────────────────────────────────

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

  function rootScroller() {
    return document.scrollingElement || document.documentElement;
  }

  function selectScrollTarget(el) {
    const isRoot = el === rootScroller() || el === document.documentElement || el === document.body;
    scrollTarget = isRoot ? null : el;
    flash(isRoot ? document.documentElement : el);
  }

  function flash(el) {
    el.classList.add("vimzer-scroll-target");
    setTimeout(() => el.classList.remove("vimzer-scroll-target"), FLASH_MS);
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

  // ─── Marks ───────────────────────────────────────────────────────────────────

  function handleMarkKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const letter = e.key;
    if (!/^[a-z]$/.test(letter)) return;

    e.preventDefault();
    e.stopPropagation();
    const setting = mode === "mark-set";
    reset();

    if (setting) {
      const t = getScroller();
      marks[letter] = { el: t, top: t ? t.scrollTop : window.scrollY };
      toast(`mark '${letter}' set`);
    } else {
      const m = marks[letter];
      if (!m) {
        toast(`no mark '${letter}'`);
        return;
      }
      if (m.el && m.el.isConnected) {
        scrollTarget = m.el;
        m.el.scrollTo({ top: m.top, behavior: "smooth" });
        flash(m.el);
      } else {
        window.scrollTo({ top: m.top, behavior: "smooth" });
      }
      toast(`mark '${letter}'`);
    }
  }

  // ─── Region mode ─────────────────────────────────────────────────────────────

  function enterRegion() {
    const root = getScroller() || document.body;
    regionItems = findRegionItems(root);
    if (regionItems.length === 0) {
      toast("no items in region");
      return;
    }
    mode = "region";
    regionIndex = -1;
    showBar(
      "REGION",
      `<span class="status-count">${regionItems.length} items</span>
       <span class="leader-menu"><b>j/k</b> step · <b>Enter</b> open · <b>Esc</b> exit</span>`
    );
    stepRegion(1);
  }

  function findRegionItems(root) {
    return Array.from(root.querySelectorAll(REGION_ITEM_SELECTORS)).filter((el) => {
      if (el.clientHeight < 20) return false;
      if (!isVisible(el)) return false;
      // Skip wrappers whose first item-child covers the same content
      const firstChild = el.querySelector(REGION_ITEM_SELECTORS);
      if (firstChild && firstChild.clientHeight >= el.clientHeight * 0.9) return false;
      return true;
    });
  }

  function handleRegionKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === "j" || e.key === "n" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      stepRegion(1);
    } else if (e.key === "k" || e.key === "p" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      stepRegion(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const item = regionItems[regionIndex];
      reset();
      if (item) openRegionItem(item);
    } else if (e.key === "q") {
      e.preventDefault();
      e.stopPropagation();
      reset();
    }
  }

  function stepRegion(dir) {
    if (regionItems.length === 0) return;
    const prev = regionItems[regionIndex];
    if (prev) prev.classList.remove("vimzer-region-item");

    regionIndex = Math.min(Math.max(regionIndex + dir, 0), regionItems.length - 1);
    const item = regionItems[regionIndex];
    item.classList.add("vimzer-region-item");
    item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function openRegionItem(item) {
    const target = item.querySelector("a[href], button") || item;
    activateElement(target, false);
  }

  // ─── Tab switcher ────────────────────────────────────────────────────────────

  function openTabSwitcher() {
    chrome.runtime.sendMessage({ type: "GET_TABS" }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        toast("no tabs");
        return;
      }

      mode = "tabs";
      typed = "";

      const codes = generateCodes(tabs.length);
      tabPanel = document.createElement("div");
      tabPanel.className = "vimzer-tabs";

      tabRows = tabs.map((tab, i) => {
        const row = document.createElement("div");
        row.className = "vimzer-tab-row" + (tab.active ? " vimzer-tab-active" : "");
        let host = "";
        try {
          host = new URL(tab.url).host;
        } catch {}
        row.innerHTML = `
          <span class="tab-code">${codes[i]}</span>
          <span class="tab-title">${escapeHtml(truncate(tab.title, 60))}</span>
          <span class="tab-host">${escapeHtml(host)}</span>
        `;
        tabPanel.appendChild(row);
        return { code: codes[i], tabId: tab.id, row };
      });

      document.body.appendChild(tabPanel);
      showBar(
        "TABS",
        `<span class="status-typed" id="vimzer-typed">_</span>
         <span class="status-count">${tabs.length} tabs</span>`
      );
    });
  }

  function handleTabsKey(e) {
    if (e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      typed = typed.slice(0, -1);
      updateTabRows();
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const char = e.key.toLowerCase();
    if (char.length !== 1 || !HINT_CHARS.includes(char)) return;

    e.preventDefault();
    e.stopPropagation();

    typed += char;
    updateTabRows();
  }

  function updateTabRows() {
    const typedEl = bar?.querySelector("#vimzer-typed");
    if (typedEl) typedEl.textContent = typed || "_";

    const match = tabRows.find((r) => r.code === typed);
    if (match) {
      const tabId = match.tabId;
      reset();
      chrome.runtime.sendMessage({ type: "SWITCH_TAB", tabId });
      return;
    }

    let anyVisible = false;
    tabRows.forEach(({ code, row }) => {
      const matches = code.startsWith(typed);
      row.classList.toggle("vimzer-dim", !matches);
      if (matches) anyVisible = true;
    });

    if (!anyVisible) {
      typed = "";
      tabRows.forEach(({ row }) => row.classList.remove("vimzer-dim"));
      if (typedEl) typedEl.textContent = "_";
    }
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────────

  function reset() {
    mode = "idle";
    typed = "";
    hints.forEach(({ badge }) => badge.remove());
    hints = [];
    removeBar();
    if (tabPanel) {
      tabPanel.remove();
      tabPanel = null;
      tabRows = [];
    }
    const current = regionItems[regionIndex];
    if (current) current.classList.remove("vimzer-region-item");
    regionItems = [];
    regionIndex = -1;
  }

  function isEditable(el) {
    if (!el || el === document.body) return false;
    const tag = el.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

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

  function truncate(s, n) {
    return s && s.length > n ? s.slice(0, n - 1) + "…" : s || "";
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  // ─── UI elements ─────────────────────────────────────────────────────────────

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

  function showBar(modeLabel, innerHtml) {
    removeBar();
    bar = document.createElement("div");
    bar.className = "vimzer-statusbar";
    bar.innerHTML = `<span class="status-mode">${modeLabel}</span>${innerHtml}`;
    document.body.appendChild(bar);
  }

  function removeBar() {
    if (bar) {
      bar.remove();
      bar = null;
    }
  }

  function updateHintBar() {
    if (!bar) return;
    const typedEl = bar.querySelector("#vimzer-typed");
    const countEl = bar.querySelector("#vimzer-count");
    if (typedEl) typedEl.textContent = typed || "_";
    if (countEl) {
      const visible = hints.filter((h) => h.code.startsWith(typed)).length;
      countEl.textContent = `${visible} target${visible !== 1 ? "s" : ""}`;
    }
  }

  function toast(text) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = document.createElement("div");
    toastEl.className = "vimzer-toast";
    toastEl.textContent = text;
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(() => {
      toastEl?.remove();
      toastEl = null;
    }, TOAST_MS);
  }
})();
