---
name: data-table
description: >-
  The house standard for any multi-column list, in any app and any stack: sticky high-contrast
  header, click-to-sort, a per-column menu (filter by value, search, date range, derived
  columns), frozen first column, add-column that reaches the database, smart widths with
  Excel-style wrap, a 3-line cap per cell with hover reveal, resizable rows and columns,
  right-aligned tabular figures, and one date format. Use BEFORE building or changing any table, grid, or list with more than one
  column — dashboards, admin screens, inventory, reports, invoices, anything with rows. Also
  use when a table already exists and is being reviewed, extended, or restyled, and whenever
  someone says the list should behave "like Excel" or "like Sheets". Ships a browser-driven
  verification suite that is the done-gate: a styled dead control photographs exactly like a
  live one.
---

# Data tables

Published at <https://github.com/Criptso/data-table-standard>. Every edit to this directory is
committed and pushed automatically, so treat it as public the moment you save.

People who live in Sheets and Excel judge every other list against them. One that cannot be
sorted, filtered or reshaped forces them to export the data to work with it, so a generated app
fails the same way every time. Each rule here was missing at least once and cost a round trip.

**Stylise them into the app's own visual language.** This is a behaviour standard, not a
skin — a generic grey grid dropped into a designed product fails a different rule.

## When this applies

Any list with more than one column, whatever the domain and whatever the stack. If you are
about to write `<table>`, a data grid, a `.map()` over rows, or reach for a grid component,
read this first and plan the schema for custom fields and per-user column preferences from the
start — retrofitting persistence is the expensive half.

## The 15 rules

1. **Header band, and its contrast is measurable.** Distinct background, bold, tracked, sticky
   on scroll, with a clear separator from the rows. **The header must be brighter than the rows
   it labels** — target ≥7:1 against its own background. This is not taste: a table shipped with
   a header at 3.19:1 while its rows sat at 6.45:1, and on a monitor turned down the header was
   simply invisible. Measure it; do not judge by eye on a bright screen.
2. **Column titles centred, bold, UPPERCASE** unless that table's brief says otherwise.
3. **Click the title to sort**, asc/desc, with a direction indicator, and the active column
   visibly marked. Corollary that bites: **if the default sort is on a field with no visible
   column, nobody can tell how the list is ordered** — either sort by a visible column or say
   somewhere what the order is.
4. **A per-column menu**, opened from a mark beside the title, Sheets style: tick/untick the
   distinct values as a filter (with select-all and counts), search within the column, sort,
   and derive a new column together with another column. The menu is where a column becomes
   manipulable — not a second home for sorting. Two things the search inside it has to do, or
   it is a second control rather than the same one: **it matches the word the cell DISPLAYS**,
   not only the value the row stores — a status printed "In market" over a row that says
   `in_market` must be findable by typing what is on screen — and **it narrows the tick list as
   you type**, so the values and the search read as one thing. A list that does not move while
   the rows do says the field is dead. And when the filters empty the body, **the table states
   "No rows match the filters"** instead of showing nothing: an empty body reads as broken, and
   the operator cannot tell it from having no data.
5. **A "Columns" button that creates columns**, not only hides them. A new user column becomes
   a real field in the database (a migration or a custom-fields table), not a UI-only ghost.
   Show/hide of existing columns lives here too — and **hiding a column drops that column's
   sort and its filter**, because the header that was gone was the only thing on screen saying
   either existed: a list ordered by an invisible column, or trimmed to 14 of 35 rows with
   nothing explaining why, is the same bug twice. A column the **user** made can also be
   **removed**, not merely hidden: he made it, so he can unmake it, and hide-only leaves it in
   the stored document forever with no control anywhere that deletes it. A base column has data
   behind it and only hides.
6. **Drag & drop reordering**, order persisted per user.
7. **The first column freezes** on horizontal scroll. "First" means the current position, not a
   named column: if the user drags another column into position 1, that one freezes. With the
   sticky header this is Excel's freeze panes, so the shared corner must sit above both.
8. **Three lines of text per cell**, so no single long value blows up its row and the list stays
   scannable. The cap bounds the height — it does not pad short rows out to three lines, and a
   row of one-word cells should stay short. Hovering a
   cell reveals the rest — no click, no drawer. Only cells actually clipped may react, or short
   cells sprout tooltips for nothing. The user can still raise a row's height permanently, and
   that height persists.
9. **Smart widths with Excel wrap.** The table fits its window without cutting information:
   short values (dates, numbers, ticks, ids) keep their natural width and never wrap; long text
   yields first, shrinking and then wrapping over several lines. The user can always drag a
   column wider, persisted — the safety net for when the algorithm guesses wrong.
10. **The menu mark is a CIRCLE, not a chevron.** The sort indicator beside it is already a
    triangle, and two triangles a few pixels apart read as one control. Make it slightly larger
    than the arrow, and **fill it while that column filters** (○ → ●) so the header says two
    different things in two different shapes: what orders the list, and what hides rows.
