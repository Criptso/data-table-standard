#!/usr/bin/env node
/**
 * Drives a data table against the house standard and prints what it measured.
 *
 *   node verify-table.mjs <url> [config.json]
 *   node verify-table.mjs --help
 *
 * A rule whose feature cannot be found is reported MISSING, not skipped: an unbuilt control
 * and a broken one both fail the gate, and only one of them is obvious from a screenshot.
 * A rule that does not apply to this table (no date column, one row) is SKIP.
 */
import { readFileSync } from "node:fs";

const puppeteer = await import("puppeteer-core").then(m => m.default ?? m).catch(() => {
  console.error("puppeteer-core is missing. Run `npm install` in the skill directory.");
  process.exit(2);
});

const HELP = `
verify-table.mjs <url> [config.json]

config.json (every key optional; these are the defaults):
{
  "sel": {
    "table":      "table",
    "head":       "thead th",
    "rows":       "tbody tr",
    "scroller":   null,                 // auto: nearest scrollable ancestor of the table
    "menuHandle": "[data-cmenu], .cmenu, [data-column-menu]",
    "menu":       "#colFilterMenu, [role=menu], .column-menu",
    "colGrip":    ".rz, [data-col-resize]",
    "rowGrip":    ".rowrz, [data-row-resize]",
    "search":     "input[data-search], input[type=search], input[placeholder*='search' i], input[placeholder*='contains' i]",
    "clear":      ".xclr, [data-clears], button[aria-label*='clear' i]",
    "rangeReset": "[data-range-reset], [data-clears-range]",
    "addColumn":  "[data-add-column], #addColBtn",
    "newColumn":  "[data-newcol], input[placeholder*='new column' i]",
    "colRemove":  "[data-col-del], [data-column-remove]",
    "emptyRow":   "[data-empty], .tbl-empty, [data-empty-state]",
    "actions":    "[data-col-role=actions]",   // the row-actions column: header AND cells
    "columnsBtn": null                  // auto: a button outside the table saying "columns"
  },
  "chrome": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "viewport": { "width": 1200, "height": 850 },
  "cookies": [],                        // e.g. a session: [{ "name": "sid", "value": "…", "url": "<origin>" }]
  "storage": {}                         // localStorage keys set before every load, e.g. { "lang": "en" }
}
`;

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === "--help" || argv[0] === "-h") { console.log(HELP); process.exit(argv.length ? 0 : 1); }

const cfg = argv[1] ? JSON.parse(readFileSync(argv[1], "utf8")) : {};
const SEL = {
  table: "table", head: "thead th", rows: "tbody tr", scroller: null,
  menuHandle: "[data-cmenu], .cmenu, [data-column-menu]",
  menu: "#colFilterMenu, [role=menu], .column-menu",
  colGrip: ".rz, [data-col-resize]", rowGrip: ".rowrz, [data-row-resize]",
  // a hook, not an English word: a table written in Romanian still has to be checkable
  search: "input[data-search], input[type=search], input[placeholder*='search' i], input[placeholder*='contains' i]",
  clear: ".xclr, [data-clears], button[aria-label*='clear' i]",
  rangeReset: "[data-range-reset], [data-clears-range]",
  addColumn: "[data-add-column], #addColBtn",
  newColumn: "[data-newcol], input[placeholder*='new column' i]",
  colRemove: "[data-col-del], [data-column-remove]",
  emptyRow: "[data-empty], .tbl-empty, [data-empty-state]",
  // rule 20: the row-actions column carries this on its header and on every cell. It has no
  // menu, no sort and no drag, so the checks for those look past it instead of failing it.
  actions: "[data-col-role=actions]",
  columnsBtn: null,
  ...(cfg.sel || {}),
};
const CHROME = cfg.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VP = cfg.viewport || { width: 1200, height: 850 };
const URL = argv[0];
/** the headers that sort, drag and carry a menu — every one except the row-actions column */
const DATA_HEAD = SEL.head.split(",").map(h => `${h.trim()}:not(${SEL.actions})`).join(", ");

const results = [];
const say = (rule, state, name, detail = "") => results.push({ rule, state, name, detail });
const pass = (r, n, d) => say(r, "PASS", n, d);
const fail = (r, n, d) => say(r, "FAIL", n, d);
const gone = (r, n, d) => say(r, "MISSING", n, d);
const skip = (r, n, d) => say(r, "SKIP", n, d);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", `--window-size=${VP.width},${VP.height}`],
});
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
await page.setViewport(VP);
// on every document, not just this one: the reorder check reloads, and the selectors have to
// survive that or the next evaluate reads window.__S as undefined
await page.evaluateOnNewDocument(s => { window.__S = s; }, SEL);
// an app behind a login, or one that picks its language from storage, is checked as its user sees it
if (cfg.cookies?.length) await page.setCookie(...cfg.cookies);
if (cfg.storage) await page.evaluateOnNewDocument(kv => {
  try { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); } catch {}
}, cfg.storage);
await page.goto(URL, { waitUntil: "networkidle2" });
await page.waitForSelector(SEL.rows, { timeout: 20000 }).catch(() => {});

const has = async sel => (await page.$(sel)) !== null;

/** Every selector here may be a comma list, so scoping one inside another is a
 *  cross product — `"a, b" + "x, y"` is four selectors, not one. */
const scoped = (outer, inner) => outer.split(",")
  .flatMap(o => inner.split(",").map(i => `${o.trim()} ${i.trim()}`)).join(", ");

/* The "no rows match the filters" line is a MESSAGE, not a row. Counted as one,
   "clearing restored the rows" reads true at zero rows — which is precisely the
   state the message announces. */
const DATA_ROWS = `[...document.querySelectorAll(window.__S.rows)]
  .filter(r => !r.matches(window.__S.emptyRow) && !r.querySelector(window.__S.emptyRow))`;
const rowCount = () => page.evaluate(`${DATA_ROWS}.length`);
const rowOrder = () => page.evaluate(`${DATA_ROWS}.map(r => r.textContent.trim().slice(0, 40))`);
/** the text of one column, by its position in the header — read live, because a
 *  drag-reorder has already moved the columns by the time this runs */
const colText = c => page.evaluate(`${DATA_ROWS}.map(r => (r.children[${c}]?.textContent || "").trim())`);

/* ── the per-column menu, driven ───────────────────────────────────────────────
   Opening, closing and ticking are needed by four rules, and each of them has one
   way to go wrong that is worth writing down once. */
const menuOpen = () => page.evaluate(sel => {
  const m = document.querySelector(sel);
  return !!m && !m.hidden && getComputedStyle(m).display !== "none";
}, SEL.menu);
/** the handles, each with the header position of the column it belongs to: a
 *  column with nothing to filter (an actions column) has no handle, so the two
 *  lists are not the same length and the index of one is not the index of the other */
