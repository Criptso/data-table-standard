/* Drive the real page and prove each behaviour by interaction, not by screenshot. */
import puppeteer from "puppeteer-core";
const URL = process.argv[2];
const SHOTS = process.argv[3];
const REDUCE = process.argv[4] === "reduce";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (n, d) => console.log(`PASS  ${n}${d ? " — " + d : ""}`);
const no = (n, d) => { fails++; console.log(`FAIL  ${n}${d ? " — " + d : ""}`); };
const t = (c, n, d) => c ? ok(n, d) : no(n, d);

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--no-sandbox"]
});
const p = await b.newPage();
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: REDUCE ? "reduce" : "no-preference" }]);
await p.goto(URL, { waitUntil: "networkidle2" });
await sleep(1000);
console.log(REDUCE ? "── prefers-reduced-motion: REDUCE ──" : "── prefers-reduced-motion: no-preference ──");

const rows = () => p.$$eval("tbody tr:not([data-empty])", rs => rs.length);
const firstNames = () => p.$$eval("tbody tr:not([data-empty]) td.c-name", cs => cs.slice(0, 3).map(c => c.textContent.trim()));
const heads = () => p.$$eval("thead th", ts => ts.map(x => x.textContent.trim().split("\n")[0]));
const shot = async n => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/state-${n}.png` }); };

/* 1 ── sorting really reorders */
{
  const before = await firstNames();
  await p.click("thead th:nth-child(1)");
  await sleep(300);
  const asc = await firstNames();
  await p.click("thead th:nth-child(1)");
  await sleep(300);
  const desc = await firstNames();
  t(asc.join("|") !== before.join("|"), "sort NUME asc changes the order", `${before[0]} → ${asc[0]}`);
  t(desc.join("|") !== asc.join("|"), "sort NUME desc reverses it", `${asc[0]} → ${desc[0]}`);
  const mark = await p.$eval("thead th:nth-child(1)", th => th.getAttribute("aria-sort") + " " + th.querySelector(".sm").textContent);
  t(/ascending|descending/.test(mark), "the sorted column carries a direction indicator", mark.trim());
  await shot("sorted");
}

/* 2 ── the column menu filters by value */
{
  await p.click("thead th:nth-child(2) [data-cmenu]");
  await sleep(350);
  const open = await p.$eval("#colFilterMenu", m => !m.hidden);
  t(open, "the circle handle opens CATEGORIE's menu");
  const total = await rows();
  await p.evaluate(() => {
    const cbs = [...document.querySelectorAll("#colFilterMenu input[type=checkbox]")]
      .filter(c => !c.hasAttribute("data-all"));
    cbs[0].click();
  });
  await sleep(400);
  const after = await rows();
  t(after < total, "unticking one CATEGORIE value hides its rows", `${total} → ${after}`);
  await shot("filtered");
  /* the tick comes back — the excluded set, not the accepted one */
  await p.evaluate(() => {
    const cbs = [...document.querySelectorAll("#colFilterMenu input[type=checkbox]")]
      .filter(c => !c.hasAttribute("data-all"));
    cbs[0].click();
  });
  await sleep(400);
  t(await rows() === total, "re-ticking it restores them", `${await rows()} of ${total}`);
  await p.keyboard.press("Escape");
  await sleep(250);
}

/* 3 ── the in-column search, its ✕ and Escape */
{
  await p.click("thead th:nth-child(2) [data-cmenu]");
  await sleep(350);
  const total = await rows();
  await p.type("#colFilterMenu .cm-search input", "video");
  await sleep(500);
  const narrowed = await rows();
  const listed = await p.$$eval("#colFilterMenu .cm-values label", ls => ls.length);
  t(narrowed < total, "typing in the column search filters the rows", `${total} → ${narrowed}`);
  t(listed > 0 && listed < 60, "the value list narrows with it", `${listed} values left`);
  await p.click("#colFilterMenu .cm-search .xclr");
  await sleep(450);
  const back = await rows();
  const val = await p.$eval("#colFilterMenu .cm-search input", i => i.value);
  t(val === "" && back === total, "the ✕ empties the field AND restores the rows", `"${val}" · ${back} of ${total}`);
  await p.type("#colFilterMenu .cm-search input", "video");
  await sleep(400);
  await p.keyboard.press("Escape");
  await sleep(400);
  const val2 = await p.$eval("#colFilterMenu .cm-search input", i => i.value);
  t(val2 === "" && await rows() === total, "Escape does the same, on its own", `"${val2}" · ${await rows()} of ${total}`);
  await p.keyboard.press("Escape");
  await sleep(250);
}

/* 4 ── the date range on LANSAT */
{
  await p.click("thead th:nth-child(5) [data-cmenu]");
  await sleep(350);
  const total = await rows();
  const dates = await p.$$eval("#colFilterMenu input[type=date]", i => i.length);
  const periods = await p.$$eval("#colFilterMenu [data-period]", b2 => b2.map(x => x.textContent.trim()));
  t(dates === 2, "LANSAT offers an exact from/to", `${dates} date inputs`);
  t(periods.length >= 4, "and quick periods", periods.join(" / "));
  await p.click("#colFilterMenu [data-period='30']");
  await sleep(450);
  const p30 = await rows();
  t(p30 < total && p30 > 0, "the 30-day period narrows the register", `${total} → ${p30}`);
  const from = await p.$eval("#colFilterMenu [data-from]", i => i.value);
  t(/^\d{4}-\d{2}-\d{2}$/.test(from), "the period wrote an adjustable FROM date", from);
  /* an exact range typed by hand */
  await p.evaluate(() => {
    const f = document.querySelector("#colFilterMenu [data-from]");
    const to = document.querySelector("#colFilterMenu [data-to]");
    f.value = "2026-01-01"; f.dispatchEvent(new Event("input", { bubbles: true }));
    to.value = "2026-03-31"; to.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(450);
  const inRange = await p.$$eval("tbody tr:not([data-empty]) td.c-rele", cs => cs.map(c => c.textContent.trim()));
  const allQ1 = inRange.length > 0 && inRange.every(s => /Jan|Feb|Mar/.test(s) && /2026/.test(s));
  t(allQ1, "an exact from/to keeps only dates inside it", `${inRange.length} rows: ${inRange.slice(0, 4).join(", ")}`);
  await shot("date-range");
  await p.click("#colFilterMenu [data-clearrange]");
  await sleep(400);
  t(await rows() === total, "clearing the range restores the register", `${await rows()} of ${total}`);
  await p.keyboard.press("Escape");
  await sleep(200);
}

/* 5 ── the global search, its ✕, and the empty state */
{
  const total = await rows();
  await p.type("#q", "transcription");
  await sleep(450);
  const n = await rows();
  t(n < total && n > 0, "the global search filters", `${total} → ${n}`);
  await p.click("#q", { clickCount: 3 });
  await p.type("#q", "zzqx");
  await sleep(450);
  const empty = await p.$eval("tbody", tb => (tb.querySelector("[data-empty]") || {}).textContent || "");
  t(await rows() === 0 && /No rows match/.test(empty), "an emptied table says why", empty.replace(/\s+/g, " ").slice(0, 48));
  await shot("empty");
  await p.click("#qclr");
  await sleep(450);
  t(await rows() === total && await p.$eval("#q", i => i.value) === "", "the ✕ restores every row", `${await rows()} of ${total}`);
}

/* 6 ── drag-reorder and resize survive a reload */
{
  const before = await heads();
  await p.evaluate(() => {
    const ths = [...document.querySelectorAll("thead th")];
    const dt = new DataTransfer();
    ths[3].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    ths[0].dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    ths[0].dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  });
  await sleep(350);
  const moved = await heads();
  t(moved[0] === before[3], "dragging PREȚ into position 1 moves it", `${before[0]} → ${moved[0]}`);
  /* the frozen column follows the drag: whatever sits in position 1 freezes */
  const frozen = await p.$eval("tbody tr td:first-child", td => getComputedStyle(td).position);
  t(frozen === "sticky", "and the new first column is the frozen one", frozen);

  const box = await (await p.$("thead th:nth-child(1) .rz")).boundingBox();
  const w0 = await p.$eval("thead th:nth-child(1)", e => Math.round(e.getBoundingClientRect().width));
  await p.mouse.move(box.x + 3, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + 3 + 120, box.y + box.height / 2, { steps: 12 });
  await p.mouse.up();
  await sleep(350);
  const w1 = await p.$eval("thead th:nth-child(1)", e => Math.round(e.getBoundingClientRect().width));
  t(w1 > w0 + 60, "dragging the grip widens that column", `${w0} → ${w1}px`);

  await p.reload({ waitUntil: "networkidle2" });
  await sleep(900);
  const back = await heads();
  const w2 = await p.$eval("thead th:nth-child(1)", e => Math.round(e.getBoundingClientRect().width));
  t(back[0] === moved[0], "the order survives a reload", back.join(" · "));
  t(Math.abs(w2 - w1) < 4, "so does the width", `${w1} → ${w2}px`);
  await shot("reordered");
}

/* 7 ── the row opens the panel with the right data, and closes */
{
  const name = await p.$eval("tbody tr:not([data-empty]) td.c-name", c => c.textContent.trim());
  const slug = await p.$eval("tbody tr:not([data-empty])", r => r.dataset.slug);
  await p.click("tbody tr:not([data-empty]) td.c-cate");
  await sleep(500);
  const open = await p.$eval("#panel", d => d.open);
  const h2 = await p.$eval("#panel h2", h => h.textContent.trim());
  const perma = await p.$eval('#panel a[href^="t/"]', a => a.getAttribute("href"));
  const srcs = await p.$$eval("#panel .srclist li a", a => a.map(x => x.textContent.trim()));
  const refs = await p.$$eval("#panel .ref", r => r.length);
  const stats = await p.$$eval("#panel .stat", s => s.map(x => x.textContent.trim()));
  t(open, "clicking a row opens the detail panel");
  t(h2 === name, "the panel shows THAT row's tool", `${name} = ${h2}`);
  t(perma === "t/" + slug + ".html", "the panel exposes the permalink", perma);
  t(srcs.length > 0 && srcs.every(s => /\./.test(s)), "the verification sources are real hostnames", srcs.slice(0, 3).join(", "));
  t(refs > 0, "each claim cites the sources by number", `${refs} refs`);
  t(stats.length > 0 && stats.every(s => /Confirmed|Not confirmed/.test(s)), "status is icon + word, never colour alone", stats.slice(0, 2).join(" / "));
  await shot("panel");
  await p.click("#panel [data-close]");
  await sleep(400);
  t(!(await p.$eval("#panel", d => d.open)), "the close button closes it");
  await p.click("tbody tr:not([data-empty]) td.c-cate");
  await sleep(400);
  await p.keyboard.press("Escape");
  await sleep(400);
  t(!(await p.$eval("#panel", d => d.open)), "so does Escape");
}

/* 8 ── the external link is a link, not a row click */
{
  const href = await p.$eval("td.c-link a", a => a.href);
  const tgt = await p.$eval("td.c-link a", a => a.target + " " + a.rel);
  t(/^https?:/.test(href), "LINK carries the real official URL", href.slice(0, 46));
  t(/_blank/.test(tgt), "and opens in a new tab", tgt);
}

/* 9 ── the freshness stamp */
{
  const foot = await p.$eval("footer", f => f.textContent.replace(/\s+/g, " ").trim());
  t(/Last refreshed \d{1,2} \w{3} \d{4}/.test(foot), "the footer carries the build stamp", foot.slice(0, 60));
}

/* 10 ── the 3-line cap and its hover reveal */
{
  const clipped = await p.evaluate(() => {
    const c = [...document.querySelectorAll("td.wrap .clamp")].find(e => e.scrollHeight > e.clientHeight + 1);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { lines: getComputedStyle(c).webkitLineClamp, x: r.x + r.width / 2, y: r.y + r.height / 2, text: c.textContent.trim() };
  });
  t(clipped && clipped.lines === "3", "long cells cap at three lines", clipped && clipped.lines);
  if (clipped) {
    await p.mouse.move(clipped.x, clipped.y);
    await sleep(400);
    const peek = await p.$eval("#peek", e => e.hidden ? "" : e.textContent.trim());
    t(peek === clipped.text, "hovering a clipped cell reveals the whole value", peek.slice(0, 44) + "…");
  }
}

/* 11 ── motion honours the OS setting */
{
  const d = await p.evaluate(() => {
    const dlg = document.getElementById("panel");
    dlg.showModal();
    const s = getComputedStyle(dlg);
    const out = { anim: s.animationName, dur: s.animationDuration };
    dlg.close();
    return out;
  });
  const fast = parseFloat(d.dur) <= 0.002;
  t(REDUCE ? fast : !fast, REDUCE ? "the panel does not slide under Reduce Motion" : "the panel animates when motion is allowed",
    `${d.anim} ${d.dur}`);
}

t(errs.length === 0, "no uncaught page errors", errs.join(" | ") || "none");
console.log(`\n${fails === 0 ? "ALL CHECKS PASS" : fails + " CHECK(S) FAILED"}`);
await b.close();
process.exit(fails ? 1 : 0);
