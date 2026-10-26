#!/usr/bin/env bun
// Populates the fact-source gate's source cache: for every claim the gate
// cannot certify, fetch each external href within proximity (declared-agent
// UA) and record whether that page carries the claim's number(s).
// Rows: {url, number, found, status, fetched_at} -> SOURCE_CACHE (append-only).
// An unreadable page (403, JS shell) records found:false — it never certifies.
//   bun tools/verify-source-numbers.ts [--dry]
import { readFileSync, appendFileSync } from "fs";
import { join } from "path";
import {
  runFactSourceGate, cleanHtml, hrefsNear, claimNumbers, pageNumbers, SOURCE_CACHE,
} from "../_partials/fact-source-gate";

const DIR = "/workspace/synlig-site/src/content/blogg";
const UA = "Pico/1.0 (AI agent; pico@amdal.dev)";
const dry = process.argv.includes("--dry");

const seen = new Set<string>();
try {
  for (const l of readFileSync(SOURCE_CACHE, "utf8").split("\n")) {
    try { const r = JSON.parse(l); seen.add(`${r.url}\t${r.number}`); } catch {}
  }
} catch {}

const pages = new Map<string, { status: number; nums: Set<string> }>();
async function page(url: string) {
  if (!pages.has(url)) {
    let status = 0, text = "";
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
      status = r.status;
      text = r.ok ? (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ") : "";
    } catch { status = -1; }
    pages.set(url, { status, nums: pageNumbers(text) });
  }
  return pages.get(url)!;
}

const res = runFactSourceGate(DIR, "report");
const reds = res.all.filter((c) => c.acceptedBy === null);
let rows = 0, found = 0;
for (const c of reds) {
  const urls = hrefsNear(cleanHtml(readFileSync(join(DIR, c.file), "utf8"), true), c.position);
  for (const url of urls) {
    for (const n of claimNumbers(c.raw)) {
      if (seen.has(`${url}\t${n}`)) continue;
      seen.add(`${url}\t${n}`);
      const p = await page(url);
      const row = { url, number: n, found: p.nums.has(n), status: p.status, fetched_at: new Date().toISOString(), claim_file: c.file };
      rows++; if (row.found) found++;
      console.log(`${row.found ? "FOUND" : "absent"}\t${p.status}\t${n}\t${url}\t${c.file}`);
      if (!dry) appendFileSync(SOURCE_CACHE, JSON.stringify(row) + "\n");
    }
  }
}
console.log(`# reds ${reds.length}, new (url,number) rows ${rows}, found ${found}, pages fetched ${pages.size}`);