const handleCols = () => page.evaluate(sel => {
  const ths = [...document.querySelectorAll(window.__S.head)];
  return [...document.querySelectorAll(sel)].map((h, k) => {
    const th = h.closest("th") ?? h.parentElement;
    return { k, col: ths.indexOf(th), label: (th?.textContent || "").trim() };
  });
}, SEL.menuHandle);
async function openMenu(k) {
  const hs = await page.$$(SEL.menuHandle);
  if (!hs[k]) return false;
  /* Scroll the handle into view BEFORE clicking it. Rules 9 and 10 leave the table
     scrolled sideways, and a frozen first column paints OVER whatever scrolls under
     it — so a handle left off-screen is not merely out of sight, it is underneath
     another cell. The click lands on the frozen column, this menu never opens, and
     every later tick goes into the PREVIOUS column's menu: the run then reports a
     broken value filter (rule 4) that is really just a mis-aimed click. */
  await page.evaluate((sel, k) => {
    const h = document.querySelectorAll(sel)[k];
    (h?.closest("th") ?? h)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, SEL.menuHandle, k);
  await sleep(120);
  await hs[k].click().catch(() => {});
  await sleep(260);
  return menuOpen();
}
async function closeMenu() {
  if (await menuOpen()) { await page.keyboard.press("Escape"); await sleep(180); }
}
/** the value ticks of the open menu, WITHOUT its select-all master — that one is
 *  a control over the list, not a member of it */
const ticks = () => page.evaluate(sel => {
  const m = document.querySelector(sel);
  if (!m) return [];
  return [...m.querySelectorAll("input[type=checkbox]")]
    .map(b => ({ label: (b.closest("label")?.textContent || b.getAttribute("aria-label") || "")
                          .replace(/\s+/g, " ").trim(),
                 aria: b.getAttribute("aria-label") || "", on: b.checked }))
    .filter(t => !/select all|toate/i.test(t.aria));
}, SEL.menu);
/** click the nth value tick. A programmatic click still travels the capture phase,
 *  which is where a menu that re-renders has to stamp its own events. */
async function clickTick(n) {
  await page.evaluate((sel, n) => {
    const m = document.querySelector(sel);
    const bs = [...m.querySelectorAll("input[type=checkbox]")]
      .filter(b => !/select all|toate/i.test(b.getAttribute("aria-label") || ""));
    bs[n]?.click();
  }, SEL.menu, n);
  await sleep(300);
}

/* ── contrast helpers live in the page, measured on what is actually painted ───────── */
const CONTRAST = `
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const Y = s => { const m = String(s).match(/[\\d.]+/g) || [0,0,0];
                   const [r,g,b] = m.map(Number);
                   return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b); };
  const cr = (a,b) => { const x = Y(a), y = Y(b), hi = Math.max(x,y), lo = Math.min(x,y);
                        return (hi + 0.05) / (lo + 0.05); };
`;

// ── 1. header band and its contrast ────────────────────────────────────────────────
{
  const m = await page.evaluate(`(() => { ${CONTRAST}
    const th = document.querySelector(window.__S.head);
    const tr = document.querySelector(window.__S.rows);
    if (!th || !tr) return null;
    const ths = getComputedStyle(th);
    const bg = getComputedStyle(document.body).backgroundColor;
    // the median cell, not the first: an identity column is deliberately the brightest one,
    // and comparing against it would ask the header to out-shout the emphasis
    const each = [...tr.children].map(c => cr(getComputedStyle(c).color, bg)).sort((a, b) => a - b);
    const median = each[Math.floor(each.length / 2)];
    const cellBg = getComputedStyle(tr.children[0]).backgroundColor;
    const lum = c => { const m = c.match(/\\d+/g); if (!m) return null;
                       const [r,g,b] = m.map(Number); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); };
    return { head: cr(ths.color, ths.backgroundColor), rows: median,
             headLum: lum(ths.backgroundColor), rowLum: lum(cellBg) || lum(bg),
             sticky: ths.position, headBg: ths.backgroundColor, bodyBg: bg,
             weight: ths.fontWeight, align: ths.textAlign, transform: ths.textTransform };
  })()`);
  if (!m) gone(1, "header + rows found");
  else {
    m.head >= 7
      ? pass(1, "header contrast", `${m.head.toFixed(2)}:1`)
      : fail(1, "header contrast below 7:1", `${m.head.toFixed(2)}:1`);
    /* Rule 16: the band is its own shade — measurably lighter (or darker) than the rows,
       not merely "a different colour". A band that only clears 7:1 while sitting at the
       row's own luminance reads as one more row on a dimmed monitor. The floor above and
       this delta together replace the old "header must out-contrast the rows": once the
       band is a light one, white text on it necessarily contrasts LESS, and asking for
       both was asking for a band that could never be light. */
    if (m.headLum == null || m.rowLum == null) skip(16, "band luminance", "colours not readable");
    else {
      /* measured in L*, not in raw luminance: on a dark table the two backgrounds sit so
         low that a plain ratio reports 180% for a step the eye reads as one notch. L* is
         what "10-20% lighter" means to the person looking at it. */
      const L = y => y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
      const d = Math.round(Math.abs(L(m.headLum) - L(m.rowLum)));
      d >= 5
        ? pass(16, "the header band is its own shade", `ΔL* ${d} față de rânduri`)
        : fail(16, "the header band melts into the rows", `ΔL* ${d} — sub 5`);
    }
    const opaque = m.headBg !== m.bodyBg && !/rgba\(0, 0, 0, 0\)|transparent/.test(m.headBg);
    opaque ? pass(1, "header has its own background", m.headBg)
           : fail(1, "header has no background of its own", m.headBg);
    m.sticky === "sticky" ? pass(1, "header is sticky") : fail(1, "header is not sticky", m.sticky);
    // rule 2
    m.align === "center" ? pass(2, "titles centred") : fail(2, "titles not centred", m.align);
    Number(m.weight) >= 700 ? pass(2, "titles bold", `weight ${m.weight}`) : fail(2, "titles not bold", `weight ${m.weight}`);
    m.transform === "uppercase" ? pass(2, "titles uppercase") : fail(2, "titles not uppercase", m.transform);
  }
}

// ── 13. dividers between header cells ──────────────────────────────────────────────
{
  const d = await page.evaluate(`(() => { ${CONTRAST}
    const ths = [...document.querySelectorAll(window.__S.head)];
    if (ths.length < 2) return null;
    const th = ths[0], s = getComputedStyle(th), a = getComputedStyle(th, "::after");
    const cellH = th.getBoundingClientRect().height;
    const viaAfter = a.content !== "none" && parseFloat(a.width) >= 1 && parseFloat(a.width) <= 3;
    const w = viaAfter ? parseFloat(a.width) : parseFloat(s.borderRightWidth);
    const colour = viaAfter ? a.backgroundColor : s.borderRightColor;
    const h = viaAfter ? parseFloat(a.height) : cellH;
    return { w, h, cellH, ratio: cr(colour, s.backgroundColor),
             under: cr(s.borderBottomColor, s.backgroundColor) };
  })()`);
  if (!d) skip(13, "dividers", "fewer than two columns");
  else if (!(d.w >= 1)) gone(13, "no divider between header cells");
  else {
    pass(13, "divider present", `${d.w}px`);
    d.h < d.cellH * 0.8 ? pass(13, "divider is a tick, not full height", `${d.h.toFixed(0)}px of ${d.cellH.toFixed(0)}px`)
                        : fail(13, "divider runs the whole cell height", `${d.h.toFixed(0)}px of ${d.cellH.toFixed(0)}px`);
    d.ratio < d.under ? pass(13, "quieter than the rule under the band", `${d.ratio.toFixed(2)}:1 vs ${d.under.toFixed(2)}:1`)
                      : fail(13, "divider competes with the rule under the band", `${d.ratio.toFixed(2)}:1 vs ${d.under.toFixed(2)}:1`);
  }
}

/* ── what counts as a figure, shared by rules 15 and 22 ──────────────────────────────
   Real functions, injected into the page by their source text (so they can be run in
   Node too). Localised figures are the point: "97,6 s", "1.234,56 lei" and "12 500"
   are numbers to a reader of a comma-decimal locale, and a detector that only knew the
   dot SKIPPED those columns — and a skipped check reads exactly like a passing one. */
function parseNum(s) {
  let t = String(s).trim()
    .replace(/^[€$£¥]\s*/u, "")                          // a leading currency: "€ 12"
    .replace(/\s*[\p{L}%€$£¥]{1,4}\.?$/u, "")            // a trailing unit: "12.40 EUR", "97,6 s"
    .replace(/[\s   ]/g, "")               // thousands by space, NBSP, thin space
    .replace(/^−/, "-");
  if (!/^[+-]?\d[\d.,]*$/.test(t) || /[.,]$/.test(t)) return null;
  const dot = t.lastIndexOf("."), comma = t.lastIndexOf(",");
  if (dot >= 0 && comma >= 0)                             // both: the LAST one is the decimal mark
    t = dot > comma ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0)                                    // "1,234,567" thousands; "97,6" a decimal
    t = /^[+-]?\d{1,3}(,\d{3}){2,}$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  else if ((t.match(/\./g) || []).length > 1)             // "1.234.567" — dots as thousands,
    t = /^[+-]?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : "";  // "09.08.2026" a date
  return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}
/** a MAGNITUDE, not an identifier: an id is a run of digits too, and nobody compares two
 *  of them by size. A sign, a decimal mark or a thousands group is the tell. */
function isFigure(s) {
  return parseNum(s) !== null && /[.,−+-]|\d[\s  ]\d{3}(?!\d)/.test(String(s));
}
const NUM = `${parseNum}\n${isFigure}\n`;

// ── 15. figures right-aligned, monospaced, tabular ─────────────────────────────────
{
  const n = await page.evaluate(`(() => { ${NUM}
    const rows = ${DATA_ROWS};
    if (rows.length < 2) return null;
    const ths = [...document.querySelectorAll(window.__S.head)];
    // a column of dates is not a column of figures, and "—" is a hole rather than
    // a value: neither may decide whether a column is numeric
    const hole = s => !s || /^(—|–|-|n\\/a)$/i.test(s);
    const out = [];
    for (let i = 0; i < (rows[0].children.length); i++) {
      const cells = rows.map(r => r.children[i]).filter(Boolean);
      const vals = cells.map(c => c.textContent.trim()).filter(s => !hole(s));
      if (vals.length < 2 || !vals.every(v => parseNum(v) !== null) || !vals.some(isFigure)) continue;
      const c = cells.find(c => !hole(c.textContent.trim()));
      const s = getComputedStyle(c);
      out.push({ label: (ths[i]?.textContent || "#" + i).trim(),
                 align: s.textAlign, family: s.fontFamily,
                 tnum: s.fontVariantNumeric + " " + s.fontFeatureSettings });
    }
    return out;
  })()`);
  if (!n) skip(15, "numeric columns", "fewer than two rows");
  else if (!n.length) skip(15, "numeric columns", "no column of figures in view");
  else {
    const named = n.map(c => c.label).join(", ");
    const bad = f => n.filter(f).map(c => `${c.label}=${c.align}`).join(", ");
    const wrongAlign = bad(c => c.align !== "right");
    wrongAlign ? fail(15, "figures are not right-aligned", wrongAlign)
               : pass(15, "figures right-aligned", named);
    const wrongFont = n.filter(c => !/mono|courier|consolas|menlo|monaco/i.test(c.family))
                       .map(c => c.label).join(", ");
    wrongFont ? fail(15, "figures are not monospaced — digits will not line up", wrongFont)
              : pass(15, "figures monospaced", n[0].family.split(",")[0]);
    const wrongNum = n.filter(c => !/tabular-nums|tnum/.test(c.tnum)).map(c => c.label).join(", ");
    wrongNum ? fail(15, "no tabular-nums — proportional digits break the column", wrongNum)
             : pass(15, "tabular-nums on the figures");
  }
}

