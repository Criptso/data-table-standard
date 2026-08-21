# Mechanics worth copying

Short notes on the parts that are fiddly to get right, lifted from a working vanilla-JS
implementation of all 15 rules.

## One scrollport, both planes

Everything below depends on this box. `position: sticky` resolves against the nearest scrolling
ancestor, so the header band and the frozen column are only both live inside the *same*
scrollport — and that box has to own the **vertical** scroll as well as the horizontal one. Give
it `overflow: auto` and a bounded height; with the height left off, the page scrolls instead, the
header has nothing to stick to, and it slides off the top while the rows keep coming.

```css
/* the reading window is the room between the app's fixed bands */
.tbl-scroll { overflow: auto;
              max-height: calc(100dvh - var(--rail-h) - var(--footer-h) - var(--gap)); }
```

Two failure modes it is worth knowing you have avoided: `overflow-x: auto` alone (horizontal
freeze works, sticky header dies), and a box that only becomes a scrollport below some
breakpoint — a table widened by one derived column then hangs off its panel at full width instead
of scrolling inside it.

## Freeze panes that follow the user's column order

Key it off position, not off a named column, so dragging a different column into place 1
freezes that one instead. The header corner has to outrank both.

```css
thead th            { position: sticky; top: 0; z-index: 10; background: var(--head); }
thead th:first-child{ left: 0; z-index: 12; }          /* the shared corner */
tbody td:first-child{ position: sticky; left: 0; z-index: 2; background: var(--bg); }
```

`top: 0`, not the height of the app's header bar: inside a scrollport, sticky is measured from
the box. Row hover and selection must repaint the frozen cell too, or it stays the wrong colour
while the rest of the row lights up.

The frozen column paints over whatever scrolls under it, which is the point — and the trap for
anything driving the table. A header control that is off-screen sideways is not merely out of
sight, it is *underneath* the frozen column, so a click at its coordinates lands on the frozen
cell instead. Scroll the header into view first (`scrollIntoView({inline: "center"})`), then
click. Miss this and a mis-aimed click reads as a dead control: the menu silently fails to open
and every later step drives the previous column's menu.

## Short columns keep their width, long text yields

`width: 1%` asks an auto-layout table for the narrowest fit that still holds the content, which
is what "never wrap this column" means in practice.

```css
thead th.short { width: 1%; }                 /* dates, counts, ticks, links, pills */
thead th.wrap  { min-width: 120px; }          /* long text shrinks first */
tbody td.wrap  { white-space: normal; overflow-wrap: anywhere; }
tbody td       { white-space: nowrap; }
```

A hand-set width pins the column with `min = max = width` and lets its content wrap inside, so
dragging narrow is an answer rather than a broken layout. Generate that into a `<style>` block
keyed by a per-column class; do not write inline styles onto every cell.

## The three-line clamp

The clamp cannot sit on the `<td>` — a cell has to stay `display: table-cell`. Put it on an
inner box, and drive the line count from a custom property so a row can be dragged taller by
raising the number of lines rather than by adding empty pixels.

```css
td.wrap .clamp { display: -webkit-box; -webkit-box-orient: vertical;
                 -webkit-line-clamp: var(--lines, 3); overflow: hidden; }
```

```js
// one row taller = more of its text, and it survives a column resize
`tr[data-id="${id}"] td { --lines: ${n} }`
```

Only offer the hover reveal where `scrollHeight > clientHeight + 1`. The floating panel must be
`pointer-events: none` or it will swallow the click that opens the row.

## A menu that re-renders itself

Stamp the event while it is still travelling down, before any handler can replace the menu's
innerHTML and orphan the node the click came from.

```js
menu.addEventListener("click", e => { e.fromColMenu = true; }, true);   // capture
document.addEventListener("click", e => {
  if (!menu.hidden && !e.fromColMenu && !e.target.closest("[data-cmenu]")) close();
});
```

Cap the menu's height (`max-height: min(78vh, 620px); overflow-y: auto`) or its lower controls
end up off-screen and unreachable.

## The value list ignores its own column

Otherwise unticking a value removes it from the list along with its rows, and there is no way
back. Build the list from rows filtered by *every other* column's filter.

## Dates: one calendar day, anchored at UTC

`Date.parse` reads `2026-06-28` as UTC midnight and `June 28, 2026` as local midnight. Reduce
both to the same thing before displaying, sorting or comparing.

```js
function dayMs(v) {
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);                       // parsed local: keep that calendar day
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}
```

With every value on a UTC day boundary, both range bounds are plainly inclusive: `ms < from` and
`ms > to`. Sort dates through `dayMs` as well — as text, `July 7, 2023` sorts after `2026-06-03`.

## Guard the header's other controls

The sort listener, the drag-reorder listener, the resize grip and the menu handle all live on
the same header cell. Listeners on the same node do not stop each other, so each handler has to
check the target itself:

```js
if (e.target.closest(".rz") || e.target.closest("[data-cmenu]")) return;
```

## The layout write that survives the way out

Order, widths and row heights go behind a debounce, so a drag does not PUT per pixel. Keep the
queued document in a ref, and flush it on the way out — `keepalive`, or the navigation cancels the
request the flush just started.

```js
const pending = useRef(null);                 // the document the timer is holding
const save = (doc) => {                       // called by every layout change
  pending.current = doc;
  clearTimeout(timer.current);
  timer.current = setTimeout(() => { pending.current = null; put(doc); }, 300);
};

useEffect(() => {
  const flush = () => {
    const queued = pending.current;
    clearTimeout(timer.current);
    pending.current = null;                   // idempotent: the second event finds nothing
    if (queued) void put(queued, { keepalive: true });
  };
  // pagehide misses the way a phone actually leaves: backgrounded, the tab is frozen
  const hidden = () => { if (document.visibilityState === "hidden") flush(); };
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", hidden);
  return () => {
    removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", hidden);
    flush();                                  // and on unmount
  };
}, []);
```

`put` is a plain `fetch(url, { method: "PUT", body, keepalive })` — `keepalive` is the whole point
of the second argument, and a `fetch` started in `pagehide` without it dies with the document.

## Derived columns are a view

Store the definition (`{left, op, right}`) next to the column order and widths, and recompute on
render. Storing the result duplicates values the source columns already own and goes stale the
moment either one changes.