11. **Date columns filter by range, not by ticking values** — every row tends to carry its own
    date, so the list is as long as the table and answers nothing. Offer periods (last 7 days /
    30 days / 3 months / 12 months) and an exact from/to on the browser's native date input. A
    period is just a "from" N days back with the end open, so it writes into the from box and
    stays adjustable. "To" covers its whole day.
12. **Every search box carries a ✕ inside its right edge**, appearing only when there is text,
    with Escape doing the same. **It must restore the rows, not merely blank the field** — a
    button that empties the box while the filter stays applied is worse than no button, because
    then you believe you removed it. Test those two things separately. Hide the browser's own
    search-cancel glyph so there is one control, not two.
13. **Subtle vertical rules between header cells** so each column's extent is visible. A short
    dark tick, not a full-height line: at full height it turns the band into a grid and competes
    with the rule underneath. Around half the cell's height, and quieter than that rule.
14. **Dates display as "d Mmm YYYY"** — `4 Aug 2026`, `16 Aug 2026`, no leading zero — whatever
    the storage format is. Storage keeps its own shape; only the display is normalised. An
    unparseable date shows as it arrived, never as "Invalid Date", and range filtering works on
    the stored value rather than the printed text.

## Traps that have already cost time

Read these before writing the code; every one shipped at least once.

- **Dates and time zones.** JavaScript reads `2026-06-28` as UTC midnight but `June 28, 2026` as
  *local* midnight. Mixing the two shifts a day — enough to print the wrong date and to drop a
  row from a range whose bounds came from the date picker. Reduce every date to its calendar day
  anchored at UTC before displaying, sorting or comparing it. Then both range bounds are plainly
  inclusive. Sorting dates as text lies too: `July 7, 2023` sorts after `2026-06-03`.
- **A menu that re-renders closes itself.** If clicking inside the menu rebuilds its innerHTML,
  the clicked node is detached by the time the event reaches `document`, so an outside-click
  handler sees a click from nowhere and closes the menu. Every tick closed it. Stamp the event
  in the **capture phase**, before any handler can orphan the target.
- **A menu taller than the window** hides its own lower controls. Cap the height and let it
  scroll.
- **The value list must exclude its own column's filter.** Otherwise unticking a value makes it
  vanish from the list along with its rows, and there is no way to tick it back. Excel excludes
  the column's own filter when building its list; do the same.
- **Sorting must not fire from the menu handle or the resize grip.** They sit inside the header
  cell, and if they share a listener node, `stopPropagation` will not save you — guard on the
  target.
- **The clamp cannot live on the `<td>`.** A cell has to stay `display: table-cell`; put the
  line clamp on an inner box.
- **A derived column is a view, not data.** Recompute it from the row; storing the result
  duplicates values the source columns already own.

## Reference implementation

`reference/mechanics.md` carries the fiddly parts as copyable snippets — freeze panes, the
clamp, the column menu, the date handling — taken from a vanilla-JS table over a plain
`<table>` that implements all 14 rules and has hit every trap above.

There is deliberately no shared component yet: the rules are stack-agnostic, the code is not,
and one consumer does not justify a library. Extract one when a second table in the same stack
needs it — by then you will know what is worth abstracting.

## After every change to a table's formatting — ask

Whenever you change how a list looks or behaves — a colour, a spacing, a new control, a
different date format, anything — **ask the person you are working with whether the change
belongs in this standard** before you finish the turn. They decide; you propose.

Ask it concretely. Not "should I save this?" but the rule as it would be written:

> Add to the standard as rule 15: *"numeric columns align right"*? Or does it stay in this
> project only?

Say which way you lean and why — a change driven by one project's data is usually local; a
change driven by how someone reads a table is usually a rule.

If he says yes, the change lands in four places or it will drift apart:

1. this file — the rule, with the reason it exists
2. `scripts/verify-table.mjs` — a check for it, or the rule is a wish rather than a gate
3. wherever your own agent memory keeps the canonical list, if you keep one

A rule with no check in the verifier is the failure mode this standard exists to prevent.

## The done-gate

**Verify by driving the table, never by screenshot.** Sorting, dragging, resizing and filtering
are exactly the controls that ship as markup and CSS with no listener behind them, and a dead
control photographs exactly like a live one.

```
npm install            # once, in this directory
node scripts/verify-table.mjs <url> [config.json]
```

It opens the page in headless Chrome, measures the header contrast, and drives every rule it can
find, printing PASS / FAIL / SKIP with the numbers it measured. Rules whose feature is absent
are reported as **MISSING**, not skipped quietly — that is the point of the gate. Selectors are
configurable for apps that do not use a plain `<table>`; run it with `--help` for the shape.

Run it under a second time zone as well when the table has dates:

```
TZ=America/Los_Angeles node scripts/verify-table.mjs <url>
```

Report the output as evidence. "I checked it" is not evidence.
