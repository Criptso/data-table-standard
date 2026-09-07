const puppeteer = await import('puppeteer-core').then(m => m.default ?? m);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2], col = Number(process.argv[3]);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle2' });
await p.waitForSelector('tbody tr', { timeout: 15000 }).catch(() => {});
const out = await p.evaluate((col) => {
  const heads = [...document.querySelectorAll('thead th')].map(t => t.textContent.trim());
  const rows = [...document.querySelectorAll('tbody tr')];
  return { heads, cells: rows.map(r => {
    const c = r.children[col];
    if (!c) return 'null';
    const st = getComputedStyle(c);
    return JSON.stringify(c.textContent) + '  white-space=' + st.whiteSpace + '  text-align=' + st.textAlign + '  font=' + st.fontFamily.split(',')[0];
  }) };
}, col);
console.log(out.heads.map((h,i)=>i+':'+h).join(' | '));
console.log(out.cells.join('\n'));
await b.close();
