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
    "search":     "input[type=search], input[placeholder*='search' i], input[placeholder*='contains' i]",
    "clear":      ".xclr, [data-clears], button[aria-label*='clear' i]",
    "addColumn":  "[data-add-column], #addColBtn"
  },
  "chrome": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "viewport": { "width": 1200, "height": 850 }
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
  search: "input[type=search], input[placeholder*='search' i], input[placeholder*='contains' i]",
  clear: ".xclr, [data-clears], button[aria-label*='clear' i]",
  addColumn: "[data-add-column], #addColBtn",
  ...(cfg.sel || {}),
};
const CHROME = cfg.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VP = cfg.viewport || { width: 1200, height: 850 };
const URL = argv[0];

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
await page.goto(URL, { waitUntil: "networkidle2" });
await page.waitForSelector(SEL.rows, { timeout: 20000 }).catch(() => {});

const has = async sel => (await page.$(sel)) !== null;
const rowCount = () => page.$$eval(SEL.rows, r => r.length);
const rowOrder = () => page.$$eval(SEL.rows, rs => rs.map(r => r.textContent.trim().slice(0, 40)));

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
    return { head: cr(ths.color, ths.backgroundColor), rows: median,
             sticky: ths.position, headBg: ths.backgroundColor, bodyBg: bg,
             weight: ths.fontWeight, align: ths.textAlign, transform: ths.textTransform };
  })()`);
  if (!m) gone(1, "header + rows found");
  else {
    m.head >= 7
      ? pass(1, "header contrast", `${m.head.toFixed(2)}:1`)
      : fail(1, "header contrast below 7:1", `${m.head.toFixed(2)}:1`);
    m.head > m.rows
      ? pass(1, "header brighter than a typical row", `${m.head.toFixed(2)}:1 vs median ${m.rows.toFixed(2)}:1`)
      : fail(1, "header dimmer than the rows it labels", `${m.head.toFixed(2)}:1 vs median ${m.rows.toFixed(2)}:1`);
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

// ── 3. sorting ─────────────────────────────────────────────────────────────────────
if (await rowCount() < 2) skip(3, "sorting", "fewer than two rows");
else {
  const before = await rowOrder();
  await page.click(`${SEL.head}`);
  await sleep(250);
  const asc = await rowOrder();
  await page.click(`${SEL.head}`);
  await sleep(250);
  const desc = await rowOrder();
  asc.join("|") !== desc.join("|")
    ? pass(3, "clicking a title reorders rows", `${asc[0]?.slice(0, 18)} ↔ ${desc[0]?.slice(0, 18)}`)
    : fail(3, "clicking a title changes nothing", "dead control");
  const marked = await page.evaluate(() => {
    const th = document.querySelector(window.__S.head);
    return th.className !== "" || th.querySelector("span, svg, i") !== null;
  });
  marked ? pass(3, "the sorted column is marked") : fail(3, "no visible sort indicator");
  void before;
}

// ── 7. frozen first column ─────────────────────────────────────────────────────────
{
  // narrow the window first: a table that happens to fit today will not fit tomorrow, and
  // "it did not scroll" is a poor reason to leave freeze panes untested
  await page.setViewport({ width: 640, height: VP.height });
  await sleep(200);
  const r = await page.evaluate(() => {
    const table = document.querySelector(window.__S.table);
    let sc = window.__S.scroller ? document.querySelector(window.__S.scroller) : table?.parentElement;
    while (sc && sc !== document.body && sc.scrollWidth <= sc.clientWidth) sc = sc.parentElement;
    if (!sc || sc.scrollWidth <= sc.clientWidth) return { noScroll: true };
    const row = document.querySelector(window.__S.rows);
    const first = row.children[0], other = row.children[Math.min(2, row.children.length - 1)];
    sc.scrollLeft = 0;
    const a = first.getBoundingClientRect().x, oa = other.getBoundingClientRect().x;
    sc.scrollLeft = Math.min(400, sc.scrollWidth - sc.clientWidth);
    const b = first.getBoundingClientRect().x, ob = other.getBoundingClientRect().x;
    sc.scrollLeft = 0;
    return { held: Math.abs(a - b) < 2, otherMoved: Math.abs(oa - ob) > 10 };
  });
  if (r.noScroll) skip(7, "frozen first column", "table still fits at 640px — nothing to scroll");
  else if (r.held && r.otherMoved) pass(7, "first column stays put while the rest scrolls");
  else fail(7, "first column is not frozen", `held=${r.held} otherMoved=${r.otherMoved}`);
  await page.setViewport(VP);
  await sleep(200);
}

// ── 6. reorder by drag ─────────────────────────────────────────────────────────────
{
  const draggable = await page.$eval(SEL.head, th => th.draggable).catch(() => false);
  if (!draggable) gone(6, "headers are not draggable");
  else {
    const before = await page.$$eval(SEL.head, ts => ts.map(t => t.textContent.trim()));
    await page.evaluate(() => {
      const ths = [...document.querySelectorAll(window.__S.head)];
      const dt = new DataTransfer();
      ths[2]?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      ths[0]?.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
      ths[0]?.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      ths[2]?.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    });
    await sleep(250);
    const after = await page.$$eval(SEL.head, ts => ts.map(t => t.textContent.trim()));
    before[0] !== after[0]
      ? pass(6, "dragging a header reorders the columns", `${before[0]} → ${after[0]}`)
      : fail(6, "dragging a header changes nothing", "dead control");
    // a URL that pins the columns legitimately wins over stored preferences, so persistence
    // cannot be observed from such a link — say so rather than accusing the app
    if (new global.URL(URL).search) skip(6, "order persists across reloads", "this URL pins the columns");
    else {
      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForSelector(SEL.rows).catch(() => {});
      const reloaded = await page.$$eval(SEL.head, ts => ts.map(t => t.textContent.trim()));
      reloaded[0] === after[0] ? pass(6, "the order survives a reload")
                               : fail(6, "the order is forgotten on reload", `${after[0]} → ${reloaded[0]}`);
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
    inside.fitsWindow ? pass(4, "the menu fits the window or scrolls")
                      : fail(4, "the menu overflows the window, hiding its own controls");
  }
}

// ── 11 + 14. dates ─────────────────────────────────────────────────────────────────
{
  const FMT = /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/;
  const dateCells = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(window.__S.rows)];
    if (!rows.length) return [];
    const n = rows[0].children.length, out = [];
    for (let i = 0; i < n; i++) {
      const vals = rows.map(r => r.children[i]?.textContent.trim()).filter(Boolean);
      if (vals.length && vals.every(v => !Number.isNaN(Date.parse(v)) && /\d{4}/.test(v)))
        out.push({ i, sample: vals[0] });
    }
    return out;
  });
  if (!dateCells.length) skip(14, "date formatting", "no date column detected");
  else {
    const bad = dateCells.filter(c => !FMT.test(c.sample));
    bad.length === 0
      ? pass(14, "dates print as 'd Mmm YYYY'", dateCells.map(c => c.sample).join(", "))
      : fail(14, "dates are not in 'd Mmm YYYY'", bad.map(c => c.sample).join(", "));
    const invalid = await page.evaluate(() => document.querySelector(window.__S.table).textContent.includes("Invalid"));
    invalid ? fail(14, "a cell renders as Invalid Date") : pass(14, "nothing renders as Invalid Date");
    // rule 11: does that column's menu offer a range?
    if (await has(SEL.menuHandle)) {
      const handles = await page.$$(SEL.menuHandle);
      const h = handles[dateCells[0].i];
      if (h) {
        await h.click();
        await sleep(300);
        const range = await page.evaluate(sel => {
          const m = document.querySelector(sel);
          if (!m) return null;
          return { dates: m.querySelectorAll("input[type=date]").length,
                   periods: [...m.querySelectorAll("button")].filter(b => /last|day|month|year/i.test(b.textContent)).length };
        }, SEL.menu);
        if (!range) fail(11, "the date column has no menu");
        else {
          range.dates >= 2 ? pass(11, "date column offers an exact from/to", `${range.dates} date inputs`)
                           : fail(11, "date column has no from/to range", `${range.dates} date inputs`);
          range.periods >= 2 ? pass(11, "date column offers quick periods", `${range.periods} buttons`)
                             : fail(11, "date column has no quick periods", `${range.periods} buttons`);
        }
        await page.keyboard.press("Escape");
      }
    }
  }
}

// ── 12. the clear button on search boxes ───────────────────────────────────────────
{
  const boxes = await page.$$(SEL.search);
  if (!boxes.length) skip(12, "search clear button", "no search box found");
  else {
    const total = await rowCount();
    const box = boxes[0];
    await box.click({ clickCount: 3 });
    await box.type("a");
    await sleep(700);
    const visible = await page.evaluate(sel => {
      const b = document.querySelector(sel);
      return !!b && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0;
    }, SEL.clear);
    if (!visible) gone(12, "no clear button appears when the box has text");
    else {
      pass(12, "the clear button appears with text");
      await page.click(SEL.clear);
      await sleep(700);
      const value = await page.evaluate(sel => document.querySelector(sel).value, SEL.search);
      const back = await rowCount();
      value === "" ? pass(12, "clearing empties the field") : fail(12, "the field still has text", value);
      back === total ? pass(12, "clearing restores the rows", `${back} of ${total}`)
                     : fail(12, "the field cleared but the filter is still applied", `${back} of ${total}`);
    }
  }
}

// ── 5. add a column ────────────────────────────────────────────────────────────────
{
  // the control usually lives inside a "Columns" panel that has to be opened first
  if (!(await has(SEL.addColumn))) {
    const opener = await page.evaluateHandle(() =>
      [...document.querySelectorAll("button, [role=button]")]
        .find(b => /column|coloan/i.test(b.textContent) && !b.closest("table")));
    const el = opener.asElement();
    if (el) { await el.click().catch(() => {}); await sleep(300); }
  }
  (await has(SEL.addColumn))
    ? pass(5, "an add-column control exists", "confirm by hand that it writes a real field to the database")
    : gone(5, "no way to add a user-defined column");
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
