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

## The 17 rules

1. **Header band, and its contrast is measurable.** Distinct background, bold, tracked, sticky
   on scroll, with a clear separator from the rows. **Target ≥7:1 against its own background.**
   This is not taste: a table shipped with a header at 3.19:1 while its rows sat at 6.45:1, and
   on a monitor turned down the header was simply invisible. Measure it; do not judge by eye on
   a bright screen. The old form of this rule also demanded the header out-contrast the rows,
   which quietly forbade a *light* band — once the band lightens, text on it necessarily
   contrasts less. What replaces that half is rule 16: the band must be its own shade.
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
   the user cannot tell it from having no data at all.
5. **A "Columns" button that creates columns**, not only hides them. A new user column becomes
   a real field in the database (a migration or a custom-fields table), not a UI-only ghost.
   Show/hide of existing columns lives here too — and **hiding a column drops that column's sort
   and its filter**, because that header was the only thing on screen saying either one existed:
   a list ordered by an invisible column, or trimmed to 14 of 35 rows with nothing explaining
   why, is the same bug twice. A column the **user** made can also be **removed**, not merely
   hidden: he made it, so he can unmake it, and hide-only leaves it in the stored document
   forever with no control anywhere that deletes it. A base column has data behind it and only
   hides.
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
12. **Every search box carries a ✕ inside its right edge**, and the box itself is findable by a
    hook — `type="search"` or `data-search` — never by an English word in its placeholder: a
    table written in another language is still a table that has to be checked., appearing only when there is text,
    Escape does the same. **It must restore the rows, not merely blank the field** — a
    button that empties the box while the filter stays applied is worse than no button, because
    then you believe you removed it. Test those two things separately. Hide the browser's own
    search-cancel glyph so there is one control, not two.
13. **Subtle vertical rules between header cells** so each column's extent is visible. A short
    dark tick, not a full-height line: at full height it turns the band into a grid and competes
    with the rule underneath. Around half the cell's height, and quieter than that rule.
14. **Dates display as "d Mmm YYYY"** — `4 Aug 2026`, `16 Aug 2026`, no leading zero — whatever
    the storage format is. Storage keeps its own shape; only the display is normalised. An
    unparseable date shows as it arrived, never as "Invalid Date", and range filtering works on
    the stored value rather than the printed text. **The month is written in the interface's own
    language** — a Romanian table prints `19 aug 2026` and obeys this rule exactly as much as an
    English one. What the rule fixes is the shape: day, month in letters, four-digit year. The
    letters are the point, because `03/04/2026` is the 3rd of April to one reader and the 4th of
    March to another, and a mixed-language interface is its own defect. Detection has to follow:
    `Date.parse` only knows English months, so a check built on it silently SKIPS a localised
    column — and a skipped check reads exactly like a passing one.
15. **Numeric columns align right, in a monospaced face, with `tabular-nums`.** Digits then sit
    in the same column down the whole list, so two magnitudes are comparable at a glance instead
    of being read digit by digit — which is the entire reason a price column exists. Proportional
    figures ragged on the left are what a spreadsheet has never once done. The values are what
    aligns right; the title above them is a title and stays centred with the rest (rule 2). Note
    that either mechanism does the job — `font-variant-numeric: tabular-nums` or
    `font-feature-settings: "tnum"` — and that one of them inherited from `body` covers the whole
    table.

16. **The header band is its own shade, measured.** Its background differs from the row
    background by a visible step — **ΔL\* ≥ 5**, which for a dark theme means roughly 10–20%
    lighter than the rows. "A different colour" is not enough: two colours can differ in hue and
    still read as the same surface on a screen turned down, which is where every one of these
    header failures has happened. The direction is a design choice — a light band over dark rows
    or the reverse — but the step has to be there, and it has to survive the theme swap.

17. **The column menu also places the text.** Alongside sorting and filtering, the menu carries:
    **horizontal alignment — left, centre, right**, chosen per column; and a **wrap toggle**,
    deciding whether a value keeps to one line or runs onto several. **Vertical alignment is not
    a choice**: cells are always centred vertically, so the eye tracks one line across a row of
    mixed-height cells. **None of it applies to the header**, which is fixed: centred on both
    axes, always wrapping (rule 2 makes it uppercase and bold, and a title that cannot wrap
    forces a column wider than its data ever needed). A numeric column starts right-aligned
    (rule 15) and a text column starts left-aligned; the menu is where that default is overridden,
    and the choice persists with the rest of the layout (rule 6).

## Traps that have already cost time

Read these before writing the code; every one shipped at least once.

- **Dates and time zones.** JavaScript reads `2026-06-28` as UTC midnight but `June 28, 2026` as
  *local* midnight. Mixing the two shifts a day — enough to print the wrong date and to drop a
  row from a range whose bounds came from the date picker. Reduce every date to its calendar day
  anchored at UTC before displaying, sorting or comparing it. Then both range bounds are plainly
  inclusive. Sorting dates as text lies too: `July 7, 2023` sorts after `2026-06-03`.