// ── 22. cell alignment: centred by default, figures right, wrapping text left ──────
{
  /* MEASURED where it can be: a centred <td> holding a full-width flex box paints its
     content flush left while every computed style on the cell says "center". So where a
     cell has slack, the gaps either side of the painted content decide; only where the
     content fills the cell (nothing left to measure) does the computed alignment. */
  const a = await page.evaluate(`(() => { ${NUM}
    const rows = ${DATA_ROWS}.slice(0, 12);
    if (!rows.length) return null;
    const ths = [...document.querySelectorAll(window.__S.head)];
    const hole = s => !s || /^(—|–|-|n\\/a)$/i.test(s);
    const WRAPS = /^(normal|pre-wrap|pre-line|break-spaces)$/;
    const out = [];
    for (let i = 0; i < rows[0].children.length; i++) {
      const cells = rows.map(r => r.children[i]).filter(c => c && !c.matches(window.__S.actions));
      const vals = cells.map(c => c.textContent.trim()).filter(s => !hole(s));
      if (!vals.length) continue;                               // a checkbox, an icon strip
      const figures = vals.length >= 2 && vals.every(v => parseNum(v) !== null) && vals.some(isFigure);
      // a run of bare digits is an id or a count: right or centre, either reads fine
      const digits = vals.every(v => /^[\\d\\s.,]+$/.test(v));
      const label = (ths[i]?.textContent || "#" + i).trim().slice(0, 24);
      for (const td of cells) {
        if (hole(td.textContent.trim())) continue;
        const tr = td.getBoundingClientRect(), ts = getComputedStyle(td);
        const box = { l: tr.left + parseFloat(ts.paddingLeft), r: tr.right - parseFloat(ts.paddingRight),
                      t: tr.top + parseFloat(ts.paddingTop), b: tr.bottom - parseFloat(ts.paddingBottom) };
        // painted content = text and replaced boxes, never an absolutely placed grip or tooltip
        const floats = el => { for (let e = el; e && e !== td; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (/absolute|fixed/.test(s.position) || s.display === "none" || s.visibility === "hidden") return true; }
          return false; };
        const rects = [], tops = new Set(); let host = null, clipped = false;
        const walk = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode());) {
          if (!n.textContent.trim() || floats(n.parentElement)) continue;
          host = host || n.parentElement;
          const rg = document.createRange(); rg.selectNodeContents(n);
          for (const q of rg.getClientRects()) if (q.width > 0) { rects.push(q); tops.add(Math.round(q.top)); }
        }
        /* a badge or chip paints its own box — its padding is content to the eye, so the box
           counts, not only the text inside it (else a pill's left padding reads as a gap) */
        const paints = e => { const s = getComputedStyle(e);
          return !/rgba\\(\\d+, \\d+, \\d+, 0\\)|transparent/.test(s.backgroundColor) || parseFloat(s.borderLeftWidth) > 0; };
        for (const e of td.querySelectorAll("*"))
          if (!floats(e) && (e.matches("svg, img, input, [role=img]") || (e.textContent.trim() && paints(e)))) {
            const q = e.getBoundingClientRect(); if (q.width > 0 && q.width < tr.width) rects.push(q); }
        for (const e of [td, ...td.querySelectorAll("*")])
          if (!floats(e) && e.clientHeight > 0 && e.textContent.trim() &&
              (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) clipped = true;
        if (!rects.length) continue;
        const c = { l: Math.min(...rects.map(q => q.left)), r: Math.max(...rects.map(q => q.right)),
                    t: Math.min(...rects.map(q => q.top)), b: Math.max(...rects.map(q => q.bottom)) };
        const gl = c.l - box.l, gr = box.r - c.r, gt = c.t - box.t, gb = box.b - c.b;
        const hs = getComputedStyle(host || td);
        const wraps = (tops.size > 1 && WRAPS.test(hs.whiteSpace)) || clipped;
        let horiz;
        if (gl + gr > 8) horiz = Math.abs(gl - gr) <= Math.max(3, 0.15 * (gl + gr)) ? "center" : gl < gr ? "left" : "right";
        else {
          const ta = /flex|grid/.test(ts.display) ? ts.justifyContent : hs.textAlign;
          horiz = /center/.test(ta) ? "center" : /right|end/.test(ta) ? "right" : "left";
        }
        /* A stacked cell (a title over a button, a pill over a caption) can be centred as a box
           while its lines hug the box's left edge: the union looks centred, the eye sees a ragged
           left column. So a centred cell is judged line by line too — outermost boxes only (a
           pill's own icon and text are the pill), grouped into lines by vertical overlap. */
        let ragged = "";
        if (horiz === "center" && !wraps) {
          const outer = rects.filter(q => !rects.some(o => o !== q && o.left <= q.left + 0.5 && o.right >= q.right - 0.5
                                                          && o.top <= q.top + 0.5 && o.bottom >= q.bottom - 0.5));
          const lines = [];
          for (const q of [...outer].sort((a, b) => a.top - b.top)) {
            const mid = (q.top + q.bottom) / 2, line = lines.find(l => mid >= l.t && mid <= l.b);
            if (line) { line.l = Math.min(line.l, q.left); line.r = Math.max(line.r, q.right); }
            else lines.push({ t: q.top, b: q.bottom, l: q.left, r: q.right });
          }
          if (lines.length > 1) for (const l of lines) {
            const a = l.l - box.l, z = box.r - l.r;
            if (Math.abs(a - z) > Math.max(4, 0.2 * (a + z))) { ragged = "line " + a.toFixed(0) + "|" + z.toFixed(0); horiz = a < z ? "left" : "right"; break; }
          }
        }
        const vComputed = ts.verticalAlign === "middle" || (/flex|grid/.test(ts.display) && /center/.test(ts.alignItems));
        const vMeasured = gt + gb <= 8 || Math.abs(gt - gb) <= Math.max(3, 0.2 * (gt + gb));
        out.push({ label, kind: figures ? "figure" : wraps ? "wrap" : "text", digits, horiz, col: i,
                   middle: vComputed && vMeasured,
                   detail: horiz + " (gaps " + gl.toFixed(0) + "|" + gr.toFixed(0) + (ragged ? ", a stacked " + ragged : "") + ", text-align " + hs.textAlign + ")" });
      }
    }
    // the column decides, not the cell: a short note in a column of paragraphs sits on the
    // same left edge as its neighbours, or the column has no edge at all
    const wrapCols = new Set(out.filter(c => c.kind === "wrap").map(c => c.col));
    for (const c of out) if (c.kind === "text" && wrapCols.has(c.col)) c.kind = "wrap";
    return out;
  })()`);
  if (!a) skip(22, "cell alignment", "no rows");
  else {
    /** one line per kind, naming each offending column once */
    const judge = (kind, want, okName, badName) => {
      const cells = a.filter(c => c.kind === kind);
      if (!cells.length) return skip(22, okName, `no ${kind} cell in view`);
      const bad = cells.filter(c => !want(c));
      const named = [...new Map(bad.map(c => [c.label, `${c.label}: ${c.detail}`])).values()].slice(0, 4).join("; ");
      bad.length ? fail(22, badName, named)
                 : pass(22, okName, `${cells.length} cells in ${new Set(cells.map(c => c.label)).size} columns`);
    };
    judge("text", c => c.horiz === "center" || (c.digits && c.horiz === "right"),
          "text cells centred", "text cells are not centred");
    judge("figure", c => c.horiz === "right", "figures right-aligned", "figures are not right-aligned");
    judge("wrap", c => c.horiz === "left", "wrapping long text left-aligned",
          "wrapping text is centred — a ragged paragraph has no edge to read from");
    const off = a.filter(c => !c.middle);
    if (!a.length) skip(22, "cells centred vertically", "no cell with content");
    else off.length ? fail(22, "cells are not centred vertically", [...new Set(off.map(c => c.label))].slice(0, 4).join(", "))
                    : pass(22, "cells centred vertically", `${a.length} cells`);
  }
}

// ── 3. sorting ─────────────────────────────────────────────────────────────────────
if (await rowCount() < 2) skip(3, "sorting", "fewer than two rows");
else {
  const before = await rowOrder();
  await page.click(DATA_HEAD);
  await sleep(250);
  const asc = await rowOrder();
  await page.click(DATA_HEAD);
  await sleep(250);
  const desc = await rowOrder();
  asc.join("|") !== desc.join("|")
    ? pass(3, "clicking a title reorders rows", `${asc[0]?.slice(0, 18)} ↔ ${desc[0]?.slice(0, 18)}`)
    : fail(3, "clicking a title changes nothing", "dead control");
  const marked = await page.evaluate(sel => {
    const th = document.querySelector(sel);
    return th.className !== "" || th.querySelector("span, svg, i") !== null;
  }, DATA_HEAD);
  marked ? pass(3, "the sorted column is marked") : fail(3, "no visible sort indicator");
  void before;
}

/* ── 21. the sort column carries a bar; a search box carries a magnifier ─────────────
   The magnifier half is shared with rule 12, which runs it on the column menu's own
   box while that menu is open. */
const magnifier = sel => page.evaluate(sel => {
  const box = [...document.querySelectorAll(sel)]
    .find(b => b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== "hidden");
  if (!box) return null;
  const br = box.getBoundingClientRect(), bs = getComputedStyle(box);
  const textStart = parseFloat(bs.borderLeftWidth) + parseFloat(bs.paddingLeft);
  // a background-image icon sits in the padding, so the padding has to hold it
  if (bs.backgroundImage !== "none") return { how: "background", ok: textStart >= 22, textStart };
  // an icon laid over the box, in its left part — looked for in the box's wrappers
  const icon = [box.parentElement, box.parentElement?.parentElement].filter(Boolean)
    .flatMap(w => [...w.querySelectorAll("svg, img, [data-icon]")])
    .find(i => { const r = i.getBoundingClientRect();
                 return r.width > 4 && r.left >= br.left - 1 && r.right <= br.left + br.width * 0.4
                     && r.top >= br.top - 1 && r.bottom <= br.bottom + 1; });
  if (!icon) return { how: "none" };
  const iconEnd = icon.getBoundingClientRect().right - br.left;
  return { how: "icon", ok: iconEnd <= textStart + 0.5, iconEnd, textStart };
}, sel);
const judgeMagnifier = (m, where) => {
  if (!m) return skip(21, `magnifier in the ${where} search box`, "no visible search box there");
  if (m.how === "none") return fail(21, `the ${where} search box has no magnifier inside it`);
  const d = m.how === "icon" ? `icon ends at ${m.iconEnd.toFixed(0)}px, text starts at ${m.textStart.toFixed(0)}px`
                             : `background icon, text starts at ${m.textStart.toFixed(0)}px`;
  m.ok ? pass(21, `magnifier inside the ${where} search box, clear of the text`, d)
       : fail(21, `the ${where} search box's magnifier sits under the text`, d);
};
{
  const bar = await page.evaluate(() => {
    const ths = [...document.querySelectorAll(window.__S.head)];
    const sorted = ths.find(t => /^(ascending|descending)$/.test(t.getAttribute("aria-sort") || ""));
    if (!sorted) return null;
    const clear = c => !c || c === "transparent" || /rgba\(\d+, \d+, \d+, 0\)/.test(c);
    /** a horizontal stroke under the title: a pseudo-element on the header or anything in it,
     *  or a bottom border — wider than tall, 1–6 px thick, coloured. The rule-13 divider is a
     *  pseudo too, but upright, so the shape tells them apart. `sig` leaves the width out so
     *  the same stroke on a narrower column still counts as the same stroke. */
    const bars = th => {
      const found = [];
      [th, ...th.querySelectorAll("*")].forEach((el, k) => {
        for (const p of ["::before", "::after"]) {
          const s = getComputedStyle(el, p);
          if (s.content === "none" || s.display === "none" || s.visibility === "hidden") continue;
          const filled = !clear(s.backgroundColor);
          const thick = filled ? parseFloat(s.height) : parseFloat(s.borderBottomWidth);
          const colour = filled ? s.backgroundColor : s.borderBottomColor;
          const w = parseFloat(s.width) || 0;
          if (thick >= 1 && thick <= 6 && w >= 12 && w > 3 * thick && !clear(colour))
            found.push({ sig: `${k}${p} ${thick}px ${colour}`, text: `${p} ${w.toFixed(0)}×${thick}px ${colour}` });
        }
      });
      const s = getComputedStyle(th);
      if (parseFloat(s.borderBottomWidth) >= 2 && !clear(s.borderBottomColor))
        found.push({ sig: `border ${s.borderBottomWidth} ${s.borderBottomColor}`, text: `border-bottom ${s.borderBottomWidth} ${s.borderBottomColor}` });
      return found;
    };
    const other = ths.find(t => t !== sorted && !t.matches(window.__S.actions));
    const theirs = new Set((other ? bars(other) : []).map(b => b.sig));
    // a stroke every header carries is the band's own rule, not a mark: it has to be the sorted one's alone
    const own = bars(sorted).filter(b => !theirs.has(b.sig));
    return { label: sorted.textContent.trim().slice(0, 24), own: own.map(b => b.text), shared: theirs.size };
  });
  if (!bar) gone(21, "no header carries aria-sort after sorting — the sorted column is told by nothing a checker or a screen reader can read");
  else bar.own.length
    ? pass(21, "the sorted column has a bar under its title", `${bar.label}: ${bar.own[0]}`)
    : fail(21, "the sorted column is marked only by its arrow — no bar under the title", bar.label);
  // the toolbar box; the column menu's own box is judged in rule 12, where that menu is open
  judgeMagnifier(await magnifier(SEL.search), "table");
}

