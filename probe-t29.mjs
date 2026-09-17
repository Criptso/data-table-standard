import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:3428/e2e/login?name=cristi&pin=2468&next=/admin/projects';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  userDataDir: '/Volumes/2Tm2/TEMP/casestock-verify/t29/chrome-probe', args: ['--no-first-run','--no-default-browser-check'] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('tbody tr');
// open the date column's menu
const opened = await p.evaluate(() => {
  const th = [...document.querySelectorAll('thead th')].find(t => /DUE/i.test(t.textContent));
  const h = th?.querySelector('[data-cmenu]');
  h?.click();
  return !!h;
});
await new Promise(r => setTimeout(r, 400));
const info = await p.evaluate(() => {
  const menu = document.querySelector('.column-menu');
  const btn = [...document.querySelectorAll('button, [role=button]')].find(b => /column|coloan/i.test(b.textContent) && !b.closest('table'));
  const r = (e) => e ? (({x,y,width,height,top,left,right,bottom}) => ({x,y,width,height,top,left,right,bottom}))(e.getBoundingClientRect()) : null;
  const bb = r(btn);
  const at = bb ? document.elementFromPoint(bb.left + bb.width/2, bb.top + bb.height/2) : null;
  return { menu: r(menu), btn: bb, btnText: btn?.textContent, topmost: at ? at.className + '|' + at.tagName : null,
           addCol: !!document.querySelector('[data-add-column]') };
});
console.log('opened', opened, JSON.stringify(info, null, 1));
// now do what openPanel does
const el = await p.evaluateHandle(() => [...document.querySelectorAll('button, [role=button]')].find(b => /column|coloan/i.test(b.textContent) && !b.closest('table')));
const h = el.asElement(); if (h) await h.click().catch(e => console.log('click err', e.message));
await new Promise(r => setTimeout(r, 400));
console.log('after click: addCol =', await p.evaluate(() => !!document.querySelector('[data-add-column]')),
            '| menu still open =', await p.evaluate(() => !!document.querySelector('.column-menu')));
await b.close();
