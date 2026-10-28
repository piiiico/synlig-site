// Runtime WCAG check on the RENDERED page: every element with own visible text,
// computed colour vs first opaque ancestor background. Usage: bun contrast-live.ts URL...
import puppeteer from "/workspace/node_modules/puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const p = await b.newPage();
await p.setUserAgent("Pico-contrast-check/1.0 (AI agent; synligdigital.no)");
let bad = 0, total = 0;
for (const url of process.argv.slice(2)) {
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(url, { waitUntil: "networkidle0" });
  const res = await p.evaluate(() => {
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const out: string[] = []; let n = 0;
    for (const el of document.querySelectorAll("body *")) {
      const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || (el as HTMLElement).offsetParent === null && cs.position !== "fixed") continue;
      let bg: number[] | null = null;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const c = rgb(getComputedStyle(a).backgroundColor);
        if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) { bg = c.slice(0, 3); break; }
      }
      bg ??= [255, 255, 255];
      const fg = rgb(cs.color).slice(0, 3);
      const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const r = (l1 + 0.05) / (l2 + 0.05); n++;
      if (r < 4.5) out.push(`${r.toFixed(2)} ${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 30)} «${el.textContent!.trim().slice(0, 40)}» fg=${cs.color} bg=rgb(${bg})`);
    }
    return { n, out };
  });
  total += res.n; bad += res.out.length;
  console.log(`== ${url}: ${res.n} text elements, ${res.out.length} below 4.5`);
  for (const l of res.out.slice(0, 15)) console.log("  " + l);
}
await b.close();
if (total < 50) { console.error(`NO VERDICT: only ${total} text elements parsed`); process.exit(2); }
process.exit(bad ? 1 : 0);
