#!/usr/bin/env bun
// BACKFILL: upgrades the BOTTOM .cta-card primary action on pre-rendered
// cold-outreach reports from a LINK (→ /priser → re-enter email → checkout,
// 3-5 hops) to a FORM-POST (→ /api/lead-capture → Stripe checkout, 1 hop)
// when the prospect's email is recoverable from outreach logs.
//
// Why: today's commit c6cadf8 (top-cta v1+v2) closed the peak-attention
// surface for skim-readers but left the bottom .cta-card primary as the legacy
// /priser anchor for thorough-readers — the highest-intent segment (they
// scrolled past 8 cards). Canonical report-html.ts:649 already renders the
// bottom CTA as form-POST when prospectEmail is known (same `primaryCta`
// variable used at top L452 and bottom L649). Backfilled reports lag canonical.
//
// Mapping sources (token → email) — identical merge to patch-reports-top-cta-v2.ts:
//   1. /workspace/.state/sent-emails.jsonl       (cold-outreach send log)
//   2. /workspace/.state/value-first-outreach.jsonl (value-first batch)
//   3. /workspace/money/aeo/report-registry.jsonl   (report registry)
//
// Slug: outreach-<hash> — same as canonical top+bottom (analytics differentiation
// would diverge from fresh-report behavior and create asymmetry; skip for now).
//
// Idempotent: skips files where the .cta-card already contains <form (marker).

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const REPORTS_DIR = "/workspace/synlig-site/reports";
const SENT_EMAILS = "/workspace/.state/sent-emails.jsonl";
const VALUE_FIRST = "/workspace/.state/value-first-outreach.jsonl";
const REGISTRY = "/workspace/money/aeo/report-registry.jsonl";

// ── Build token → email map (identical to v2 top-cta script) ─────────────────
function buildMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const path of [SENT_EMAILS, VALUE_FIRST, REGISTRY]) {
    let text = "";
    try { text = readFileSync(path, "utf-8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      let token: string | undefined;
      let email: string | undefined;
      if (obj.reportUrl && typeof obj.reportUrl === "string") {
        const m = /\/r\/([a-z0-9]+)\b/.exec(obj.reportUrl);
        if (m) token = m[1];
      }
      if (!token && obj.token) token = obj.token;
      if (!token && obj.hash) token = obj.hash;
      email = obj.to || obj.contact?.email || obj.email;
      if (token && email && typeof email === "string" && email.includes("@")) {
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
// Slug = `outreach-<hash>` — same as canonical primaryCta variable used at both
// top (L452) and bottom (L649) of fresh reports. No top/bottom distinction.
function buildFormPost(email: string, hash: string): string {
  const slug = `outreach-${hash}`;
  return `<form method="POST" action="https://synligdigital.no/api/lead-capture" style="display:inline;margin:0;padding:0">
      <input type="hidden" name="email" value="${escapeAttr(email)}">
      <input type="hidden" name="tier" value="handlingsplan">
      <input type="hidden" name="slug" value="${escapeAttr(slug)}">
      <button type="submit" style="display:inline-block;background:#22c55e;color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(34,197,94,.3);margin-bottom:14px;border:0;cursor:pointer;font-family:inherit">Bestill handlingsplan — 4 900 NOK →</button>
    </form><br>`;
}

// ── Bottom-CTA anchor matcher ───────────────────────────────────────────────
// The bottom anchor differs from the v1 top anchor by lacking the
// `;border:0;cursor:pointer` style suffix (v1 inserted that style to look
// button-like, even though it was an <a>). This regex isolates the bottom one.
//
// Anchor signature (exact, anchored by full style string):
//   <a href="https://synligdigital.no/priser?ref=cold-report...utm_campaign=<hash>..."
//      style="display:inline-block;...margin-bottom:14px">Bestill handlingsplan — 4 900 NOK →</a><br>
//
// Crucially the style attribute ENDS with `;margin-bottom:14px` followed by `"`,
// NOT followed by `;border:0;cursor:pointer"` (that's the v1 top anchor).
const BOTTOM_CTA_ANCHOR_RE = /<a href="(https:\/\/synligdigital\.no\/priser\?ref=cold-report[^"]*?utm_campaign=([a-z0-9]+)[^"]*)" style="display:inline-block;background:#22c55e;color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba\(34,197,94,\.3\);margin-bottom:14px">Bestill handlingsplan — 4 900 NOK →<\/a><br>/;

// ── Idempotency: .cta-card already contains <form (bottom-CTA already form) ──
// Searches forward from <div class="cta-card"> for a <form within 600 chars
// (the cta-card block is ~500 chars before its closing </div>).
const CTA_CARD_HAS_FORM = /<div class="cta-card">[\s\S]{0,600}?<form/;

// ── Main loop ────────────────────────────────────────────────────────────────
const dryRun = process.argv.includes("--dry-run");
const map = buildMap();
console.log(`mapping: ${map.size} token→email pairs loaded`);

let patched = 0;
let skippedAlreadyForm = 0;
let skippedNoEmail = 0;
let skippedNoAnchor = 0;
const noEmail: string[] = [];
const noAnchor: string[] = [];

for (const fname of readdirSync(REPORTS_DIR).filter(f => f.endsWith(".html"))) {
  const hash = fname.replace(/\.html$/, "");
  const path = join(REPORTS_DIR, fname);
  const html = await Bun.file(path).text();

  // Skip if .cta-card already contains a form (bottom CTA already converted).
  if (CTA_CARD_HAS_FORM.test(html)) {
    skippedAlreadyForm++;
    continue;
  }

  const email = map.get(hash);
  if (!email) {
    skippedNoEmail++;
    noEmail.push(hash);
    continue;
  }

  const m = BOTTOM_CTA_ANCHOR_RE.exec(html);
  if (!m) {
    skippedNoAnchor++;
    noAnchor.push(hash);
    continue;
  }
  // Sanity: utm_campaign hash MUST match the filename hash.
  if (m[2] !== hash) {
    skippedNoAnchor++;
    noAnchor.push(`${hash} (utm_campaign=${m[2]} mismatch)`);
    continue;
  }

  const replacement = buildFormPost(email, hash);
  const next = html.replace(BOTTOM_CTA_ANCHOR_RE, replacement);
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
  `patched=${patched} | already-form=${skippedAlreadyForm} no-email=${skippedNoEmail} no-anchor=${skippedNoAnchor}${dryRun ? " [DRY RUN]" : ""}`
);
if (noEmail.length > 0 && noEmail.length <= 80) {
  console.log("skipped (no email mapping):", noEmail.join(", "));
}
if (noAnchor.length > 0) {
  console.log("skipped (no bottom-cta anchor):", noAnchor.join(", "));
}
