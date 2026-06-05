#!/usr/bin/env bun
// BACKFILL: upgrade pre-Lite reports to dual-tier (Lite primary + Handlingsplan
// secondary) primary CTA. Mirrors report-html.ts:249-256 (canonical) for
// prospectEmail branch — reports baked with --email <addr> via outreach.
//
// Why: Lite tier (990 NOK FAQPage) shipped 2026-06-05 19:16Z. From that moment,
// fresh reports built via cli.ts --html --email <addr> already use dual-tier
// (report-html.ts:249-256 prospectEmail branch). But pre-Lite reports
// (generated before 19:16Z and STILL referenced by active outreach E1 emails)
// remain frozen on the single-tier Handlingsplan-only CTA. Prospects clicking
// the report link in their E1 email — and E2 follow-ups scheduled Jun 8-11 will
// route them back here — see ONLY 4 900 NOK Handlingsplan, missing the impulse-
// buy 990 NOK path designed for exactly the cold-visitor moment after the score.
//
// Source-of-truth for "active outreach": /workspace/money/aeo/sent-emails.jsonl
// joined to existing /workspace/synlig-site/reports/<hash>.html files. Only
// reports whose hash maps to a prospect email get patched — historical scrapes
// (no E1 attached) are left untouched.
//
// Idempotent: skips files where the form already contains
// `name="tier" value="lite"` (dual-tier marker).
//
// Net-substitutive (NN#2): single-button form → single-form dual-button —
// SAME form, two named submit buttons via button.name; removes the hidden
// tier=handlingsplan input that would conflict with button-level name="tier".

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const REPORTS_DIR = "/workspace/synlig-site/reports";
const SENT_EMAILS = "/workspace/money/aeo/sent-emails.jsonl";
const STATE_SENT_EMAILS = "/workspace/.state/sent-emails.jsonl";
const REGISTRY = "/workspace/money/aeo/report-registry.jsonl";

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Build hash → email map from all outreach sources ───────────────────────
function buildMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const path of [SENT_EMAILS, STATE_SENT_EMAILS, REGISTRY]) {
    let text = "";
    try { text = readFileSync(path, "utf-8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      // Multiple source shapes:
      //   AEO sent-emails:  { to, report_url: "synligdigital.no/r/<hash>" }
      //   .state sent-emails:{ to, reportUrl: "https://synligdigital.no/r/<hash>" }
      //   registry:          { email, hash }
      let token: string | undefined;
      if (typeof obj.report_url === "string") {
        const m = /\/r\/([a-z0-9]+)\b/.exec(obj.report_url);
        if (m) token = m[1];
      }
      if (!token && typeof obj.reportUrl === "string") {
        const m = /\/r\/([a-z0-9]+)\b/.exec(obj.reportUrl);
        if (m) token = m[1];
      }
      if (!token && typeof obj.hash === "string") token = obj.hash;
      const email: string | undefined = obj.to || obj.contact?.email || obj.email;
      if (token && email && typeof email === "string" && email.includes("@")) {
        if (!map.has(token)) map.set(token, email.trim().toLowerCase());
      }
    }
  }
  return map;
}

// ── Canonical button + form styles (mirror report-html.ts) ─────────────────
const liteBtnStyle = "display:inline-block;background:#22c55e;color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(34,197,94,.3);border:0;cursor:pointer;font-family:inherit";
const handlingsplanBtnStyle = "display:inline-block;background:transparent;color:#22c55e;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;border:1px solid #22c55e;cursor:pointer;font-family:inherit";
const tierSubcopyStyle = "font-size:12px;color:var(--text-muted, #94a3b8);line-height:1.4;margin:6px auto 6px;max-width:340px";
const formStyle = "display:flex;flex-direction:column;gap:6px;align-items:stretch;max-width:340px;margin:0 auto 14px;padding:0";

function buildDualTierForm(email: string, slug: string): string {
  return `<form method="POST" action="https://synligdigital.no/api/lead-capture" style="${formStyle}">
      <input type="hidden" name="email" value="${escapeAttr(email)}">
      <input type="hidden" name="slug" value="${escapeAttr(slug)}">
      <button type="submit" name="tier" value="lite" style="${liteBtnStyle}">Bestill Synlig Lite — 990 NOK →</button>
      <div style="${tierSubcopyStyle}">FAQPage for én side · 1 virkedag · engangsbetaling</div>
      <button type="submit" name="tier" value="handlingsplan" style="${handlingsplanBtnStyle}">Eller full handlingsplan — 4 900 NOK →</button>
    </form>`;
}

