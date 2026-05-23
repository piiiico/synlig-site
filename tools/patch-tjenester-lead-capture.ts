#!/usr/bin/env bun
// Patch /workspace/synlig-site/tjenester/aeo-for-*.html pages to replace
// direct-to-Stripe checkout anchors (a href="/api/<tier>-checkout?slug=X") with
// inline /api/lead-capture POST forms — same pattern as /priser.html service
// cards and the cold-report HTML CTA. Captures email BEFORE Stripe, which
// enables the abandonment-recovery email path (shipped 2026-05-23 06:47).
//
// Why this matters now: Monday 2026-05-26 E2 outreach batch wires
// /tjenester/aeo-for-saas-bedrifter into the email body for
// Cardboard/Dignio/Telescope (task ed40905950eb7241). Without the fix, every
// prospect who clicks the pricing CTA then abandons Stripe goes silent — the
// recovery hook (checkout.session.expired) needs customer_email to populate,
// and the direct checkout anchors NEVER capture it.
//
// One-shot, idempotent: re-running on already-patched HTML is a no-op (the
// regex doesn't match form-wrapped buttons).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/workspace/synlig-site/tjenester";
const PAGES = [
  { file: "aeo-for-saas-bedrifter.html", slugBase: "aeo-for-saas" },
  { file: "aeo-for-kiropraktor.html",   slugBase: "aeo-for-kiropraktor" },
  { file: "aeo-for-tannleger.html",     slugBase: "aeo-for-tannleger" },
  { file: "aeo-for-eiendomsmeglere.html", slugBase: "aeo-for-eiendomsmeglere" },
  { file: "aeo-for-regnskap.html",      slugBase: "aeo-for-regnskap" },
] as const;

// Dark-theme variant of the .lead-form* CSS used on /priser.html. Scoped to
// these pages by leveraging existing tjenester CSS vars (--bg, --border, --accent, --text).
// Includes the button reset needed when .price-cta is applied to <button> instead of <a>.
const LEAD_FORM_CSS_MARKER = "/* lead-form (tjenester-tier-email-capture) */";
const LEAD_FORM_CSS = `
    ${LEAD_FORM_CSS_MARKER}
    .lead-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0 0 6px;
    }
    .lead-form-input {
      width: 100%;
      padding: 8px 10px;
      font-size: 0.85rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--text);
      box-sizing: border-box;
      transition: border-color 0.15s;
      font-family: inherit;
      outline: none;
    }
    .lead-form-input:focus { border-color: var(--accent); }
    button.price-cta {
      cursor: pointer;
      border: none;
      width: 100%;
      font-family: inherit;
      line-height: 1.2;
    }
`;

const TIERS = [
  { tier: "handlingsplan", label: "Bestill med kort →" },
  { tier: "fundament",     label: "Bestill med kort →" },
  { tier: "lopende",       label: "Start abonnement →" },
] as const;

function buildForm(slugBase: string, tier: string, label: string): string {
  // slug = tjenester-<page>-<tier>; mirrors /priser slug shape (priser-<tier>)
  const slug = `tjenester-${slugBase}-${tier}`;
  return `<form method="POST" action="/api/lead-capture" class="lead-form">
            <input type="email" name="email" class="lead-form-input" placeholder="din@firma.no" required autocomplete="email" maxlength="254" aria-label="E-postadresse">
            <input type="hidden" name="tier" value="${tier}">
            <input type="hidden" name="slug" value="${slug}">
            <button type="submit" class="price-cta">${label}</button>
          </form>`;
}

let allChanges = 0;
const summary: string[] = [];

for (const { file, slugBase } of PAGES) {
  const path = resolve(ROOT, file);
  let html = readFileSync(path, "utf8");
  const before = html;
  let pageChanges = 0;

  // 1) Inject lead-form CSS (idempotent — skip if marker already present)
  if (!html.includes(LEAD_FORM_CSS_MARKER)) {
    // Anchor: insert right after the existing .price-cta-secondary:hover rule
    const anchor = ".price-cta-secondary:hover { color: var(--text-dim); text-decoration: underline; }";
    if (!html.includes(anchor)) {
      throw new Error(`[${file}] CSS anchor not found: ${anchor}`);
    }
    html = html.replace(anchor, `${anchor}${LEAD_FORM_CSS}`);
    pageChanges++;
  }

  // 2) Replace each tier anchor with form
  for (const { tier, label } of TIERS) {
    // Match: <a href="/api/<tier>-checkout?slug=<slugBase>" class="price-cta">…→</a>
    // Tolerant of whitespace; slug must match this page's slug.
    const escapedSlug = slugBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `<a\\s+href="/api/${tier}-checkout\\?slug=${escapedSlug}"\\s+class="price-cta">[^<]*</a>`,
      "g",
    );
    const matches = html.match(re);
    if (!matches || matches.length === 0) {
      // Idempotent: form may already be there from prior run. Verify.
      const formMarker = `<input type="hidden" name="tier" value="${tier}">`;
      if (html.includes(formMarker)) {
        console.log(`[${file}] ${tier}: already patched (form present)`);
        continue;
      }
      throw new Error(`[${file}] could not find ${tier} anchor for slug=${slugBase}`);
    }
    if (matches.length !== 1) {
      throw new Error(`[${file}] expected exactly 1 ${tier} anchor for slug=${slugBase}, found ${matches.length}`);
    }
    html = html.replace(re, buildForm(slugBase, tier, label));
    pageChanges++;
  }

  if (html !== before) {
    writeFileSync(path, html, "utf8");
    summary.push(`  ${file}: ${pageChanges} change(s)`);
    allChanges += pageChanges;
  } else {
    summary.push(`  ${file}: no changes (already patched)`);
  }
}

console.log(`Patched ${PAGES.length} tjenester pages — ${allChanges} total change(s):`);
console.log(summary.join("\n"));