- **A missing date renders as EMPTY, never as a dash.** Rule 14 covers the date that cannot be
  read; this is the one that is not there. One "—" in a column of dates and the column stops
  reading as dates at all — to the eye, and to anything that decides what a column holds by
  looking at its values, this verifier included. An em dash elsewhere is fine and useful; in a
  date column it costs the column its identity. Leave the cell blank.
- **The sticky header and the frozen first column must share ONE scrollport.** `position: sticky`
  resolves against the nearest scrolling ancestor, so an `overflow-x` box that does not also own
  the vertical scroll kills the header exactly where the freeze begins: the page scrolls instead
  of the box, the band has nothing to stick to, and it leaves the top with a thousand pixels of
  rows still on screen. The vicious part is that a computed-style check stays green throughout —
  `position: sticky` is set, the element simply has nothing to stick against. Give the box a
  bounded height as well as `overflow: auto`, and drive **both planes at once, at several
  viewport widths**: a table that fits today starts scrolling the moment a derived column
  arrives, and reading the CSS will never tell you which box moved.
- **A menu that re-renders closes itself.** If clicking inside the menu rebuilds its innerHTML,
  the clicked node is detached by the time the event reaches `document`, so an outside-click
  handler sees a click from nowhere and closes the menu. Every tick closed it. Stamp the event
  in the **capture phase**, before any handler can orphan the target.
- **A menu taller than the window** hides its own lower controls. Cap the height and let it
  scroll.
- **The value list must exclude its own column's filter.** Otherwise unticking a value makes it
  vanish from the list along with its rows, and there is no way to tick it back. Excel excludes
  the column's own filter when building its list; do the same.
- **Persist a value filter as the EXCLUDED set, never as the accepted one.** They look identical
  on the screen where the ticks were made and diverge everywhere else. Store the accepted values
  and every value that had not been seen at that moment is stranded outside the set forever:
  filter Region, untick one City while Region is narrowing the list, then clear Region — every
  other region's cities are gone, with nothing on screen to tick them back. Rows that arrive
  later go the same way, which is worse, because nobody was there to watch it happen. A value
  passes unless it is named in the excluded list; an empty list is no filter at all.
- **Sorting must not fire from the menu handle or the resize grip.** They sit inside the header
  cell, and if they share a listener node, `stopPropagation` will not save you — guard on the
  target.
- **The clamp cannot live on the `<td>`.** A cell has to stay `display: table-cell`; put the
  line clamp on an inner box.
- **A debounced layout write dies with the document.** Column order, widths and row heights are
  written behind a debounce so a drag does not PUT once per pixel — and a page that unloads inside
  that window takes the pending write with it. The column dragged one moment before a reload came
  back forgotten, and the persistence looked broken when only its last 300ms were. Flush whatever
  is queued on `pagehide` **and** on `visibilitychange` (a backgrounded tab is frozen and may
  never fire `pagehide`), and send it with `keepalive`, or the navigation cancels the request the
  flush just started. Make the flush idempotent — whichever event comes first wins and the other
  finds nothing queued. Found because this verifier reloads inside that window itself, so any
  check of persistence is a check of the flush whether you meant it or not.
- **A derived column is a view, not data.** Recompute it from the row; storing the result
  duplicates values the source columns already own.

## Reference implementation

`reference/mechanics.md` carries the fiddly parts as copyable snippets — freeze panes, the
clamp, the column menu, the date handling — taken from a vanilla-JS table over a plain
`<table>` that implements all 15 rules and has hit every trap above.

There is deliberately no shared component yet: the rules are stack-agnostic, the code is not,
and one consumer does not justify a library. Extract one when a second table in the same stack
needs it — by then you will know what is worth abstracting.

## After every change to a table's formatting — ask

Whenever you change how a list looks or behaves — a colour, a spacing, a new control, a
different date format, anything — **ask the person you are working with whether the change
belongs in this standard** before you finish the turn. They decide; you propose.

Ask it concretely. Not "should I save this?" but the rule as it would be written:

> Add to the standard as rule 16: *"a currency column names its unit once, in the title, never
> in every row"*? Or does it stay in this project only?

Say which way you lean and why — a change driven by one project's data is usually local; a
change driven by how someone reads a table is usually a rule. (Rule 15 arrived exactly this way,
as "numeric columns align right", from one dashboard where they did not.)

If he says yes, the change lands in three places or it will drift apart:

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

**When you add a check, two things about the driving itself.** One: the checks share a page, so
one that tidies up disarms the next. Rule 11's block used to close the column menu with Escape,
and the menu holds the only search box on the page — so rule 12 found nothing, reported SKIP, and
the two behaviours it exists for went untested for as long as the output looked clean. Every block
that needs a control open now opens it itself. Two: a check that cannot fail is decoration. Break
the behaviour on purpose, watch the line turn FAIL, and only then trust the PASS — and where a
behaviour genuinely cannot be driven headlessly, say so as an explicit SKIP **with the reason**,
never by leaving it out.
