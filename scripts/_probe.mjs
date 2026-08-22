import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: process.argv[2], headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
let t0 = Date.now();
const r2 = await p.goto("http://127.0.0.1:5199/demo-tabel", { waitUntil: "networkidle2", timeout: 15000 }).catch(e => console.log("page:", e.message));
console.log("status", r2?.status(), Date.now() - t0, "rows", await p.$$eval("tbody tr", r => r.length).catch(() => -1));
await b.close();
