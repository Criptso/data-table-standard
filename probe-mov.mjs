import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  userDataDir: '/Volumes/2Tm2/TEMP/casestock-verify/t29/chrome-probe2', args: ['--no-first-run','--no-default-browser-check'] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080 });
await p.goto('http://127.0.0.1:3428/e2e/login?name=cristi&pin=2468&next=/admin/movements', { waitUntil: 'networkidle2' });
await p.waitForSelector('tbody tr');
console.log(await p.evaluate(() => {
  const f = document.querySelector('.tfoot');
  const t = document.querySelector('.tbl-wrap');
  return { tfootTop: f && Math.round(f.getBoundingClientRect().top), inner: window.innerHeight,
           wrapBottom: t && Math.round(t.getBoundingClientRect().bottom),
           sameParent: !!(t && t.parentElement.querySelector(':scope > .tfoot')) };
}));
await b.close();
