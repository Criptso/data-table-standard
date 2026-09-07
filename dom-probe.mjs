import puppeteer from 'puppeteer';
const url = process.argv[2], col = Number(process.argv[3]);
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle2' });
await p.waitForSelector('tbody tr', { timeout: 15000 }).catch(() => {});
const out = await p.evaluate((col) => {
  const heads = [...document.querySelectorAll('thead th')].map(t => t.textContent.trim());
  const rows = [...document.querySelectorAll('tbody tr')];
  return { heads, cells: rows.map(r => JSON.stringify(r.children[col]?.textContent ?? null)) };
}, col);
console.log(out.heads.map((h,i)=>i+':'+h).join(' | '));
console.log(out.cells.join('\n'));
await b.close();
