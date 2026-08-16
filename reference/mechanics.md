# Mechanics worth copying

Short notes on the parts that are fiddly to get right, lifted from a working vanilla-JS
implementation of all 14 rules.

## Freeze panes that follow the user's column order

Key it off position, not off a named column, so dragging a different column into place 1
freezes that one instead. The header corner has to outrank both.

```css
thead th            { position: sticky; top: 0; z-index: 10; background: var(--head); }
thead th:first-child{ left: 0; z-index: 12; }          /* the shared corner */
tbody td:first-child{ position: sticky; left: 0; z-index: 2; background: var(--bg); }
```

Row hover and selection must repaint the frozen cell too, or it stays the wrong colour while
the rest of the row lights up.

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

## Derived columns are a view

Store the definition (`{left, op, right}`) next to the column order and widths, and recompute on
render. Storing the result duplicates values the source columns already own and goes stale the
moment either one changes.