// ── 7. frozen first column, and ONE scrollport for both planes ─────────────────────
{
  /* Both planes at once, at more than one width, and by DRIVING both scrolls.
     A computed-style check stays green through the whole failure this exists for:
     `position: sticky` is set on the header, the horizontal box simply is not the
     box that scrolls vertically, so the band has nothing to stick to and leaves
     the top the moment the page scrolls under it. The freeze and the sticky header
     are one mechanism, and the widths matter because a table that fits at 1400
     starts scrolling the moment a derived column arrives.
     The window is SHORT on purpose: a table has to overflow vertically before
     which box owns that overflow can be observed at all. */
  const drive = () => page.evaluate(() => {
    const table = document.querySelector(window.__S.table);
    let sc = window.__S.scroller ? document.querySelector(window.__S.scroller)
                                 : table?.parentElement;
    while (!window.__S.scroller && sc && sc !== document.body
           && sc.scrollWidth <= sc.clientWidth && sc.scrollHeight <= sc.clientHeight)
      sc = sc.parentElement;
    const rows = [...document.querySelectorAll(window.__S.rows)]
      .filter(r => !r.matches(window.__S.emptyRow) && !r.querySelector(window.__S.emptyRow));
    const th = document.querySelector(window.__S.head);
    if (!sc || !th || !rows.length) return { none: true };
    const hx = sc.scrollWidth - sc.clientWidth;
    const vy = sc.scrollHeight - sc.clientHeight;
    const doc = document.scrollingElement;
    const pageScrolls = doc.scrollHeight - doc.clientHeight > 4;
    const first = rows[0].children[0];
    // never the row-actions column: pinned right, it holds still on purpose (rule 20)
    const movable = [...rows[0].children].filter(c => !c.matches(window.__S.actions));
    const other = movable[Math.min(2, movable.length - 1)];
    sc.scrollLeft = 0; sc.scrollTop = 0;
    const h0 = th.getBoundingClientRect().top, f0 = first.getBoundingClientRect().x;
    const o0 = other.getBoundingClientRect().x, r0 = rows[0].getBoundingClientRect().top;
    sc.scrollLeft = Math.min(300, hx); sc.scrollTop = Math.min(160, vy);
    const h1 = th.getBoundingClientRect().top, f1 = first.getBoundingClientRect().x;
    const o1 = other.getBoundingClientRect().x, r1 = rows[0].getBoundingClientRect().top;
    sc.scrollLeft = 0; sc.scrollTop = 0;
    return { hx, vy, pageScrolls, sc: sc.className || sc.tagName,
             headHeld: Math.abs(h1 - h0) < 2, colHeld: Math.abs(f1 - f0) < 2,
             otherMoved: Math.abs(o1 - o0) > 10, rowsMoved: Math.abs(r1 - r0) > 10 };
  });
  for (const width of [VP.width, 1000, 640]) {
    await page.setViewport({ width, height: 420 });
    await sleep(220);
    const r = await drive();
    const at = `at ${width}px`;
    if (r.none) { gone(7, "no table, rows or scrollport found", at); continue; }
    // the vertical plane first: it is the one the trap hides in
    if (!r.vy && r.pageScrolls)
      fail(7, "the horizontal box does not own the vertical scroll — the sticky "
            + "header has nothing to stick to", `${at}, the PAGE scrolls instead (${r.sc})`);
    else if (!r.vy) skip(7, "one scrollport for both planes", `${at} the rows still fit — nothing to scroll down`);
    else if (r.headHeld && r.rowsMoved)
      pass(7, "the header holds while the rows scroll under it", `${at}, ${r.vy}px of overflow in .${r.sc}`);
    else fail(7, "the header leaves the top on a vertical scroll",
              `${at}, headHeld=${r.headHeld} rowsMoved=${r.rowsMoved}`);
    if (!r.hx) skip(7, "frozen first column", `${at} the table still fits — nothing to scroll sideways`);
    else if (r.colHeld && r.otherMoved)
      pass(7, "first column stays put while the rest scrolls", `${at}, ${r.hx}px of overflow`);
    else fail(7, "first column is not frozen", `${at}, held=${r.colHeld} otherMoved=${r.otherMoved}`);
  }
  await page.setViewport(VP);
  await sleep(200);
}

// ── 20. the row-actions column is pinned to the right edge ─────────────────────────
{
  /* The mirror of rule 7, driven the same way: scroll the box fully left and fully right
     and the actions column must sit on the box's right edge in BOTH, and a point in the
     middle of an action cell must land on that cell — a sticky cell with no z-index or no
     background is geometrically in place and still painted under the columns scrolling
     past it, which a rect check alone calls pinned. */
  const probe = () => page.evaluate(`(() => { ${CONTRAST}
    const A = window.__S.actions;
    const th = [...document.querySelectorAll(window.__S.head)].find(t => t.matches(A));
    if (!th) return { none: true };
    const s = getComputedStyle(th);
    const out = { label: th.textContent.trim(), hidden: s.visibility === "hidden" || parseFloat(s.fontSize) < 6,
                  handle: !!th.querySelector(window.__S.menuHandle),
                  contrast: cr(s.color, s.backgroundColor) };
    const table = document.querySelector(window.__S.table);
    let sc = window.__S.scroller ? document.querySelector(window.__S.scroller) : table?.parentElement;
    while (!window.__S.scroller && sc && sc !== document.body
           && sc.scrollWidth <= sc.clientWidth && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
    const td = ${DATA_ROWS}.map(r => [...r.children].find(c => c.matches(A))).find(Boolean);
    if (!sc || !td) return { ...out, noCells: !td };
    const bg = getComputedStyle(td).backgroundColor, alpha = bg.match(/rgba\\(.*,\\s*([\\d.]+)\\)/);
    out.bg = bg; out.opaque = bg !== "transparent" && !(alpha && Number(alpha[1]) < 1);
    out.hx = sc.scrollWidth - sc.clientWidth; out.vy = sc.scrollHeight - sc.clientHeight;
    const edge = () => { const r = sc.getBoundingClientRect(); return r.left + sc.clientLeft + sc.clientWidth; };
    const at = x => {
      sc.scrollTop = 0; sc.scrollLeft = x;
      const a = td.getBoundingClientRect();
      const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
      return { off: Math.round((a.right - edge()) * 10) / 10, hit: hit?.closest("td, th") === td,
               got: hit?.closest("td, th")?.textContent.trim().slice(0, 20) ?? "nothing" };
    };
    out.left = at(0); out.right = at(out.hx);
    // the corner: rows scrolled up under the band must pass BELOW the actions header
    if (out.vy > 0) {
      sc.scrollLeft = 0; sc.scrollTop = Math.min(out.vy, 60);
      const h = th.getBoundingClientRect();
      out.corner = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2)?.closest("td, th") === th;
    }
    sc.scrollLeft = 0; sc.scrollTop = 0;
    return out;
  })()`);
  let r = null, at = "";
  for (const width of [VP.width, 640]) {
    await page.setViewport({ width, height: 420 });
    await sleep(220);
    r = await probe(); at = `at ${width}px`;
    if (r.none || r.noCells || r.hx > 0) break;
  }
  if (r.none) skip(20, "row actions pinned right", `no header marked ${SEL.actions} — no actions column`);
  else {
    r.label && !r.hidden ? pass(20, "the actions column has a visible header label", r.label)
                         : fail(20, "the actions column has no visible header label", r.label || "empty");
    r.handle ? fail(20, "the actions column carries a column menu — it has nothing to filter")
             : pass(20, "the actions column has no column menu");
    r.contrast >= 7 ? pass(20, "actions header contrast", `${r.contrast.toFixed(2)}:1`)
                    : fail(20, "actions header contrast below 7:1", `${r.contrast.toFixed(2)}:1`);
    if (r.noCells) gone(20, `no row cell marked ${SEL.actions} — mark the cells as well as the header`);
    else if (!r.hx) skip(20, "actions pinned right", `${at} the table still fits — nothing to scroll sideways`);
    else {
      r.opaque ? pass(20, "action cells paint an opaque background", r.bg)
               : fail(20, "action cells are see-through — rows show through while scrolling", r.bg);
      const held = x => Math.abs(x.off) <= 1;
      const pinned = held(r.left) && held(r.right);
      pinned
        ? pass(20, "actions stay on the right edge scrolled left and right", `${at}, ${r.hx}px of overflow`)
        : fail(20, "the actions column scrolls away — not pinned right",
               `${at}, off the edge by ${r.left.off}px (left) / ${r.right.off}px (right)`);
      /* A column that is off-screen is not ALSO "painted over": judging the z-order of a
         column that never held would pile three failures onto one cause. */
      if (!pinned) skip(20, "z-order and row selection", "the column is not pinned — fix that first");
      else {
        r.left.hit && r.right.hit
          ? pass(20, "the action cells are on top and clickable")
          : fail(20, "another column paints over the action cells",
                 `a click lands on "${r.left.hit ? r.right.got : r.left.got}"`);
        if (r.corner === undefined) skip(20, "actions header above the rows", `${at} nothing to scroll down`);
        else r.corner ? pass(20, "rows pass under the actions header")
                      : fail(20, "a row paints over the actions header — the corner z-order is wrong");
        /* With a row selected: selection often adds a class or a column, and either can
           knock a sticky cell loose. Driven only when the rows carry a checkbox to tick. */
        const tick = await page.$(scoped(SEL.rows, "input[type=checkbox]"));
        if (!tick) skip(20, "pinned with a row selected", "no row selection on this table");
        else {
          await tick.click(); await sleep(250);
          const s2 = await probe();
          await tick.click(); await sleep(150);
          held(s2.left) && held(s2.right) && s2.left.hit && s2.right.hit
            ? pass(20, "still pinned with a row selected")
            : fail(20, "selecting a row knocks the actions column loose",
                   `off ${s2.left.off} / ${s2.right.off}px, hit ${s2.left.hit}/${s2.right.hit}`);
        }
      }
    }
  }
  await page.setViewport(VP);
  await sleep(200);
}