// ── Existing single-tier form regex (matches what reports baked pre-19:16Z had)
// Captures: 1=email value, 2=slug value
// Anchored: form opens with display:inline marker; ends with <br> after </form>
// /g flag: reports contain TWO copies of this form (top-CTA + bottom-CTA).
// Both have the same structure; both need dual-tier upgrade.
const SINGLE_TIER_FORM_RE = /<form method="POST" action="https:\/\/synligdigital\.no\/api\/lead-capture" style="display:inline;margin:0;padding:0">\s*<input type="hidden" name="email" value="([^"]+)">\s*<input type="hidden" name="tier" value="handlingsplan">\s*<input type="hidden" name="slug" value="([^"]+)">\s*<button type="submit" style="[^"]*">Bestill handlingsplan — 4 900 NOK →<\/button>\s*<\/form><br>/g;

// Idempotency: dual-tier marker
const DUAL_TIER_MARKER = `name="tier" value="lite"`;

// ── Main loop ────────────────────────────────────────────────────────────────
const dryRun = process.argv.includes("--dry-run");
const map = buildMap();
console.log(`mapping: ${map.size} token→email pairs loaded`);

let patched = 0;
let skippedAlreadyLite = 0;
let skippedNoEmail = 0;
let skippedNoForm = 0;
let skippedEmailMismatch = 0;
const patchedHashes: string[] = [];
const noEmail: string[] = [];
const noForm: string[] = [];

for (const fname of readdirSync(REPORTS_DIR).filter(f => f.endsWith(".html"))) {
  const hash = fname.replace(/\.html$/, "");
  const path = join(REPORTS_DIR, fname);
  const html = readFileSync(path, "utf-8");

  // Idempotency: skip only if NO single-tier form remains. A file that's been
  // partially patched (top fixed, bottom still single-tier) should re-enter.
  // The regex match below is the source of truth — `dual-tier marker present`
  // alone is insufficient because top and bottom are patched independently.
  if (!SINGLE_TIER_FORM_RE.test(html)) {
    // Reset lastIndex (test() advances it on /g)
    SINGLE_TIER_FORM_RE.lastIndex = 0;
    if (html.includes(DUAL_TIER_MARKER)) {
      skippedAlreadyLite++;
      continue;
    }
    skippedNoForm++;
    if (noForm.length < 50) noForm.push(`${hash} (no single-tier form, no lite marker — odd shape)`);
    continue;
  }
  SINGLE_TIER_FORM_RE.lastIndex = 0;

  const mappedEmail = map.get(hash);
  if (!mappedEmail) {
    skippedNoEmail++;
    if (noEmail.length < 80) noEmail.push(hash);
    continue;
  }

  // With /g, exec() advances lastIndex — use matchAll for clean enumeration.
  const matches = [...html.matchAll(SINGLE_TIER_FORM_RE)];
  if (matches.length === 0) {
    skippedNoForm++;
    if (noForm.length < 50) noForm.push(hash);
    continue;
  }

  // Sanity: all matches should share the same embedded email + slug. Cross-
  // check the FIRST match's email against the mapped email; assume top+bottom
  // were baked from the same prospectEmail+slug pair (canonical pattern).
  const [, formEmail, formSlug] = matches[0];
  if (formEmail.toLowerCase() !== mappedEmail.toLowerCase()) {
    skippedEmailMismatch++;
    console.log(`  ${hash}: email mismatch form=${formEmail} sent-log=${mappedEmail} — skipping`);
    continue;
  }

  const expectedSlug = `outreach-${hash}`;
  if (formSlug !== expectedSlug) {
    console.log(`  ${hash}: slug=${formSlug} but expected ${expectedSlug} — proceeding (use form's slug)`);
  }

  // Use a per-match replacer to use each match's own captured email/slug
  // (defensive — handles the edge case where top and bottom carry different
  // slugs, which shouldn't happen but won't break the replacement either).
  const next = html.replace(SINGLE_TIER_FORM_RE, (_m, email, slug) =>
    buildDualTierForm(email, slug)
  );
  if (next === html) {
    skippedNoForm++;
    if (noForm.length < 50) noForm.push(`${hash} (replace was no-op)`);
    continue;
  }

  if (!dryRun) {
    await Bun.write(path, next);
  }
  patched++;
  patchedHashes.push(hash);
}

console.log(
  `\npatched=${patched} | already-lite=${skippedAlreadyLite} no-email=${skippedNoEmail} no-form=${skippedNoForm} email-mismatch=${skippedEmailMismatch}${dryRun ? " [DRY RUN]" : ""}`
);
if (patchedHashes.length > 0) {
  console.log("\npatched hashes:", patchedHashes.join(", "));
}
if (noForm.length > 0) {
  console.log("\nskipped (no form match):", noForm.join(", "));
}
