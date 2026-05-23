#!/usr/bin/env bun
// BACKFILL v2: upgrades the top-cta primary action on pre-rendered cold-outreach
// reports from a LINK (→ /priser → re-enter email → checkout, 3-5 hops) to a
// FORM-POST (→ /api/lead-capture → Stripe checkout, 1 hop) when the prospect's
// email is recoverable from outreach logs.
//
// Why: backfill v1 (patch-reports-top-cta.ts, 2026-05-23 13:09) injected the
// top-cta block but kept the existing /priser link as the primary action. Fresh
// reports built after commit 50a46d5 already use the form-POST variant when
// `prospectEmail` is set (report-html.ts:116). Backfilled reports lag that
// version, so cold-outreach prospects clicking their /r/<hash> link still hit
// the 5-step path (land → click → /priser → type email → checkout).
//
// Mapping sources (token → email), merged in order:
//   1. /workspace/.state/sent-emails.jsonl       (cold-outreach send log; 32 entries)
//   2. /workspace/.state/value-first-outreach.jsonl (early value-first batch; 5 entries)
//   3. /workspace/money/aeo/report-registry.jsonl   (report registry; 43 entries)
//
// Reports lacking any mapping (older test reports, scrapes without contact)
// remain on the link variant — they're untouched, no regression.
//
// Idempotent: skips files where the top-cta block already contains <form (v2 marker).

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const REPORTS_DIR = "/workspace/synlig-site/reports";
const SENT_EMAILS = "/workspace/.state/sent-emails.jsonl";
const VALUE_FIRST = "/workspace/.state/value-first-outreach.jsonl";
const REGISTRY = "/workspace/money/aeo/report-registry.jsonl";

// ── Build token → email map ─────────────────────────────────────────────────
function buildMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const path of [SENT_EMAILS, VALUE_FIRST, REGISTRY]) {
    let text = "";
    try { text = readFileSync(path, "utf-8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      // Token sources vary by file:
      //   sent-emails.jsonl : reportUrl="https://synligdigital.no/r/<token>", to=email
      //   value-first      : token="<token>", contact.email=email
      //   registry         : hash="<token>", email=email
      let token: string | undefined;
      let email: string | undefined;
      if (obj.reportUrl && typeof obj.reportUrl === "string") {
        const m = /\/r\/([a-z0-9]+)\b/.exec(obj.reportUrl);
        if (m) token = m[1];
      }
      if (!token && obj.token) token = obj.token;
      if (!token && obj.hash) token = obj.hash;
      // Email keys differ by source: sent-emails uses `to`, value-first uses
      // `contact.email`, registry uses `email`. Try each in turn.
      email = obj.to || obj.contact?.email || obj.email;
      if (token && email && typeof email === "string" && email.includes("@")) {
        // First-write wins; we want the earliest-known mapping for a token in
        // case the same prospect was re-touched (avoids overwriting the
        // canonical recipient if the log has noise).
        if (!map.has(token)) map.set(token, email.trim().toLowerCase());
      }
    }
  }
  return map;
}

// ── HTML helpers ────────────────────────────────────────────────────────────
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Build the form-POST replacement. Mirrors report-html.ts:117-122 (canonical).
// Slug = `outreach-<hash>` for downstream Stripe metadata attribution.
function buildFormPost(email: string, hash: string): string {
  const slug = `outreach-${hash}`;
  return `<form method="POST" action="https://synligdigital.no/api/lead-capture" style="display:inline;margin:0;padding:0">
      <input type="hidden" name="email" value="${escapeAttr(email)}">
      <input type="hidden" name="tier" value="handlingsplan">
      <input type="hidden" name="slug" value="${escapeAttr(slug)}">
      <button type="submit" style="display:inline-block;background:#22c55e;color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(34,197,94,.3);margin-bottom:14px;border:0;cursor:pointer;font-family:inherit">Bestill handlingsplan — 4 900 NOK →</button>
    </form><br>`;
}

// ── Top-CTA anchor matcher (unique to backfill v1, NOT bottom-CTA) ──────────
// Top-CTA anchor signature: ends with `;border:0;cursor:pointer">...→</a><br>`
// Bottom-CTA anchor in same file ends with `;margin-bottom:14px">...→</a><br>`
// (no border:0;cursor:pointer suffix). This regex isolates the top one.
const TOP_CTA_ANCHOR_RE = /<a href="(https:\/\/synligdigital\.no\/priser\?ref=cold-report[^"]*?utm_campaign=([a-z0-9]+)[^"]*)" style="display:inline-block;background:#22c55e;color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba\(34,197,94,\.3\);margin-bottom:14px;border:0;cursor:pointer">Bestill handlingsplan — 4 900 NOK →<\/a><br>/;

// ── Idempotency: top-cta block already contains <form (v2 already applied) ──
const TOP_CTA_BLOCK_HAS_FORM = /<div class="top-cta">[\s\S]{0,400}?<form/;

// ── Main loop ────────────────────────────────────────────────────────────────
const dryRun = process.argv.includes("--dry-run");
const map = buildMap();
console.log(`mapping: ${map.size} token→email pairs loaded`);

let patched = 0;
let skippedAlreadyV2 = 0;
let skippedNoEmail = 0;
let skippedNoAnchor = 0;
const noEmail: string[] = [];
const noAnchor: string[] = [];

for (const fname of readdirSync(REPORTS_DIR).filter(f => f.endsWith(".html"))) {
  const hash = fname.replace(/\.html$/, "");
  const path = join(REPORTS_DIR, fname);
  const html = await Bun.file(path).text();

  // Skip if v2 already applied.
  if (TOP_CTA_BLOCK_HAS_FORM.test(html)) {
    skippedAlreadyV2++;
    continue;
  }

  const email = map.get(hash);
  if (!email) {
    skippedNoEmail++;
    noEmail.push(hash);
    continue;
  }

  const m = TOP_CTA_ANCHOR_RE.exec(html);
  if (!m) {
    skippedNoAnchor++;
    noAnchor.push(hash);
    continue;
  }
  // Sanity: the utm_campaign hash inside the anchor href MUST match the
  // filename hash. Cross-check guards against a stale-anchor pattern in a
  // file that was patched/copied across.
  if (m[2] !== hash) {
    skippedNoAnchor++;
    noAnchor.push(`${hash} (utm_campaign=${m[2]} mismatch)`);
    continue;
  }

  const replacement = buildFormPost(email, hash);
  const next = html.replace(TOP_CTA_ANCHOR_RE, replacement);
  if (next === html) {
    skippedNoAnchor++;
    noAnchor.push(`${hash} (replace was no-op)`);
    continue;
  }

  if (!dryRun) {
    await Bun.write(path, next);
  }
  patched++;
}

console.log(
  `patched=${patched} | already-v2=${skippedAlreadyV2} no-email=${skippedNoEmail} no-anchor=${skippedNoAnchor}${dryRun ? " [DRY RUN]" : ""}`
);
if (noEmail.length > 0 && noEmail.length <= 80) {
  console.log("skipped (no email mapping):", noEmail.join(", "));
}
if (noAnchor.length > 0) {
  console.log("skipped (no top-cta anchor):", noAnchor.join(", "));
}