// ── 6. reorder by drag ─────────────────────────────────────────────────────────────
{
  const draggable = await page.$eval(DATA_HEAD, th => th.draggable).catch(() => false);
  if (!draggable) gone(6, "headers are not draggable");
  else {
    const before = await page.$$eval(DATA_HEAD, ts => ts.map(t => t.textContent.trim()));
    await page.evaluate(sel => {
      const ths = [...document.querySelectorAll(sel)];
      const dt = new DataTransfer();
      ths[2]?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      ths[0]?.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
      ths[0]?.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      ths[2]?.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    }, DATA_HEAD);
    await sleep(250);
    const after = await page.$$eval(DATA_HEAD, ts => ts.map(t => t.textContent.trim()));
    before[0] !== after[0]
      ? pass(6, "dragging a header reorders the columns", `${before[0]} → ${after[0]}`)
      : fail(6, "dragging a header changes nothing", "dead control");
    // a URL that pins the columns legitimately wins over stored preferences, so persistence
    // cannot be observed from such a link — say so rather than accusing the app
    if (new global.URL(URL).search) skip(6, "order persists across reloads", "this URL pins the columns");
    else {
      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForSelector(SEL.rows).catch(() => {});
      const reloaded = await page.$$eval(DATA_HEAD, ts => ts.map(t => t.textContent.trim()));
      reloaded[0] === after[0] ? pass(6, "the order survives a reload")
                               : fail(6, "the order is forgotten on reload", `${after[0]} → ${reloaded[0]}`);
      /* The SAME drag, reloaded straight away: a layout write held behind a debounce
         dies with the document, and the column dragged one moment before a reload
         was the one that came back forgotten. Nothing here waits — the reload lands
         inside the debounce window on purpose, which is where the write has to be
         flushed on `pagehide`/`visibilitychange` with a keepalive send. (Found
         because this verifier reloads inside that window itself.) */
      const was = await page.$$eval(DATA_HEAD, ts => ts.map(t => t.textContent.trim()));
      await page.evaluate(sel => {
        const ths = [...document.querySelectorAll(sel)];
        const dt = new DataTransfer();
        ths[2]?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
        ths[0]?.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
        ths[0]?.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
        ths[2]?.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      }, DATA_HEAD);
      await sleep(60);                                  // a render, not a debounce
      const moved = await page.$$eval(DATA_HEAD, ts => ts.map(t => t.textContent.trim()));
      if (moved[0] === was[0]) skip(6, "a write inside the debounce window", "the second drag moved nothing");
      else {
        await page.reload({ waitUntil: "networkidle2" });
        await page.waitForSelector(SEL.rows).catch(() => {});
        const back = await page.$$eval(DATA_HEAD, ts => ts.map(t => t.textContent.trim()));
        back[0] === moved[0]
          ? pass(6, "a layout write survives a reload inside the debounce window", `${moved[0]} first, 60ms later`)
          : fail(6, "a debounced layout write died with the document — flush it on "
                  + "pagehide/visibilitychange with keepalive", `${moved[0]} → ${back[0]}`);
      }
    }
  }
}

// ── 9. widths and wrap, plus the resize grip ───────────────────────────────────────
{
  const w = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(window.__S.rows + " td")];
    const long = cells.find(c => c.textContent.trim().length > 60);
    const short = cells.find(c => /^[\d\s.,:/-]+$/.test(c.textContent.trim()) && c.textContent.trim());
    return {
      long: long && getComputedStyle(long).whiteSpace,
      short: short && getComputedStyle(short).whiteSpace,
      sawLong: !!long, sawShort: !!short,
    };
  });
  if (!w.sawLong) skip(9, "long text wraps", "no long cell in view");
  else (w.long === "normal" || w.long === "pre-wrap")
    ? pass(9, "long text wraps", `white-space=${w.long}`)
    : fail(9, "long text is truncated instead of wrapping", `white-space=${w.long}`);
  if (!w.sawShort) skip(9, "short values never wrap", "no numeric cell in view");
  else w.short === "nowrap" ? pass(9, "short values never wrap")
                            : fail(9, "short values may wrap", `white-space=${w.short}`);

  if (!(await has(SEL.colGrip))) gone(9, "no column resize grip");
  else {
    const box = await (await page.$(SEL.colGrip)).boundingBox();
    const width = () => page.$eval(SEL.head, e => e.getBoundingClientRect().width);
    const w0 = await width();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await sleep(200);
    const w1 = await width();
    w1 > w0 + 50 ? pass(9, "dragging the grip resizes the column", `${w0.toFixed(0)} → ${w1.toFixed(0)}px`)
                 : fail(9, "the resize grip does nothing", `${w0.toFixed(0)} → ${w1.toFixed(0)}px`);
  }
}

// ── 8. three-line cap, hover reveal, row height ────────────────────────────────────
{
  const clip = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(window.__S.rows + " td")];
    for (const c of cells) {
      const inner = c.firstElementChild || c;
      if (inner.scrollHeight > inner.clientHeight + 1) {
        const cs = getComputedStyle(inner);
        const r = inner.getBoundingClientRect();
        return { clamp: cs.webkitLineClamp, lineH: parseFloat(cs.lineHeight),
                 shown: inner.clientHeight, x: r.x + r.width / 2, y: r.y + r.height / 2,
                 text: inner.textContent.trim(), title: c.getAttribute("title") || "" };
      }
    }
    return null;
  });
  if (!clip) skip(8, "three-line cap", "no cell is long enough to clip here");
  else {
    clip.clamp === "3" ? pass(8, "cells clamp at three lines")
                       : fail(8, "cells do not clamp at three lines", `line-clamp=${clip.clamp}`);
    // the cap bounds row height, it does not pad short rows out to three lines. The invariant
    // is the spread: no row may stand more than the two extra lines taller than the shortest.
    const hs = await page.$$eval(SEL.rows, rs => rs.map(r => r.getBoundingClientRect().height));
    const spread = Math.max(...hs) - Math.min(...hs);
    spread <= clip.lineH * 2 + 4
      ? pass(8, "row heights stay within the three-line cap", `spread ${spread.toFixed(0)}px ≤ ${(clip.lineH * 2).toFixed(0)}px`)
      : fail(8, "a row grew past the cap", `spread ${spread.toFixed(0)}px over a ${clip.lineH.toFixed(0)}px line`);
    await page.mouse.move(clip.x, clip.y);
    await sleep(250);
    const revealed = await page.evaluate(t => {
      const wanted = t.replace(/\s+/g, " ").trim();
      return [...document.querySelectorAll("body *")].some(el => {
        if (el.closest(window.__S.rows)) return false;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || el.hidden) return false;
        return el.textContent.replace(/\s+/g, " ").trim() === wanted;
      });
    }, clip.text);
    if (revealed) pass(8, "hovering a clipped cell reveals the full text");
    else if (clip.title.trim() === clip.text) pass(8, "full text on hover via the title attribute", "weaker than a styled reveal");
    else fail(8, "a clipped cell reveals nothing on hover");
  }
  if (!(await has(SEL.rowGrip))) gone(8, "no row height grip");
  else {
    const gb = await (await page.$(SEL.rowGrip)).boundingBox();
    const h = () => page.$eval(SEL.rows, r => Math.round(r.getBoundingClientRect().height));
    const h0 = await h();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + 70, { steps: 8 });
    await page.mouse.up();
    await sleep(200);
    const h1 = await h();
    h1 > h0 + 15 ? pass(8, "a row can be dragged taller", `${h0} → ${h1}px`)
                 : fail(8, "the row grip does nothing", `${h0} → ${h1}px`);
  }
}

