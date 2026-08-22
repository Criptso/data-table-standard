import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const shots = [["materie-light", 1440, 1000, "/materie", null], ["materie-dark", 1440, 1000, "/materie", "dark"], ["mobil", 390, 844, "/", null], ["demo", 1440, 1000, "/demo-tabel", null], ["setari", 1440, 1000, "/setari/inteligenta-artificiala", null]];
for (const [name, w, h, path, theme] of shots) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  if (theme) await p.evaluateOnNewDocument(t => localStorage.setItem("meditator.theme", t), theme);
  await p.goto("http://127.0.0.1:5199" + path, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 600));
  await p.screenshot({ path: `/tmp/shot-${name}.png` });
  await p.close();
}
await b.close();
console.log("ok");
