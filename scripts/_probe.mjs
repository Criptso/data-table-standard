import puppeteer from "puppeteer-core";
const exe = process.argv[2];
const b = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage(); const t0 = Date.now();
p.on("response", r => console.log("res", Date.now()-t0, r.status(), r.url().slice(0,60)));
p.on("requestfailed", r => console.log("FAILED", r.url().slice(0,80), r.failure()?.errorText));

await p.goto("http://localhost:5199/demo-tabel", { waitUntil: "load", timeout: 20000 }).catch(e => console.log("goto:", e.message));
console.log("loaded in", Date.now() - t0, "rows:", await p.$$eval("tbody tr", r => r.length).catch(e => e.message));
await b.close();
