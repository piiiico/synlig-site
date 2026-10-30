// Reprice backfill (task 155aebffc4fec343, Håkon 10-28 «altfor dyrt»): every
// cold report baked before 2026-10-30 quotes the retired Sitert price. Rewrites
// the visible price strings to the live one from synlig-worker/prices.ts.
// HTML comments are left alone (historical record). Idempotent: a second run
// finds nothing. Usage: bun patch-reports-reprice-2026-10-30.ts [--dry]
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { PRICES_NOK, kr } from "../synlig-worker/prices";

const NO = kr(PRICES_NOK.sitert).replace("\u00a0", " "); // «2 900»
const EN = PRICES_NOK.sitert.toLocaleString("en-US"); // «2,900»
const RULES: Array<[RegExp, string]> = [
  [/9 900 NOK/g, `${NO} NOK`],
  [/NOK 9,900/g, `NOK ${EN}`],
  [/9,900 NOK/g, `${EN} NOK`],
];
const dry = process.argv.includes("--dry");
let files = 0, hits = 0, scanned = 0;
for (const dir of ["reports", "rapport"]) {
  for (const f of readdirSync(`/workspace/synlig-site/${dir}`).filter((x) => x.endsWith(".html"))) {
    const p = `/workspace/synlig-site/${dir}/${f}`;
    const src = readFileSync(p, "utf8");
    scanned++;
    let n = 0;
    const out = src.split(/(<!--[\s\S]*?-->)/).map((part) => {
      if (part.startsWith("<!--")) return part;
      for (const [re, to] of RULES) part = part.replace(re, () => (n++, to));
      return part;
    }).join("");
    if (n) { files++; hits += n; if (!dry) writeFileSync(p, out); }
  }
}
if (scanned < 100) { console.error(`FLOOR: scanned ${scanned} reports, expected ≥100`); process.exit(1); }
console.log(`${dry ? "[dry] " : ""}scanned ${scanned}, patched ${files} files, ${hits} price strings → ${NO} / ${EN}`);