// ── 4 + 10. the per-column menu and its handle ─────────────────────────────────────
let menuOpened = false;
if (!(await has(SEL.menuHandle))) gone(4, "no per-column menu handle");
else {
  const shape = await page.evaluate(sel => {
    const b = document.querySelector(sel), s = getComputedStyle(b);
    return { glyph: b.textContent.trim(), size: parseFloat(s.fontSize),
             round: s.borderTopLeftRadius, w: Math.round(b.getBoundingClientRect().width) };
  }, SEL.menuHandle);
  const circular = ["○", "●", "◉", "◯", "⊙"].includes(shape.glyph) || parseFloat(shape.round) >= 8;
  circular ? pass(10, "the handle reads as a circle", shape.glyph || shape.round)
           : fail(10, "the handle is not a circle — it will read as a second sort arrow", shape.glyph);
  shape.w >= 16 ? pass(10, "the handle is a comfortable target", `${shape.w}px`)
                : fail(10, "the handle is too small", `${shape.w}px`);
  await page.click(SEL.menuHandle);
  await sleep(300);
  menuOpened = await page.evaluate(sel => {
    const m = document.querySelector(sel);
    return !!m && !m.hidden && getComputedStyle(m).display !== "none";
  }, SEL.menu);
  menuOpened ? pass(4, "the handle opens a menu") : fail(4, "the handle opens nothing", "dead control");
  if (menuOpened) {
    const inside = await page.evaluate(sel => {
      const m = document.querySelector(sel), t = m.textContent.toLowerCase();
      const r = m.getBoundingClientRect();
      return { ticks: m.querySelectorAll("input[type=checkbox]").length,
               search: !!m.querySelector("input[type=text], input:not([type])"),
               sort: /sort|a → z|a-z/.test(t),
               derive: /derive|calc|formula|column from/.test(t),
               fitsWindow: r.bottom <= innerHeight + 1 || getComputedStyle(m).overflowY === "auto" };
    }, SEL.menu);
    inside.sort ? pass(4, "menu sorts") : fail(4, "menu has no sort");
    inside.search ? pass(4, "menu searches inside the column") : fail(4, "menu has no column search");
    inside.ticks > 0 ? pass(4, "menu lists values to tick", `${inside.ticks}`)
                     : say(4, "SKIP", "no value ticks", "date columns swap these for a range — see rule 11");
    inside.derive ? pass(4, "menu can derive a column") : fail(4, "menu cannot derive a column from another");
    /* Rule 17: the menu is also where a column's text is placed. Horizontal alignment is a
       choice (left / centre / right); vertical never is — cells are always centred; and the
       wrap toggle decides between one line and several. None of it touches the header, which
       is centred on both axes and always wraps. */
    const placing = await page.evaluate(sel => {
      const m = document.querySelector(sel);
      const al = [...m.querySelectorAll("[data-align]")].map(b => b.getAttribute("data-align"));
      return { al, wrap: !!m.querySelector("[data-wrap]") };
    }, SEL.menu);
    ["left", "center", "right"].every(v => placing.al.includes(v))
      ? pass(17, "the menu aligns the column left / centre / right")
      : gone(17, "no horizontal alignment in the column menu", placing.al.join(",") || "none");
    placing.wrap ? pass(17, "the menu toggles wrapping") : gone(17, "no wrap toggle in the column menu");
    const vert = await page.evaluate(() => {
      const td = document.querySelector(window.__S.rows + " td");
      const th = document.querySelector(window.__S.head);
      return { td: getComputedStyle(td).verticalAlign, th: getComputedStyle(th).verticalAlign,
               thWrap: getComputedStyle(th).whiteSpace, thAlign: getComputedStyle(th).textAlign };
    });
    /* Rule 18: the menu wears the header band's colour and opens BESIDE its column.
       Opened over its own column, it hides exactly the values the filter is about — and
       a menu the colour of the rows floats on them with nothing saying where it starts. */
    const place = await page.evaluate(sel => {
      const m = document.querySelector(sel);
      const th = [...document.querySelectorAll(window.__S.head)]
        .find(t => t.querySelector("[data-cmenu], .cmenu, [data-column-menu]") &&
                   !m.hidden && t.textContent.trim() &&
                   m.textContent.trim().startsWith(t.textContent.trim().split("\n")[0].trim()));
      const r = m.getBoundingClientRect();
      const head = document.querySelector(window.__S.head);
      const norm = c => (c || "").replace(/\s/g, "");
      return { menuBg: norm(getComputedStyle(m).backgroundColor),
               headBg: norm(getComputedStyle(head).backgroundColor),
               covers: th ? (r.left < th.getBoundingClientRect().right - 2 &&
                             r.right > th.getBoundingClientRect().left + 2) : null };
    }, SEL.menu);
    place.menuBg === place.headBg
      ? pass(18, "the menu wears the header band's colour", place.menuBg)
      : fail(18, "the menu floats in the rows' own colour", `${place.menuBg} vs ${place.headBg}`);
    if (place.covers === null) skip(18, "the menu opens beside its column", "column not identified");
    else place.covers ? fail(18, "the menu opens over the column it belongs to")
                      : pass(18, "the menu opens beside its column");
    vert.td === "middle" ? pass(17, "cells are vertically centred")
                         : fail(17, "cells are not vertically centred", vert.td);
    (vert.th === "middle" && vert.thWrap !== "nowrap" && vert.thAlign === "center")
      ? pass(17, "the header stays centred on both axes and wraps")
      : fail(17, "the header does not follow its own fixed placing",
             `${vert.thAlign} / ${vert.th} / ${vert.thWrap}`);
    inside.fitsWindow ? pass(4, "the menu fits the window or scrolls")
                      : fail(4, "the menu overflows the window, hiding its own controls");
  }
}

// ── 4. the in-column search and the value list are ONE control ─────────────────────
{
  await closeMenu();
  const cols = await handleCols();
  const wordy = t => /\S\s\S/.test((t.aria || t.label).trim());
  let found = null, fallback = null;
  /* A column whose printed words are its stored values proves only half of this:
     prefer one that prints something else ("In market" over `in_market`), because
     that is the only shape in which a search reading the raw value shows up. */
  for (const h of cols.slice(0, 8)) {
    if (!(await openMenu(h.k))) continue;
    const t = await ticks();
    const usable = t.length >= 3 && await has(scoped(SEL.menu, SEL.search));
    if (usable && t.some(wordy)) { found = { h, t }; break; }
    if (usable && !fallback) fallback = { h, t };
    await closeMenu();
  }
  if (!found && fallback) { await openMenu(fallback.h.k); found = fallback; }
  if (!found)
    skip(4, "the in-column search narrows the value list",
         "no column menu with both a search box and a list long enough to narrow");
  else {
    const word = t => (t.aria || t.label).trim();
    /* The query comes off a word the operator can READ. Where the printed word
       differs from the stored value — "In market" over a row that says `in_market` —
       a search matched against the stored value alone finds nothing and empties the
       list, which is the failure this half of the check is for. A query that spans
       the space is the one that tells them apart. */
    const spaced = found.t.find(t => /\S\s\S/.test(word(t)));
    const src = spaced ?? found.t[0];
    const q = spaced ? word(src).slice(0, word(src).indexOf(" ") + 3) : word(src).slice(0, 3);
    const box = await page.$(scoped(SEL.menu, SEL.search));
    await box.click({ clickCount: 3 });
    await box.type(q);
    await sleep(450);
    const after = await ticks();
    const n0 = found.t.length, n1 = after.length;
    if (n1 === n0)
      fail(4, "the value list does not move while the search narrows the rows — "
            + "that is two controls, not one", `${n0} ticks before and after "${q}"`);
    else if (n1 === 0 && spaced)
      fail(4, "searching the word on screen empties the list — the search reads the "
            + "stored value only", `"${q}" from "${word(src)}" matched nothing`);
    else if (n1 === 0)
      fail(4, "the search matched none of its own values", `"${q}" of ${n0}`);
    else {
      pass(4, "the in-column search narrows the value list", `${n0} → ${n1} on "${q}"`);
      const kept = after.some(t => word(t).toLowerCase().startsWith(q.toLowerCase()));
      if (!spaced) skip(4, "the search matches the DISPLAYED word",
                        "no printed word here differs from its stored value — the two "
                        + "paths cannot be told apart from the browser");
      else kept ? pass(4, "the search matches the word on screen", `"${q}" → "${word(src)}"`)
                : fail(4, "the queried word is gone from its own list", `"${q}"`);
    }
    await box.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await sleep(350);
    await closeMenu();
  }
}

// ── 4. a value filter stores what is EXCLUDED, not what was accepted ───────────────
{
  /* The trap, driven: filter column A, untick a value in column B while A's filter
     is narrowing B's list, then lift A. Every B value that was NOT on screen when
     B's filter was made has to come back. Store the ACCEPTED set instead and those
     values are stranded outside it forever — including rows that only arrive later. */
  await closeMenu();
  const cols = await handleCols();
  const counted = [];
  for (const h of cols.slice(0, 8)) {
    if (!(await openMenu(h.k))) continue;
    counted.push({ ...h, n: (await ticks()).length });
    await closeMenu();
  }
  const wide = counted.filter(c => c.n >= 2).sort((a, b) => b.n - a.n)[0];
  const narrowers = counted.filter(c => c.n >= 2 && c !== wide);
  if (!wide || !narrowers.length)
    skip(4, "filters store the excluded set", "needs two columns with values to tick");
  else {
    const all = new Set(await colText(wide.col));
    let scenario = null;
    for (const nrw of narrowers) {
      await openMenu(nrw.k);
      await clickTick(0);                       // exclude one value of the narrowing column
      await closeMenu();
      const under = new Set(await colText(wide.col));
      const unseen = [...all].filter(v => !under.has(v));
      if (unseen.length) { scenario = { nrw, unseen, under }; break; }
      await openMenu(nrw.k);                    // no narrowing here: put it back and move on
      await clickTick(0);
      await closeMenu();
    }
    if (!scenario)
      skip(4, "filters store the excluded set",
           "no column here narrows another's value list — the two shapes cannot be told apart");
    else {
      const before = await rowCount();
      await openMenu(wide.k);
      await clickTick(0);                       // a filter made while values are out of sight
      await closeMenu();
      const narrowed = await rowCount();
      await openMenu(scenario.nrw.k);
      await clickTick(0);                       // lift the other column's filter
      await closeMenu();
      const back = new Set(await colText(wide.col));
      const stranded = scenario.unseen.filter(v => !back.has(v));
      narrowed < before
        ? pass(4, "unticking a value hides its rows", `${before} → ${narrowed}`)
        : fail(4, "unticking a value changed nothing", `${before} rows either way`);
      stranded.length === 0
        ? pass(4, "values unseen when the filter was made come back",
               `${scenario.unseen.length} of them, via ${scenario.nrw.label || "another column"}`)
        : fail(4, "a value the filter never saw is stranded — the accepted set was "
                + "stored instead of the excluded one",
               `${stranded.length} gone: ${stranded.slice(0, 3).join(", ")}`);
    }
  }
  /* Filters are a question, not a layout: a reload is the cheapest way back to a
     whole table for the checks below, and it proves they are session-local too. */
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(SEL.rows).catch(() => {});
  await sleep(200);
}

