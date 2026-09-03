// Turns the dashboard into a free-form canvas of draggable, resizable
// "glass" widgets. Each widget shows a compact KPI face by default and
// flips to its full interactive chart content on click. Positions/sizes
// persist per document set, same pattern as annotations.js's per-doc notes.
(function () {
  const LAYOUT_KEY = "fdv.widgetLayout";
  const DEFAULT_COLLAPSED = { w: 300, h: 190 };
  const DEFAULT_EXPANDED = { w: 460, h: 420 };
  const GAP = 20;

  let widgets = [];
  let zCounter = 10;
  let selectedWidget = null;
  let layoutCursor = { x: GAP, y: GAP, rowHeight: 0 };
  let placedRects = [];
  let canvasInitialized = null;
  let dashboardCanvasEl = null;

  // Widgets are position:absolute, so the dashboard's own height never
  // grows to contain them — without this, anything packed below the
  // viewport is just clipped by .results' overflow instead of being
  // reachable by scrolling.
  function updateCanvasHeight() {
    if (!dashboardCanvasEl) return;
    const maxBottom = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    dashboardCanvasEl.style.minHeight = maxBottom + GAP + "px";
  }

  function loadAllLayouts() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveLayout(docKey, id, rect) {
    try {
      const all = loadAllLayouts();
      if (!all[docKey]) all[docKey] = {};
      all[docKey][id] = rect;
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
    } catch (e) {
      // localStorage unavailable — layout just won't persist across reloads.
    }
  }

  function getSavedRect(docKey, id) {
    const all = loadAllLayouts();
    return (all[docKey] && all[docKey][id]) || null;
  }

  // Removes a single widget created on demand outside the normal
  // renderDashboard() rebuild (e.g. insights.js's report widget) — every
  // other widget is torn down wholesale by resetWidgetCanvas instead, so
  // nothing else needs a one-off removal path.
  window.removeWidget = function removeWidget(widget) {
    if (!widget) return;
    const idx = widgets.indexOf(widget);
    if (idx !== -1) widgets.splice(idx, 1);
    if (selectedWidget === widget) selectedWidget = null;
    if (window.interact) {
      try {
        interact(widget.el).unset();
      } catch (e) {
        // already unset / never had interact bound — nothing to clean up.
      }
    }
    widget.el.remove();
    updateCanvasHeight();
  };

  window.clearWidgetLayout = function clearWidgetLayout(docKey) {
    try {
      const all = loadAllLayouts();
      delete all[docKey];
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
    } catch (e) {
      // localStorage unavailable — nothing to clear.
    }
  };

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function overlapsAny(rect) {
    return placedRects.some((r) => rectsOverlap(rect, r));
  }

  // Simple shelf packer that also dodges widgets already restored at a
  // saved (possibly hand-placed) position, so a fresh widget never spawns
  // underneath one the user previously dragged or expanded.
  function nextAutoPosition(canvasEl, w, h) {
    const canvasWidth = canvasEl.clientWidth || 1200;
    let guard = 0;
    while (guard++ < 500) {
      if (layoutCursor.x + w > canvasWidth - GAP && layoutCursor.x > GAP) {
        layoutCursor.x = GAP;
        layoutCursor.y += layoutCursor.rowHeight + GAP;
        layoutCursor.rowHeight = 0;
      }
      const candidate = { x: layoutCursor.x, y: layoutCursor.y, w, h };
      if (!overlapsAny(candidate)) {
        layoutCursor.x += w + GAP;
        layoutCursor.rowHeight = Math.max(layoutCursor.rowHeight, h);
        placedRects.push(candidate);
        return { x: candidate.x, y: candidate.y };
      }
      layoutCursor.x += w + GAP;
    }
    const fallback = { x: layoutCursor.x, y: layoutCursor.y };
    placedRects.push({ x: fallback.x, y: fallback.y, w, h });
    return fallback;
  }

  window.resetWidgetCanvas = function resetWidgetCanvas(canvasEl) {
    canvasEl.innerHTML = "";
    canvasEl.style.minHeight = "";
    widgets = [];
    selectedWidget = null;
    zCounter = 10;
    layoutCursor = { x: GAP, y: GAP, rowHeight: 0 };
    placedRects = [];
    dashboardCanvasEl = canvasEl;

    if (canvasInitialized !== canvasEl) {
      canvasEl.addEventListener("pointerdown", (e) => {
        if (e.target === canvasEl) deselectAll();
      });
      canvasInitialized = canvasEl;
    }
  };

  function deselectAll() {
    widgets.forEach((w) => w.el.classList.remove("widget--selected"));
    selectedWidget = null;
  }

  function selectWidget(widget) {
    if (selectedWidget === widget) return;
    widgets.forEach((w) => w.el.classList.remove("widget--selected"));
    widget.el.classList.add("widget--selected");
    widget.el.style.zIndex = ++zCounter;
    selectedWidget = widget;
  }

  function clearGhosts() {
    widgets.forEach((w) => w.el.classList.remove("widget--ghost"));
  }

  function updateGhosts(activeWidget) {
    const a = activeWidget.el.getBoundingClientRect();
    let overlapping = false;
    widgets.forEach((w) => {
      if (w === activeWidget) return;
      const b = w.el.getBoundingClientRect();
      const intersects = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      w.el.classList.toggle("widget--ghost", intersects);
      if (intersects) overlapping = true;
    });
    activeWidget.el.classList.toggle("widget--ghost", overlapping);
  }

  function setExpanded(widget, expanded) {
    widget.expanded = expanded;
    widget.el.classList.toggle("widget--collapsed", !expanded);
    widget.el.classList.toggle("widget--expanded", expanded);
    widget.faceEl.hidden = expanded;
    widget.bodyEl.hidden = !expanded;
    widget.toggleBtn.textContent = expanded ? "⤡" : "⤢";
    widget.toggleBtn.setAttribute("aria-label", expanded ? "Collapse" : "Expand");

    if (expanded && !widget.userResized) {
      const size = widget.expandedSize || DEFAULT_EXPANDED;
      applyRect(widget, widget.x, widget.y, size.w, size.h);
    }
    persist(widget);
    if (widget.onToggle) widget.onToggle(expanded);
  }

  function applyRect(widget, x, y, w, h) {
    widget.x = x;
    widget.y = y;
    widget.w = w;
    widget.h = h;
    widget.el.style.left = x + "px";
    widget.el.style.top = y + "px";
    widget.el.style.width = w + "px";
    widget.el.style.height = h + "px";
    updateCanvasHeight();
  }

  function persist(widget) {
    saveLayout(widget.docKey, widget.id, {
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
      expanded: widget.expanded,
    });
  }

  // Shared chrome (positioning, drag, resize, select, persist, expand
  // toggle) for both the single-body widget and the swipeable stack
  // widget below — they differ only in what goes inside .widget-body.
  function mountWidget(canvasEl, el, opts) {
    canvasEl.appendChild(el);

    const widget = {
      id: opts.id,
      docKey: opts.docKey,
      el,
      faceEl: el.querySelector(".widget-face"),
      bodyEl: el.querySelector(".widget-body"),
      toggleBtn: el.querySelector(".widget-toggle"),
      expanded: false,
      userResized: false,
      onToggle: opts.onToggle,
      onResize: opts.onResize,
      expandedSize: opts.expandedSize || null,
      x: GAP,
      y: GAP,
      w: DEFAULT_COLLAPSED.w,
      h: DEFAULT_COLLAPSED.h,
    };
    widgets.push(widget);

    const saved = getSavedRect(opts.docKey, opts.id);
    if (saved) {
      applyRect(widget, saved.x, saved.y, saved.w, saved.h);
      widget.userResized = true;
      placedRects.push({ x: saved.x, y: saved.y, w: saved.w, h: saved.h });
      if (saved.expanded) setExpanded(widget, true);
    } else {
      const pos = nextAutoPosition(canvasEl, DEFAULT_COLLAPSED.w, DEFAULT_COLLAPSED.h);
      applyRect(widget, pos.x, pos.y, DEFAULT_COLLAPSED.w, DEFAULT_COLLAPSED.h);
    }

    function toggle() {
      setExpanded(widget, !widget.expanded);
    }
    widget.toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    widget.faceEl.addEventListener("click", toggle);

    el.addEventListener("pointerdown", () => selectWidget(widget));

    if (window.interact) {
      interact(el)
        .draggable({
          allowFrom: ".widget-header, .widget-face",
          listeners: {
            start() {
              el.classList.add("widget--dragging");
              selectWidget(widget);
            },
            move(event) {
              applyRect(widget, widget.x + event.dx, widget.y + event.dy, widget.w, widget.h);
              updateGhosts(widget);
            },
            end() {
              el.classList.remove("widget--dragging");
              clearGhosts();
              persist(widget);
            },
          },
          modifiers: [interact.modifiers.restrictRect({ restriction: "parent" })],
        })
        .resizable({
          edges: { left: true, right: true, top: true, bottom: true },
          margin: 10,
          listeners: {
            start() {
              el.classList.add("widget--resizing");
              widget.userResized = true;
              selectWidget(widget);
            },
            move(event) {
              applyRect(
                widget,
                widget.x + event.deltaRect.left,
                widget.y + event.deltaRect.top,
                event.rect.width,
                event.rect.height
              );
              updateGhosts(widget);
              if (widget.onResize) widget.onResize();
            },
            end() {
              el.classList.remove("widget--resizing");
              clearGhosts();
              persist(widget);
            },
          },
          modifiers: [
            interact.modifiers.restrictSize({ min: { width: 220, height: 150 } }),
            interact.modifiers.restrictEdges({ outer: "parent" }),
          ],
        });
    }

    return widget;
  }

  window.createWidget = function createWidget(canvasEl, opts) {
    const el = document.createElement("div");
    el.className = "widget widget--collapsed";
    el.innerHTML =
      '<div class="widget-header"><span class="widget-title"></span><button type="button" class="widget-toggle" aria-label="Expand">⤢</button></div>' +
      '<div class="widget-face">' +
      '<div class="widget-kpi-value"></div>' +
      '<div class="widget-kpi-label"></div>' +
      '<div class="widget-kpi-hint">Click to view chart</div>' +
      "</div>" +
      '<div class="widget-body" hidden></div>';

    el.querySelector(".widget-title").textContent = opts.title;
    el.querySelector(".widget-kpi-value").textContent = opts.kpiValue;
    el.querySelector(".widget-kpi-label").textContent = opts.kpiLabel;
    el.querySelector(".widget-body").appendChild(opts.bodyEl);

    return mountWidget(canvasEl, el, opts);
  };

  // A widget whose body pages through several related slides (e.g. a
  // category's chart and its "trend across periods" chart) instead of
  // spawning as separate widgets on the canvas. Navigable by arrow
  // buttons (desktop), dot clicks, or a horizontal swipe/drag (touch and
  // mouse) — same control surface either way.
  //
  // opts.slides: [{ label, bodyEl, onShow }], onShow called once, the
  // first time that slide's widget is expanded (lazy chart init).
  window.createStackedWidget = function createStackedWidget(canvasEl, opts) {
    const slides = opts.slides;
    const multi = slides.length > 1;

    const el = document.createElement("div");
    el.className = "widget widget--collapsed";
    el.innerHTML =
      '<div class="widget-header"><span class="widget-title"></span><button type="button" class="widget-toggle" aria-label="Expand">⤢</button></div>' +
      '<div class="widget-face">' +
      '<div class="widget-kpi-value"></div>' +
      '<div class="widget-kpi-label"></div>' +
      '<div class="widget-kpi-hint">Click to view chart</div>' +
      "</div>" +
      '<div class="widget-body widget-body--stack" hidden>' +
      (multi
        ? '<div class="widget-stack-nav">' +
          '<button type="button" class="widget-stack-arrow widget-stack-prev" aria-label="Previous">‹</button>' +
          '<span class="widget-stack-label"></span>' +
          '<button type="button" class="widget-stack-arrow widget-stack-next" aria-label="Next">›</button>' +
          "</div>"
        : "") +
      '<div class="widget-stack-viewport"><div class="widget-stack-track"></div></div>' +
      (multi ? '<div class="widget-stack-dots"></div>' : "") +
      "</div>";

    el.querySelector(".widget-title").textContent = opts.title;
    el.querySelector(".widget-kpi-value").textContent = opts.kpiValue;
    el.querySelector(".widget-kpi-label").textContent = opts.kpiLabel;

    const track = el.querySelector(".widget-stack-track");
    const viewport = el.querySelector(".widget-stack-viewport");
    const labelEl = el.querySelector(".widget-stack-label");
    const dotsEl = el.querySelector(".widget-stack-dots");
    const prevBtn = el.querySelector(".widget-stack-prev");
    const nextBtn = el.querySelector(".widget-stack-next");

    const slideEls = slides.map((slide) => {
      const slideEl = document.createElement("div");
      slideEl.className = "widget-stack-slide";
      slideEl.appendChild(slide.bodyEl);
      track.appendChild(slideEl);
      return slideEl;
    });

    const dotEls = multi
      ? slides.map((slide, i) => {
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = "widget-stack-dot";
          dot.setAttribute("aria-label", slide.label || "Slide " + (i + 1));
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            goTo(i);
          });
          dotsEl.appendChild(dot);
          return dot;
        })
      : [];

    let activeIndex = 0;
    const shown = new Set();

    // `init` skips lazy chart init — used only for the construction-time
    // call below, before the widget has ever been expanded, when the
    // body is still hidden and a canvas couldn't size itself correctly.
    // Every user-triggered navigation (arrows/dots/swipe) only happens
    // once the widget is already expanded, so those calls always init.
    function goTo(index, { init } = {}) {
      activeIndex = Math.max(0, Math.min(slides.length - 1, index));
      track.style.transform = "translateX(-" + activeIndex * 100 + "%)";
      if (labelEl) labelEl.textContent = slides[activeIndex].label || "";
      if (prevBtn) prevBtn.disabled = activeIndex === 0;
      if (nextBtn) nextBtn.disabled = activeIndex === slides.length - 1;
      dotEls.forEach((dot, i) => dot.classList.toggle("widget-stack-dot--active", i === activeIndex));
      if (!init && !shown.has(activeIndex)) {
        shown.add(activeIndex);
        if (slides[activeIndex].onShow) slides[activeIndex].onShow();
      }
    }

    if (multi) {
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goTo(activeIndex - 1);
      });
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goTo(activeIndex + 1);
      });

      // Pointer-based swipe covers touch and mouse drag alike. Only
      // horizontal gestures that clear a small threshold change slides,
      // so vertical scrolling inside a slide (e.g. the trend legend
      // details list) isn't hijacked.
      let dragStart = null;
      viewport.style.touchAction = "pan-y";
      viewport.addEventListener("pointerdown", (e) => {
        dragStart = { x: e.clientX, y: e.clientY };
      });
      viewport.addEventListener("pointerup", (e) => {
        if (!dragStart) return;
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        dragStart = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          goTo(activeIndex + (dx < 0 ? 1 : -1));
        }
      });
      viewport.addEventListener("pointercancel", () => {
        dragStart = null;
      });
    }

    const widget = mountWidget(canvasEl, el, {
      id: opts.id,
      docKey: opts.docKey,
      expandedSize: opts.expandedSize,
      onResize: opts.onResize,
      onToggle: (expanded) => {
        if (expanded && !shown.has(activeIndex)) {
          shown.add(activeIndex);
          if (slides[activeIndex].onShow) slides[activeIndex].onShow();
        }
        if (opts.onToggle) opts.onToggle(expanded);
      },
    });

    goTo(0, { init: true });
    return widget;
  };
})();
