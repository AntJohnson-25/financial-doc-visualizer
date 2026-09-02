# Handoff notes — dashboard rework (D3 + widgets)

Context for whoever picks this up next. The app is still plain vanilla JS/HTML/CSS,
no build step, no framework — everything loads via `<script>` tags in `index.html`
in dependency order.

## What's here now

- `charts.js` — owns `renderDashboard()`, the single entry point called by `app.js`
  after documents load. Builds per-category chart content (Chart.js bar +
  doughnut "share of total" + line trend) and hands it to `widgets.js` to display.
- `waterfall.js` — D3-built Revenue→Net Income bridge chart. Only D3 usage in the
  app; everything else is Chart.js.
- `widgets.js` — the free-form draggable/resizable glass widget system. Owns
  layout, drag/resize (via interact.js), collision-ghost effect, selection,
  and localStorage persistence (`fdv.widgetLayout`, keyed by docKey → widget id).
- `annotations.js` — pre-existing per-doc notes storage (`fdv.notes`), same
  localStorage pattern widgets.js followed.

## Gotchas hit during this build (don't re-discover these)

1. **cdnjs slug for interact.js is `interact.js`, not `interactjs`.**
   `https://cdnjs.cloudflare.com/ajax/libs/interact.js/1.10.27/interact.min.js`.
   Getting this wrong fails silently — no console error, `window.interact` is
   just `undefined` and drag/resize quietly do nothing. Check that first if
   dragging ever stops working after a version bump.

2. **Chart.js can't size a canvas inside a `display:none` container.** This is
   why chart construction is lazy — `charts.js` only calls `drawBarChart` /
   `drawCompositionChart` / `drawTrendChart` / `window.renderWaterfall` the
   *first time* a widget's `onToggle` fires with `expanded === true`, never
   at widget-creation time. If you add a new chart type to a widget, keep it
   behind that same lazy-init pattern.

3. **`[hidden]` needs an explicit CSS override if you also set `display` on the
   same element elsewhere.** Author CSS beats the UA `[hidden]{display:none}`
   at equal specificity, so `.widget-face`/`.widget-body` needed explicit
   `.widget-face[hidden], .widget-body[hidden] { display: none; }` rules — see
   style.css. If you add more toggle-by-`.hidden`-attribute elements, check
   this.

4. **Auto-layout has to dodge widgets restored at a saved position**, not just
   widgets it's placing in the same pass. `widgets.js`'s `placedRects` array
   is the fix — a saved/restored widget's rect gets pushed into it even
   though it skips the packer, so freshly-placed widgets don't spawn under it.

5. **`user-select: none` is required on drag handles** (`.widget-header`,
   `.widget-face`) or a click-drag just selects text instead of moving the
   widget.

6. **Browser-automation "drag" (CDP mouse simulation) does not trigger
   interact.js.** interact.js listens for `PointerEvent`s; CDP's synthesized
   mouse drag apparently doesn't fire matching pointer events. To test
   drag/resize programmatically, dispatch real `PointerEvent`s
   (`pointerdown` → `pointermove` × N → `pointerup`) via `javascript_tool`
   instead of the `computer` tool's `left_click_drag`.

## Known gaps / possible next steps

- Only the widget *chrome* (title, KPI value/label) gets bigger text on
  selection — chart-internal fonts (axis ticks, legend, tooltip) don't scale,
  since that would mean rebuilding the Chart.js instance rather than a CSS
  change. Flag this to the user if "bigger text" needs to reach inside charts.
- The re-opened upload bar (`.composer-wrap.force-visible`) is positioned with
  a hardcoded `left: 280px` / `56px` matching the sidebar's default/collapsed
  width — it does **not** track the sidebar's manual resize (`resize:
  horizontal` on `.sidebar`), so it can visually overlap a hand-widened
  sidebar. Minor, not fixed.
- No "reset/auto-arrange layout" affordance — if a user's saved layout gets
  into a bad state (e.g. a widget dragged off-canvas before a restrictRect fix),
  the only recovery today is clearing `localStorage['fdv.widgetLayout']` by hand.
- Not tested on touch/mobile — interact.js supports it, and `touch-action:
  none` is set on `.widget`, but nobody's actually verified pinch/drag on a
  touchscreen.
- The D3 waterfall only appears when both a `Revenue` and `Expenses` category
  are present in the loaded document(s). Cash-flow-only or balance-sheet-only
  documents won't get one — that's intentional (nothing to bridge), not a bug.