// ── 12. clearing a search RESTORES the rows — the ✕ and Escape, separately ─────────
{
  /* Ordering hazard, learned the hard way: rule 11 shuts the column menu with
     Escape, and in most tables that menu holds the only search box — so a rule 12
     that ran afterwards found nothing, SKIPPED, and the two behaviours it exists for
     went untested. This block opens its own menu and depends on no other. */
  await closeMenu();
  const inMenu = scoped(SEL.menu, SEL.search);
  if (!(await has(inMenu))) {
    const cols = await handleCols();
    for (const h of cols.slice(0, 8)) {
      if (await openMenu(h.k) && await has(inMenu)) break;
      await closeMenu();
    }
  }
  const searchSel = (await has(inMenu)) ? inMenu : SEL.search;
  if (searchSel === inMenu) judgeMagnifier(await magnifier(inMenu), "column menu");
  const boxes = await page.$$(searchSel);
  if (!boxes.length) gone(12, "no search box — not on the page, not in a column menu");
  else {
    const total = await rowCount();
    const box = boxes[0];
    // a query nothing can match: the rows either move or the box is decoration
    const Q = "zzqx";
    const typeQ = async () => {
      await box.click({ clickCount: 3 });
      await box.type(Q);
      await sleep(700);
    };
    await typeQ();
    const narrowed = await rowCount();
    narrowed < total ? pass(12, "typing in the box filters the rows", `${total} → ${narrowed}`)
                     : fail(12, "typing in the search box changes nothing", `${total} rows either way`);
    /* Rule 4's other half, and this is the one moment it can be driven: a body
       emptied by a filter must SAY it was filtered, or it reads as broken. */
    if (narrowed !== 0)
      skip(4, "the filtered-empty message", `the query still matched ${narrowed} rows`);
    else {
      const msg = await page.evaluate(sel => {
        const t = document.querySelector(sel);
        const seen = e => e && getComputedStyle(e).display !== "none" && e.textContent.trim();
        /* The hook first, the English words second. Judging this message by the words in it made
           the check blind to every table not written in English — a Romanian list saying
           "Niciun rezultat pentru filtrele curente" was reported as a body emptied with nothing
           saying why, which is the same false FAIL rule 14 describes for `Date.parse`. */
        const hooked = [...t.querySelectorAll("[data-empty-kind='filtered'], [data-empty]")].find(seen);
        const worded = [...t.querySelectorAll("*")].find(e =>
          /no (rows|records|results|matching)/i.test(e.textContent) && seen(e));
        const el = hooked || worded;
        return el ? el.textContent.replace(/\s+/g, " ").trim().slice(0, 60) : "";
      }, SEL.table);
      msg ? pass(4, "a table emptied by its filters says so", msg)
          : fail(4, "the body is empty with nothing saying why — filtered and "
                  + "no-data look identical", "0 rows, no message");
    }
    // A: the ✕ — and it has to restore the ROWS, not only blank the field
    const clearSel = (await has(scoped(SEL.menu, SEL.clear))) ? scoped(SEL.menu, SEL.clear) : SEL.clear;
    const visible = await page.evaluate(sel => {
      const b = document.querySelector(sel);
      return !!b && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0;
    }, clearSel);
    if (!visible) gone(12, "no clear button appears when the box has text");
    else {
      pass(12, "the clear button appears with text");
      await page.click(clearSel);
      await sleep(700);
      const value = await box.evaluate(e => e.isConnected ? e.value : "");
      const back = await rowCount();
      value === "" ? pass(12, "the ✕ empties the field") : fail(12, "the field still has text", value);
      back === total ? pass(12, "the ✕ restores the rows", `${back} of ${total}`)
                     : fail(12, "the field cleared but the filter is still applied", `${back} of ${total}`);
    }
    // B: Escape, tested on its own — the same two things, and neither is implied
    // by the other having worked
    if (!(await box.evaluate(e => e.isConnected)))
      skip(12, "Escape clears the search", "the ✕ took the box with it");
    else {
      await typeQ();
      const dropped = await rowCount();
      await page.keyboard.press("Escape");
      await sleep(700);
      const live = await box.evaluate(e => e.isConnected);
      const value = live ? await box.evaluate(e => e.value) : "";
      const back = await rowCount();
      if (!live) pass(12, "Escape emptied the field", "by closing the menu it lived in");
      else value === "" ? pass(12, "Escape empties the field")
                        : fail(12, "Escape left the text in the box", value);
      back === total ? pass(12, "Escape restores the rows", `${back} of ${total} after ${dropped}`)
                     : fail(12, "Escape blanked the box but left the filter on", `${back} of ${total}`);
    }
    await closeMenu();
  }
}

// ── 11 + 14. dates ─────────────────────────────────────────────────────────────────
{
  /* The shape is what rule 14 is about, not the language: a table written in Romanian
     prints "19 aug 2026" and that is the same rule obeyed. The month has to be WRITTEN
     (letters, 3+ of them), which is the whole point — it is what keeps 03/04 from being
     read as the 3rd of April by one reader and the 4th of March by another. */
  const FMT = /^\d{1,2} \p{L}{3,12}\.? \d{4}$/u;
  /* A date column is detected past its HOLES on purpose. Requiring every cell to
     parse meant a column with one dash in it stopped being a date column, and the
     dash check below — the whole reason the holes are collected — could never fire. */
  const dateCells = await page.evaluate(`(() => {
    const rows = ${DATA_ROWS};
    if (!rows.length) return [];
    const dash = s => /^(—|–|-|--|n\\/a|null|none)$/i.test(s);
    const n = rows[0].children.length, out = [];
    for (let i = 0; i < n; i++) {
      const cells = rows.map(r => r.children[i]?.textContent.trim() ?? "");
      const vals = cells.filter(v => v && !dash(v));
      // Date.parse only knows English month names, so a localised column would go
      // undetected — and an undetected column SKIPS its checks, which reads as clean
      // rule 19: a journal column carries a clock under the day, so the cell's text is
      // "15 Aug 2026 11:35Z". Strip a trailing clock before judging the shape — a checker
      // that only knows the bare day stops SEEING such a column, and an unseen column is
      // skipped, which reads exactly like a passing one.
      // The separator is OPTIONAL here on purpose. Requiring it meant the glued form —
      // the exact thing rule 19 forbids — stopped being recognised as a date at all, so
      // the column SKIPPED instead of failing. A rule whose own violation makes it
      // invisible is not a rule. Detect both shapes; the glued check below judges them.
      const clock = /[ \\u00a0]?\\d{1,2}:\\d{2}(:\\d{2})?\\s*(Z|[A-Z]{2,5}|[+-]\\d{2}:?\\d{2})?$/;
      const day = v => v.replace(clock, "").trim();
      const written = v => /^\\d{1,2} \\p{L}{3,12}\\.? \\d{4}$/u.test(day(v));
      // a numeric date (19.08.2026) is a date column too, and it has to be DETECTED so it
      // can FAIL rule 14 — otherwise the worst format on the list is the one that skips
      const numeric = v => /^\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}$/.test(v);
      // ISO and the long written form are dates too, and both have to be DETECTED so they
      // can FAIL rule 14. What must NOT reach Date.parse is anything else: it accepts
      // document codes — an invoice numbered "AAA-000001" comes back as 31 Dec 2000 — so a
      // column of document numbers was judged as a column of dates, and rule 14 failed on a
      // table whose real date column was correct. A false FAIL is as blind as a false PASS:
      // it hides the column that actually needed judging. Only these four shapes are dates.
      const iso = v => /^\\d{4}-\\d{2}-\\d{2}$/.test(v);
      const longform = v => /^\\p{L}{3,12}\\.? \\d{1,2},? \\d{4}$/u.test(v);
      // Date.parse is a guard on THOSE TWO ONLY, never a detector of its own. It cannot
      // see a Romanian month ("9 mai 2026" is NaN to it), so asking it about the written
      // form would skip every localised column — the failure the comment above names.
      const readable = v =>
        written(v) || numeric(v) ||
        ((iso(day(v)) || longform(day(v))) && !Number.isNaN(Date.parse(day(v))));
      if (vals.length >= 2 && vals.every(readable))
        out.push({ i, sample: vals[0], day: day(vals[0]),
                   clocked: vals.filter(v => clock.test(v)).length,
                   glued: vals.filter(v => /\\d{4}\\d{1,2}:\\d{2}/.test(v)).length,
                   dashes: cells.filter(dash), blanks: cells.filter(v => !v).length });
    }
    return out;
  })()`);
  if (!dateCells.length) skip(14, "date formatting", "no date column detected");
  else {
    const bad = dateCells.filter(c => !FMT.test(c.day));
    bad.length === 0
      ? pass(14, "dates print as 'd Mmm YYYY'", dateCells.map(c => c.sample).join(", "))
      : fail(14, "dates are not in 'd Mmm YYYY'", bad.map(c => c.sample).join(", "));

    /* rule 19 — a clock is welcome, but it must be SEPARATED. Glued to the year it is
       what a checker parses, a screen reader announces and a copy-paste yields. */
    const glued = dateCells.filter(c => c.glued);
    const clocked = dateCells.filter(c => c.clocked);
    if (glued.length)
      fail(19, "the clock is glued to the year — put a real space between them, not only a <br>",
           glued.map(c => `"${c.sample}"`).join(", "));
    else if (clocked.length)
      pass(19, "a dated column that carries a clock keeps them separable",
           clocked.map(c => `"${c.sample}"`).join(", "));
    else
      skip(19, "the clock under the day", "no date column carries a time — nothing to judge");
    const invalid = await page.evaluate(() => document.querySelector(window.__S.table).textContent.includes("Invalid"));
    invalid ? fail(14, "a cell renders as Invalid Date") : pass(14, "nothing renders as Invalid Date");
    /* A missing date is EMPTY, never a dash: one "—" and the column stops reading as
       dates at all — to the eye and to the detection above. */
    const dashed = dateCells.filter(c => c.dashes.length);
    const holes = dateCells.reduce((a, c) => a + c.blanks, 0);
    if (dashed.length)
      fail(14, "a date column prints a dash where the date is missing",
           dashed.map(c => `${c.dashes.length}× "${c.dashes[0]}"`).join(", "));
    else if (holes) pass(14, "a missing date renders as empty, not as a dash", `${holes} blank cells`);
    else skip(14, "a missing date renders as empty, not as a dash",
              "every row in view has its date — nothing missing to judge");
    // rule 11: does that column's menu offer a range? The handle is found through the
    // column it SITS IN — a column with no handle at all (an actions column) puts the
    // two lists out of step, and indexing one by the other opens the wrong menu.
    if (await has(SEL.menuHandle)) {
      const handles = await page.$$(SEL.menuHandle);
      const mapped = (await handleCols()).find(c => c.col === dateCells[0].i);
      const h = mapped ? handles[mapped.k] : null;
      if (h) {
        await h.click();
        await sleep(300);
        const range = await page.evaluate(sel => {
          const m = document.querySelector(sel);
          if (!m) return null;
          return { dates: m.querySelectorAll("input[type=date]").length,
                   /* Prefer the hook. Reading the period buttons by their English words was the
                      same blindness rule 14 warns about for `Date.parse`: a Romanian table offering
                      "Ultimele 30 de zile" reported ZERO periods and failed a control that was
                      right there and working. The regex stays as the fallback for a table that
                      carries no hook. */
                   periods: m.querySelectorAll("button[data-period]").length ||
                            [...m.querySelectorAll("button")].filter(b => /last|day|month|year/i.test(b.textContent)).length };
        }, SEL.menu);
        if (!range) fail(11, "the date column has no menu");
        else {
          range.dates >= 2 ? pass(11, "date column offers an exact from/to", `${range.dates} date inputs`)
                           : fail(11, "date column has no from/to range", `${range.dates} date inputs`);
          range.periods >= 2 ? pass(11, "date column offers quick periods", `${range.periods} buttons`)
                             : fail(11, "date column has no quick periods", `${range.periods} buttons`);

          /* The range has to be liftable in ONE move. A period writes it in one click; taking it
             back by emptying two boxes by hand is not an undo. Driven, not read: set a "from"
             through the native setter (React ignores a plain value write), watch the rows drop,
             then judge the reset by BOTH halves — the boxes empty AND the rows back. Setting the
             date rather than clicking a period keeps this check language-agnostic. */
          if (range.dates >= 2) {
            const before = await rowCount();
            /* Arm it the way a user does — a period button — and fall back to writing the "from"
               through the native setter for a table that has no periods. */
            const period = await page.$(SEL.menu + " button[data-period]");
            if (period) {
              await period.click();
              await sleep(900);
              /* Some tables re-render the panel when the filter lands, which detaches it. The
                 range is still set — reopen the same handle rather than reading a dead panel and
                 calling a live control missing. */
              if (!(await page.$(SEL.menu))) { await h.click(); await sleep(400); }
            }
            const armed = await page.evaluate(sel => {
              const box = document.querySelector(sel + " input[type=date]");
              if (!box) return null;
              if (!box.value) {
                const d = new Date(); d.setDate(d.getDate() - 3);
                const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                set.call(box, d.toISOString().slice(0, 10));
                box.dispatchEvent(new Event("input", { bubbles: true }));
                box.dispatchEvent(new Event("change", { bubbles: true }));
              }
              return box.value;
            }, SEL.menu);
            await sleep(900);
            const narrowed = await rowCount();
            const reset = await page.$(SEL.rangeReset);
            /* A range that would not go in is not a missing reset — say which of the two it was,
               or a check that armed nothing reports a control that exists as absent. */
            if (!armed)
              skip(11, "the range can be undone in one move", "no range would go into the from box — nothing to undo");
            else if (!reset) gone(11, "the date range cannot be undone in one move");
            else if (narrowed === before)
              skip(11, "the range reset gives the rows back",
                   `a from of ${armed} hid nothing here — nothing to give back`);
            else {
              await reset.click();
              await sleep(900);
              const back = await rowCount();
              const boxes = await page.evaluate(sel =>
                [...document.querySelectorAll(sel + " input[type=date]")].map(i => i.value), SEL.menu);
              boxes.every(v => v === "")
                ? pass(11, "the range reset clears both ends")
                : fail(11, "the range reset left a date behind", boxes.join(" / "));
              back === before
                ? pass(11, "the range reset gives the rows back", `${narrowed} → ${back} of ${before}`)
                : fail(11, "the range reset blanked the boxes but kept the filter",
                       `${before} → ${narrowed} → ${back}`);
            }
          }
        }
        await page.keyboard.press("Escape");
      }
    }
  }
}

