import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const shots = [["materie-light", 1440, 1000, "/materie", "light"], ["mobil", 390, 844, "/", "light"], ["demo", 1440, 1000, "/demo-tabel", "light"], ["demo-dark-menu", 1440, 1000, "/demo-tabel", "dark"]];
for (const [name, w, h, path, scheme] of shots) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  await p.goto("http://127.0.0.1:5199" + path, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 600));
  if (name === "demo-dark-menu") { await p.click("[data-cmenu]"); await new Promise(r => setTimeout(r, 400)); }
  await p.screenshot({ path: `/tmp/shot-${name}.png` });
  await p.close();
}
await b.close();
console.log("ok");