// ── 5. the Columns panel: hide, add, and remove what the user made ─────────────────
{
  /** the panel usually hides behind a "Columns" button, and everything below needs
   *  it open — a popover that closes on an outside click has to be re-opened too */
  const openPanel = async () => {
    if (await has(SEL.addColumn)) return true;
    if (SEL.columnsBtn) await page.click(SEL.columnsBtn).catch(() => {});
    else {
      const opener = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button, [role=button]")]
          .find(b => /column|coloan/i.test(b.textContent) && !b.closest("table")));
      const el = opener.asElement();
      if (el) await el.click().catch(() => {});
    }
    await sleep(350);
    return has(SEL.addColumn);
  };
  const headers = () => page.$$eval(SEL.head, ts => ts.map(t => t.textContent.trim()));
  /** tick or untick a column by the word printed next to its box — stack-agnostic,
   *  where a `data-` hook per column key is not */
  const setVisible = (label, on) => page.evaluate((label, on, sel) => {
    const box = [...document.querySelectorAll("input[type=checkbox]")].find(b => {
      if (b.closest(sel.table) || b.closest(sel.menu)) return false;
      const t = (b.closest("label")?.textContent || b.getAttribute("aria-label") || "").trim();
      return t.toLowerCase().startsWith(label.toLowerCase());
    });
    if (!box) return false;
    if (box.checked !== on) box.click();
    return true;
  }, label, on, SEL);

  if (!(await openPanel())) gone(5, "no way to add a user-defined column");
  else {
    pass(5, "an add-column control exists");
    /* R5's other half, and the reason it is a rule: hiding a column has to drop
       what only its own header could show. A hidden column that still sorts or
       still filters leaves a list ordered — or trimmed to 14 of 35 rows — by
       something that is not on screen anywhere. */
    const cols = await handleCols();
    const victim = cols.find(c => c.label && c.col >= 0);
    /* The sort has to be judged by the ORDER OF THE ROWS, not by an aria-sort on the
       header: hiding the sorted column takes that header off the table, so every
       remaining one reads "none" and a surviving invisible sort looks like a dropped
       one. The witness is the column with the most distinct values — the join of them
       is a row-order signature, and one with repeats would not change when the rows
       move. */
    const spread = await page.evaluate(`(() => {
      const rows = ${DATA_ROWS};
      return [...document.querySelectorAll(window.__S.head)].map((th, i) => ({
        label: th.textContent.trim(), i, act: th.matches(window.__S.actions),
        n: new Set(rows.map(r => (r.children[i]?.textContent || "").trim())).size }));
    })()`);
    const witness = spread.filter(c => c.label && !c.act && c.label !== victim?.label)
                          .sort((a, b) => b.n - a.n)[0];
    const sigOf = async () => {
      const c = (await headers()).indexOf(witness.label);
      return c < 0 ? null : (await colText(c)).join("|");
    };
    const clickTh = c => page.evaluate(c => {
      [...document.querySelectorAll(window.__S.head)][c]?.click();
    }, c).then(() => sleep(280));
    const total0 = await rowCount();
    if (!victim || !witness)
      skip(5, "hiding a column drops its sort and its filter", "needs two labelled columns");
    else {
      const sig0 = await sigOf();
      await clickTh(victim.col);
      let sorted = await sigOf();
      if (sorted === sig0) { await clickTh(victim.col); sorted = await sigOf(); }   // try the other direction
      await openPanel();
      const hid = await setVisible(victim.label, false);
      await sleep(350);
      if (!hid) gone(5, "no show/hide control for an existing column");
      else {
        const off = !(await headers()).includes(victim.label);
        off ? pass(5, "unticking a column takes it off the table", victim.label)
            : fail(5, "the column is still in the header after being unticked", victim.label);
        if (sorted === sig0)
          skip(5, "hiding the sorted column drops the sort",
               `sorting ${victim.label} moves no row — nothing to observe`);
        else {
          const now = await sigOf();
          now !== sorted
            ? pass(5, "hiding the sorted column drops the sort", `the rows left ${victim.label}'s order`)
            : fail(5, "the list is still ordered by a column nobody can see", victim.label);
        }
        await openPanel();
        await setVisible(victim.label, true);
        await sleep(300);
      }
      // the filter, on its own hide cycle: one drive that changes two things cannot
      // say which of them came back
      let filtered = total0;
      if (await openMenu(victim.k)) {
        const t = await ticks();
        if (t.length >= 2) await clickTick(0);
        await closeMenu();
        filtered = await rowCount();
      }
      if (filtered === total0)
        skip(5, "hiding a filtered column drops its filter", `no value filter on ${victim.label} changed a row`);
      else {
        await openPanel();
        await setVisible(victim.label, false);
        await sleep(400);
        const back = await rowCount();
        back === total0
          ? pass(5, "hiding a filtered column drops its filter", `${filtered} → ${back} of ${total0}`)
          : fail(5, "rows are still hidden by an invisible column's filter", `${back} of ${total0}`);
        await openPanel();
        await setVisible(victim.label, true);
        await sleep(300);
      }
    }
    /* And a column the USER made can be REMOVED, not merely hidden: he made it, so
       he can unmake it. Hidden-only leaves it in the stored document forever with
       no control anywhere that deletes it. */
    await openPanel();
    if (!(await has(SEL.newColumn)))
      gone(5, "no name field beside the add-column control");
    else {
      const NAME = "Verify tmp";
      const field = await page.$(SEL.newColumn);
      await field.click({ clickCount: 3 });
      await field.type(NAME);
      await page.click(SEL.addColumn);
      await sleep(500);
      const made = (await headers()).some(h => h.toLowerCase().startsWith(NAME.toLowerCase()));
      made ? pass(5, "the add-column control really adds one",
                  "confirm by hand that it writes a real field to the database")
           : fail(5, "the add-column control added no column", NAME);
      if (made) {
        await openPanel();
        const removed = await page.evaluate((sel, name) => {
          const btns = [...document.querySelectorAll(sel.colRemove)];
          const b = btns.find(x => new RegExp(name, "i")
                     .test(x.getAttribute("aria-label") + " " + (x.closest("label")?.textContent || "")))
                 ?? btns[btns.length - 1];
          if (!b) return false;
          b.click();
          return true;
        }, SEL, NAME);
        await sleep(500);
        if (!removed)
          gone(5, "a user-made column can be hidden but never removed");
        else {
          const still = (await headers()).some(h => h.toLowerCase().startsWith(NAME.toLowerCase()));
          still ? fail(5, "the remove control left the column on the table", NAME)
                : pass(5, "a user-made column can be removed", NAME);
        }
      }
    }
  }
}

pageErrors.length ? fail(0, "uncaught page errors", pageErrors.join(" | ")) : pass(0, "no uncaught page errors");

await browser.close();

/* ── report ───────────────────────────────────────────────────────────────────────── */
const pad = s => s.padEnd(7);
for (const r of results) {
  console.log(`${pad(r.state)} rule ${String(r.rule).padStart(2)}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
const n = s => results.filter(r => r.state === s).length;
console.log(`\n${n("PASS")} pass · ${n("FAIL")} fail · ${n("MISSING")} missing · ${n("SKIP")} skip`);
const broken = n("FAIL") + n("MISSING");
console.log(broken ? "RESULT: NOT DONE" : "RESULT: MEETS THE STANDARD");
process.exit(broken ? 1 : 0);
