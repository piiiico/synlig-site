// Reads static files from /workspace/synlig-site/ and generates
// /workspace/synlig-worker/worker.ts with embedded content.
// Also loads AEO reports from /workspace/synlig-site/reports/ for /r/{hash} routing.
//
// CANONICAL SOURCE for /workspace/synlig-worker/worker.ts. Single-writer
// invariant enforced below ("DUPLICATE-WRITER GUARD"). If you need to add
// a route, edit this file — do NOT create a second build script.

import { readdirSync, statSync } from "fs";
import { join, basename, resolve } from "path";
import { applyMarkers, MID_MARKER, BOTTOM_MARKER, LEAD_CAPTURE_PATH, CHECKOUT_HREF_PREFIX, MAILTO_PREFIX, type Stage } from "./_partials/render-audit-cta";
import { runFactSourceGate } from "./_partials/fact-source-gate";

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE-WRITER GUARD — single-writer invariant for synlig-worker/worker.ts
//
// History: 2026-05-20. Two build scripts (this file, and the now-deleted
// /workspace/bin/build-synlig-worker.ts) both emitted worker.ts. Predecessor
// wired handleFundamentCheckout/handleLopendeCheckout into the bin/ script only;
// next run of THIS script regenerated worker.ts WITHOUT those handlers, and
// /api/fundament-checkout + /api/lopende-checkout went 404 in production for
// ~2h until dogfood at 05:32 caught it. The structural fix is single-writer,
// guarded at build time.
//
// Scan bounded dirs for any .ts/.js that both references the output path AND
// invokes a write verb. Itself is excluded. Anything else = abort.
//
// Scope is intentionally small (bin/, synlig-site/, synlig-worker/, tools/,
// scripts/) so the guard stays fast (<100ms) and runs every build. If the
// build adds a new candidate dir for build scripts, add it to SCAN_ROOTS.
// ─────────────────────────────────────────────────────────────────────────────
{
  const SELF = resolve(import.meta.path ?? "/workspace/synlig-site/build.ts");
  const TARGET = "synlig-worker/worker.ts";
  const SCAN_ROOTS = [
    "/workspace/bin",
    "/workspace/synlig-site",
    "/workspace/synlig-worker",
    "/workspace/tools",
    "/workspace/scripts",
  ];
  // Write verbs that would create worker.ts. Bun.write / writeFileSync are the
  // common cases; this catches both.
  const WRITE_VERB = /Bun\.write\s*\(|writeFileSync\s*\(|fs\.writeFile\s*\(/;

  function walk(dir: string, acc: string[]): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      // Skip generated bundles, node_modules, .git, dist/ — they may contain
      // the target string as data, not as a writer.
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        walk(full, acc);
      } else if (st.isFile() && (full.endsWith(".ts") || full.endsWith(".js"))) {
        // Skip generated worker.ts/worker.js themselves — they contain the path
        // string as a self-reference comment, not as a writer.
        if (full === "/workspace/synlig-worker/worker.ts") continue;
        if (full === "/workspace/synlig-worker/worker.js") continue;
        acc.push(full);
      }
    }
  }
  const candidates: string[] = [];
  for (const r of SCAN_ROOTS) walk(r, candidates);

  const offenders: string[] = [];
  for (const f of candidates) {
    if (resolve(f) === SELF) continue;
    let src: string;
    try { src = require("fs").readFileSync(f, "utf8"); } catch { continue; }
    if (src.includes(TARGET) && WRITE_VERB.test(src)) {
      offenders.push(f);
    }
  }
  if (offenders.length > 0) {
    console.error(`\n[BUILD FAIL] DUPLICATE-WRITER GUARD: another file writes to ${TARGET}.`);
    console.error(`Single-writer invariant violated. Canonical writer: ${SELF}`);
    console.error(`Offending file(s):`);
    for (const o of offenders) console.error(`  - ${o}`);
    console.error(`\nFix: delete the offender, OR rename its target path. This file is`);
    console.error(`the canonical generator — add routes here, not in a parallel script.`);
    console.error(`History: 2026-05-20 — duplicate writer caused /api/fundament-checkout`);
    console.error(`and /api/lopende-checkout 404s in production for ~2h.`);
    process.exit(1);
  }
}

// Stage classification: slug -> awareness | consideration | decision.
// Drives audit-cta rendering (decision posts get pricing-first; others get audit-first
// with pricing as secondary). Maintained in _partials/blog-stages.json.
const stagesDoc = await Bun.file("/workspace/synlig-site/_partials/blog-stages.json").json();
const STAGES: Record<string, Stage> = stagesDoc.stages;

// applyBlogCta: load a blog post from disk, replace AUDIT-CTA markers with
// rendered partial HTML (stage-aware). Fails the build if markers are missing
// or stage is unmapped.
async function applyBlogCta(absPath: string): Promise<string> {
  const fname = basename(absPath);
  const slug = fname.replace(/\.html$/, "");
  const raw = await Bun.file(absPath).text();
  // index.html has no CTA; pass through.
  if (fname === "index.html") return raw;

  const stage = STAGES[slug];
  if (!stage) {
    console.error(`\n[BUILD FAIL] No stage classified for blog post slug "${slug}".`);
    console.error(`Add it to /workspace/synlig-site/_partials/blog-stages.json under "stages".`);
    process.exit(1);
  }
  const { html, errors } = applyMarkers(slug, raw, stage);
  if (errors.length > 0) {
    console.error(`\n[BUILD FAIL] audit-cta markers invalid in blogg/${fname}:`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\nEvery blog post must contain exactly one ${MID_MARKER} and one ${BOTTOM_MARKER}.`);
    console.error(`Source: /workspace/synlig-site/_partials/render-audit-cta.ts`);
    process.exit(1);
  }
  return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERTICAL_LANDINGS registry — single source of truth for /tjenester/* pages.
// Adding a 4th vertical requires exactly ONE edit: a new entry here.
// All 5 wiring places (file load, const decl, routes ×3, sitemap assertion)
// are auto-derived. Root cause: 2026-05-20 CF 10021 on aeo-for-tannleger —
// const decl was the silent 5th place, caught only by post-deploy live-route gate.
// ─────────────────────────────────────────────────────────────────────────────
const VERTICAL_LANDINGS: Array<{ slug: string; file: string; sitemapPriority: number }> = [
  { slug: 'aeo-for-advokater',         file: 'tjenester/aeo-for-advokater.html',         sitemapPriority: 0.9 },
  { slug: 'aeo-for-saas-bedrifter',    file: 'tjenester/aeo-for-saas-bedrifter.html',    sitemapPriority: 0.9 },
  { slug: 'aeo-for-tannleger',         file: 'tjenester/aeo-for-tannleger.html',         sitemapPriority: 0.9 },
  { slug: 'aeo-for-eiendomsmeglere',   file: 'tjenester/aeo-for-eiendomsmeglere.html',   sitemapPriority: 0.9 },
  { slug: 'aeo-for-regnskap',          file: 'tjenester/aeo-for-regnskap.html',          sitemapPriority: 0.9 },
  { slug: 'aeo-for-kiropraktor',       file: 'tjenester/aeo-for-kiropraktor.html',       sitemapPriority: 0.9 },
];

// Derive worker constant name from slug: aeo-for-advokater -> TJENESTER_AEO_FOR_ADVOKATER_HTML
function verticalConstName(slug: string): string {
  return 'TJENESTER_' + slug.toUpperCase().replace(/-/g, '_') + '_HTML';
}

// Load vertical landing HTML — fails build immediately if a file is missing.
const verticalFiles: Record<string, string> = {};
for (const v of VERTICAL_LANDINGS) {
  const fullPath = `/workspace/synlig-site/${v.file}`;
  try {
    verticalFiles[verticalConstName(v.slug)] = await Bun.file(fullPath).text();
  } catch {
    console.error(`\n[BUILD FAIL] VERTICAL_LANDINGS: file not found: ${fullPath}`);
    console.error(`Check the 'file' field in VERTICAL_LANDINGS for slug '${v.slug}'.`);
    process.exit(1);
  }
}

const files = {
  INDEX_HTML: await Bun.file("/workspace/synlig-site/index.html").text(),
  PRISER_HTML: await Bun.file("/workspace/synlig-site/priser.html").text(),
  FAKTURA_HTML: await Bun.file("/workspace/synlig-site/faktura.html").text(),
  GUIDE_HTML: await Bun.file("/workspace/synlig-site/guide.html").text(),
  DASHBOARD_HTML: await Bun.file("/workspace/synlig-site/dashboard.html").text(),
  LLMS_TXT: await Bun.file("/workspace/synlig-site/llms.txt").text(),
  ROBOTS_TXT: await Bun.file("/workspace/synlig-site/robots.txt").text(),
  SITEMAP_XML: await Bun.file("/workspace/synlig-site/sitemap.xml").text(),
  OG_SVG: await Bun.file("/workspace/synlig-site/og.svg").text(),
  FAVICON_SVG: await Bun.file("/workspace/synlig-site/favicon.svg").text(),
  KOMPLETT_AEO_HTML: await Bun.file("/workspace/synlig-site/komplett-aeo-analyse.html").text(),
  NORDIC_LITHIUM_CASE_HTML: await Bun.file("/workspace/synlig-site/nordic-lithium-case.html").text(),
  PIERSTOP_CASE_HTML: await Bun.file("/workspace/synlig-site/pierstop-case.html").text(),
  AGENT_CARD_JSON: await Bun.file("/workspace/synlig-site/agent-card.json").text(),
  BLOGG_INDEX_HTML: await Bun.file("/workspace/synlig-site/blogg/index.html").text(),
  BLOGG_HVA_ER_AEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/hva-er-aeo.html"),
  BLOGG_AEO_I_NORGE_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-i-norge-2026.html"),
  BLOGG_NORSK_AEO_BENCHMARK_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/norsk-aeo-benchmark-2026.html"),
  BLOGG_MCP_SECURITY_MARCH_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/mcp-security-march-2026.html"),
  BLOGG_AEO_BYRA_NORGE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-byra-norge.html"),
  BLOGG_LOKAL_AI_SYNLIGHET_HTML: await applyBlogCta("/workspace/synlig-site/blogg/lokal-ai-synlighet.html"),
  BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML: await applyBlogCta("/workspace/synlig-site/blogg/slik-blir-du-synlig-i-chatgpt.html"),
  BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/caveman-ai-pricing-april-2026.html"),
  BLOGG_ER_NETTSIDA_DI_KLAR_HTML: await applyBlogCta("/workspace/synlig-site/blogg/er-nettsida-di-klar-for-ai-agentar.html"),
  BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML: await applyBlogCta("/workspace/synlig-site/blogg/stavanger-agent-beredskap-april-2026.html"),
  BLOGG_HVA_ER_AEO_GUIDE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/hva-er-aeo-guide.html"),
  BLOGG_AEO_VS_SEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-vs-seo.html"),
  RAPPORT_STATE_AEO_2026_HTML: await Bun.file("/workspace/synlig-site/rapport/state-of-aeo-2026.html").text(),
  // Note: /tjenester/aeo-for-* verticals are loaded via VERTICAL_LANDINGS registry above (verticalFiles).
  TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML: await Bun.file("/workspace/synlig-site/tjenester/digital-markedsforing-stavanger.html").text(),
  BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML: await applyBlogCta("/workspace/synlig-site/blogg/digital-markedsforing-stavanger.html"),
  BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/chatgpt-annonser-og-aeo-april-2026.html"),
  BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML: await applyBlogCta("/workspace/synlig-site/blogg/automatisert-aeo-vs-radgiving.html"),
  BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/stavanger-klinikk-aeo-analyse.html"),
  BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML: await applyBlogCta("/workspace/synlig-site/blogg/norges-aeo-leaderboard-2026-04.html"),
  BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML: await applyBlogCta("/workspace/synlig-site/blogg/eu-ai-act-norske-bedrifter.html"),
  BLOGG_AEO_BUDSJETT_45X_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-budsjett-45x-okonomi.html"),
  BLOGG_AEO_SJEKKLISTE_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-sjekkliste-2026.html"),
  BLOGG_GA4_AI_ASSISTANT_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/ga4-ai-assistant-2026.html"),
  BLOGG_CHATGPT_KONVERTERER_9X_HTML: await applyBlogCta("/workspace/synlig-site/blogg/chatgpt-konverterer-9x.html"),
  BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/google-sok-redesign-mai-2026.html"),
  BLOGG_90_PROSENT_USYNLIGE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/90-prosent-usynlige-i-ai-sok.html"),
  BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/google-spam-policy-aeo-mai-2026.html"),
  BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML: await applyBlogCta("/workspace/synlig-site/blogg/93-prosent-ai-mode-null-klikk.html"),
  LEADERBOARD_HTML: await Bun.file("/workspace/synlig-site/leaderboard.html").text(),
  LEADERBOARD_JSON: await Bun.file("/workspace/synlig-site/leaderboard.json").text(),
  CONTEXT_MD: await Bun.file("/workspace/synlig-site/context.md").text(),
  PRISER_MD: await Bun.file("/workspace/synlig-site/priser.md").text(),
};

// Sitemap assertion: every vertical in VERTICAL_LANDINGS must appear in sitemap.xml.
// Adding a new vertical without updating sitemap.xml fails the build here,
// not silently at deploy time.
for (const v of VERTICAL_LANDINGS) {
  if (!files.SITEMAP_XML.includes(`/tjenester/${v.slug}`)) {
    console.error(`\n[BUILD FAIL] VERTICAL_LANDINGS: slug "${v.slug}" missing from sitemap.xml.`);
    console.error(`Add https://synligdigital.no/tjenester/${v.slug} to /workspace/synlig-site/sitemap.xml.`);
    process.exit(1);
  }
}

// Audit-CTA invariants (post-injection, validates rendered output):
//   1. Every blog post must surface class="audit-cta" at least twice (mid+bottom).
//      History: chatgpt-konverterer-9x.html shipped with only mid CTA (2026-05-19),
//      caught manually during a blog->buy walk. This gate prevents silent regression.
//   2. Every blog post must surface the "4 900 NOK" pricing anchor at least once.
//      History: 2026-05-19 — blog layer surfaced only free-audit CTA; pricing
//      anchor lived only at /sjekk thank-you + cold emails. Buyers researching
//      on the blog never saw a buy path. This gate enforces blog-layer parity.
//   3. Markers must NOT survive into rendered output (would indicate render failure).
const bloggDir = "/workspace/synlig-site/blogg";
const ctaViolations: string[] = [];
const blogFileMap: Record<string, string> = {
  "hva-er-aeo.html": files.BLOGG_HVA_ER_AEO_HTML,
  "aeo-i-norge-2026.html": files.BLOGG_AEO_I_NORGE_2026_HTML,
  "norsk-aeo-benchmark-2026.html": files.BLOGG_NORSK_AEO_BENCHMARK_2026_HTML,
  "mcp-security-march-2026.html": files.BLOGG_MCP_SECURITY_MARCH_2026_HTML,
  "aeo-byra-norge.html": files.BLOGG_AEO_BYRA_NORGE_HTML,
  "lokal-ai-synlighet.html": files.BLOGG_LOKAL_AI_SYNLIGHET_HTML,
  "slik-blir-du-synlig-i-chatgpt.html": files.BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML,
  "caveman-ai-pricing-april-2026.html": files.BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML,
  "er-nettsida-di-klar-for-ai-agentar.html": files.BLOGG_ER_NETTSIDA_DI_KLAR_HTML,
  "stavanger-agent-beredskap-april-2026.html": files.BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML,
  "hva-er-aeo-guide.html": files.BLOGG_HVA_ER_AEO_GUIDE_HTML,
  "aeo-vs-seo.html": files.BLOGG_AEO_VS_SEO_HTML,
  "digital-markedsforing-stavanger.html": files.BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML,
  "chatgpt-annonser-og-aeo-april-2026.html": files.BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML,
  "automatisert-aeo-vs-radgiving.html": files.BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML,
  "stavanger-klinikk-aeo-analyse.html": files.BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML,
  "norges-aeo-leaderboard-2026-04.html": files.BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML,
  "eu-ai-act-norske-bedrifter.html": files.BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML,
  "aeo-budsjett-45x-okonomi.html": files.BLOGG_AEO_BUDSJETT_45X_HTML,
  "aeo-sjekkliste-2026.html": files.BLOGG_AEO_SJEKKLISTE_2026_HTML,
  "ga4-ai-assistant-2026.html": files.BLOGG_GA4_AI_ASSISTANT_2026_HTML,
  "chatgpt-konverterer-9x.html": files.BLOGG_CHATGPT_KONVERTERER_9X_HTML,
  "google-sok-redesign-mai-2026.html": files.BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML,
  "90-prosent-usynlige-i-ai-sok.html": files.BLOGG_90_PROSENT_USYNLIGE_HTML,
  "google-spam-policy-aeo-mai-2026.html": files.BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML,
  "93-prosent-ai-mode-null-klikk.html": files.BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML,
};
const allBlogFiles = readdirSync(bloggDir).filter(f => f.endsWith(".html") && f !== "index.html");
for (const fname of allBlogFiles) {
  const rendered = blogFileMap[fname];
  if (!rendered) {
    ctaViolations.push(`  blogg/${fname}: file exists on disk but not in build.ts files map — add it`);
    continue;
  }
  const ctaCount = (rendered.match(/class="audit-cta"/g) || []).length;
  if (ctaCount < 2) ctaViolations.push(`  blogg/${fname}: class="audit-cta" found ${ctaCount}, expected >=2`);
  if (!/4\s*900\s*NOK/.test(rendered))
    ctaViolations.push(`  blogg/${fname}: missing pricing anchor "4 900 NOK"`);
  // Buyer-journey "PAY" link: every blog post must carry the lead-capture entry point
  // (which then 302s to Stripe Checkout with customer_email pre-filled).
  // History: 2026-05-19 — pricing anchor was TEXT-ONLY (mailto only); buyer hit "pay"
  // with no online path. 2026-05-23 — migrated from direct checkout anchors to
  // /api/lead-capture forms so abandonment-recovery email gets customer_email.
  if (!rendered.includes(LEAD_CAPTURE_PATH) && !rendered.includes(CHECKOUT_HREF_PREFIX))
    ctaViolations.push(`  blogg/${fname}: missing checkout entry (expected "${LEAD_CAPTURE_PATH}" or "${CHECKOUT_HREF_PREFIX}")`);
  // Mailto fallback: low-trust visitors still need a non-card path.
  if (!rendered.includes(MAILTO_PREFIX))
    ctaViolations.push(`  blogg/${fname}: missing mailto fallback "${MAILTO_PREFIX}"`);
  if (rendered.includes(MID_MARKER) || rendered.includes(BOTTOM_MARKER))
    ctaViolations.push(`  blogg/${fname}: AUDIT-CTA marker survived into rendered HTML`);
}
if (ctaViolations.length > 0) {
  console.error(`\n[BUILD FAIL] audit-cta invariants violated:`);
  console.error(ctaViolations.join("\n"));
  console.error(`\nRenderer: /workspace/synlig-site/_partials/render-audit-cta.ts`);
  console.error(`Stages:   /workspace/synlig-site/_partials/blog-stages.json`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// FACT-SOURCE GATE — claim-traceability invariant for blog HTML.
//
// History: 2026-05-20 08:16 reflection. Agent drafted /blogg/90-prosent-usynlige-i-ai-sok
// with a fabricated vertical-breakdown table — every score invented (advokater 34, SaaS 47,
// klinikker 28, etc., vs actual registry: tannlege 50, advokat 58, ...). Caught ONLY because
// the writing agent happened to cross-check /workspace/money/aeo/report-registry.jsonl.
// Quote: "no automated gate intercepts stat-claim-without-source-row."
//
// The pre-existing protection ("Verify claims before asserting them" in CLAUDE.md Integrity
// + fact-check skill) did NOT prevent the near-miss. Per CLAUDE.md
// "1st occurrence → principle/skill text; 2nd occurrence → code gate" — and since this is a
// strong fabrication-class failure with high downside (live URL with invented stats), going
// straight to a code gate on the build's default execution path is the right level.
//
// Scope: blogg/*.html only (landing pages are template-heavy and revisit later if needed).
// Each numeric claim (percent, large-count with thousand separator, ratio, score-decl) must
// pass at least one of:
//   1) within 200 chars of a citation marker (Kilde:, external href, (Org, year), Ifølge X,
//      "egne data", Kilder<h*> section)
//   2) top-of-file allow-list comment <!-- fact-source-allow: ["claim1",…] -->
//   3) claim row in /workspace/money/aeo/fact-registry.jsonl
//   4) substring match against /workspace/money/aeo/report-registry.jsonl
//   5) inside <table class="audit-table" data-source="…">
//   6) top-of-file file-wide allow <!-- fact-source-allow-all: "non-empty reason" -->
//
// Bypass is opt-in (allow-list with explicit reason, OR registry entry with source_url).
// This is the execution-path-on-default-by-default intervention from CLAUDE.md self-awareness:
// gate sits on bun run build.ts (no opt-out unless a future engineer deletes the call).
//
// Source: /workspace/synlig-site/_partials/fact-source-gate.ts
// ─────────────────────────────────────────────────────────────────────────────
{
  const factResult = runFactSourceGate("/workspace/synlig-site/blogg", "enforce");
  if (factResult.violations.length > 0) {
    console.error(`\n[BUILD FAIL] fact-source gate: ${factResult.violations.length} unverified claim(s) in blogg/`);
    for (const v of factResult.violations) {
      console.error(`  ${v.file} [${v.heading}]: ${v.pattern} "${v.claim}"`);
      console.error(`    ...${v.snippet}...`);
    }
    console.error(`\nFix: add a citation within 200 chars (Kilde:, external href, (Org, year), egne data),`);
    console.error(`  OR add the claim to /workspace/money/aeo/fact-registry.jsonl with source_url,`);
    console.error(`  OR top-of-file <!-- fact-source-allow: ["claim", …] --> (per-claim),`);
    console.error(`  OR top-of-file <!-- fact-source-allow-all: "non-empty reason" --> (file-wide own-data).`);
    console.error(`Renderer: /workspace/synlig-site/_partials/fact-source-gate.ts`);
    process.exit(1);
  }
  console.log(`  fact-source: ${factResult.claims} claims across ${factResult.files} blogs, ${factResult.registryRows} registry rows, 0 unverified`);
}

// Pricing-parity invariant: JSON-LD Offer.price values on index.html MUST
// match the visible .service-price strings in #tjenester AND the FAQ
// "Hva koster det?" answer text. Source-of-truth: JSON-LD (the structured
// data AI agents consume).
//
// History: 2026-05-19 — JSON-LD said 4 900 / 14 900 / 4 900 while visible
// cards said 12 000 / 15 000 / 5 000 for unknown duration. Caught only by
// a manual dogfood walk after 3 cold emails landed prospects on the wrong
// number. 5:1 evidence-vs-outlier was visible but no automated gate caught
// it. This is the 4th two-layer-artifact recurrence in one day — code gate
// is the only intervention that persists across containers.
//
// Pairing rules (explicit, in order):
//   1. JSON-LD Offer with priceSpecification.unitText matching /per (m..ned|m.aned)/i
//      pairs with the visible card whose service-price contains "/mnd".
//   2. Otherwise pair by service-name token-overlap (≥4-char tokens).
//   3. Free offers (price="0") are skipped — they have no card.
//   4. Unmatched offers OR unmatched cards both fail.
//   5. FAQ "Hva koster det?" answer must mention every paid Offer.price
//      after NBSP/space normalization.
//
// Naming-drift policy: the gate ENFORCES price match, not name match.
// Today: JSON-LD "AI-synlighet Kontinuerleg" ↔ card "Løpende overvåking"
// disagree on name but agree on price + unitText. This is allowed because
// the monthly card is uniquely identified by /mnd. If naming drift breaks
// a future pair-by-name lookup, the gate emits "UNMATCHED" with both sides
// and we converge names then.
type OfferLD = { name: string; price: string; unitText: string | null };
type CardHTML = { name: string; priceText: string; priceNumeric: string; isMonthly: boolean };

const pricingViolations: string[] = [];
const indexHtml = files.INDEX_HTML;

// 1) Extract JSON-LD Offer entries from any OfferCatalog (paid only).
const ldOffers: OfferLD[] = [];
const ldBlockRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
let ldMatch: RegExpExecArray | null;
while ((ldMatch = ldBlockRe.exec(indexHtml)) !== null) {
  let parsed: any;
  try { parsed = JSON.parse(ldMatch[1]); } catch { continue; }
  const items = parsed?.hasOfferCatalog?.itemListElement;
  if (!Array.isArray(items)) continue;
  for (const item of items) {
    if (item?.["@type"] !== "Offer") continue;
    const price = String(item.price ?? "");
    if (!price || price === "0") continue;
    ldOffers.push({
      name: String(item.name ?? ""),
      price,
      unitText: item?.priceSpecification?.unitText ?? null,
    });
  }
}

// 2) Extract visible service-cards: zip independent .service-name and
//    .service-price arrays by position (more robust than a single
//    nested regex against multi-div cards).
const nameRe = /<div class="service-name">([\s\S]*?)<\/div>/g;
const priceRe = /<div class="service-price">([\s\S]*?)<\/div>/g;
const cardNames: string[] = [];
const cardPrices: string[] = [];
let nm: RegExpExecArray | null;
while ((nm = nameRe.exec(indexHtml)) !== null) cardNames.push(nm[1].trim());
let pm: RegExpExecArray | null;
while ((pm = priceRe.exec(indexHtml)) !== null) cardPrices.push(pm[1].trim());
if (cardNames.length !== cardPrices.length) {
  pricingViolations.push(
    `service-card structural mismatch: ${cardNames.length} .service-name vs ${cardPrices.length} .service-price`
  );
}
const cards: CardHTML[] = cardNames.map((name, i) => {
  const priceText = cardPrices[i] ?? "";
  const normalized = priceText.replace(/&nbsp;/g, " ").replace(/\s+/g, "");
  const isMonthly = /\/mnd/i.test(normalized);
  const priceNumeric = (normalized.match(/\d+/g) || []).join("");
  return { name, priceText, priceNumeric, isMonthly };
});

// 3) Pair JSON-LD offers to visible cards.
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9æøå\-]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 4)
  );
}
const cardUsed = new Set<number>();
const pairs: Array<{ offer: OfferLD; cardIdx: number; rule: string }> = [];
for (const offer of ldOffers) {
  let idx = -1;
  let rule = "";
  if (offer.unitText && /per (m[åa]nad|m[åa]ned)/i.test(offer.unitText)) {
    idx = cards.findIndex((c, i) => c.isMonthly && !cardUsed.has(i));
    rule = `unitText="${offer.unitText}" -> monthly card (/mnd)`;
  } else {
    const off = tokens(offer.name);
    let best = 0;
    cards.forEach((c, i) => {
      if (cardUsed.has(i) || c.isMonthly) return;
      const ct = tokens(c.name);
      let overlap = 0;
      for (const t of off) if (ct.has(t)) overlap++;
      if (overlap > best) { best = overlap; idx = i; }
    });
    rule = `name-token-overlap ≥1 (Offer "${offer.name}")`;
  }
  if (idx >= 0) cardUsed.add(idx);
  pairs.push({ offer, cardIdx: idx, rule });
}

// 4) Compare each pair's price; flag unmatched offers.
for (const p of pairs) {
  if (p.cardIdx < 0) {
    pricingViolations.push(
      `UNMATCHED JSON-LD Offer "${p.offer.name}" (price=${p.offer.price} NOK) — no visible card via rule [${p.rule}]`
    );
    continue;
  }
  const c = cards[p.cardIdx];
  if (p.offer.price !== c.priceNumeric) {
    pricingViolations.push(
      `MISMATCH: JSON-LD "${p.offer.name}" price=${p.offer.price} (source-of-truth) ↔ ` +
      `Card "${c.name}" price="${c.priceText}" (normalized=${c.priceNumeric}) | rule: ${p.rule}`
    );
  }
}
// 5) Unmatched cards (visible price with no corresponding JSON-LD Offer).
cards.forEach((c, i) => {
  if (!cardUsed.has(i)) {
    pricingViolations.push(
      `UNMATCHED HTML card "${c.name}" (price="${c.priceText}") — no JSON-LD Offer pairs to it`
    );
  }
});

// 6) FAQ "Hva koster det?" answer must mention every paid Offer.price.
const faqM = indexHtml.match(
  /Hva koster det\?[\s\S]*?<div class="faq-answer-inner">([\s\S]*?)<\/div>/
);
if (!faqM) {
  pricingViolations.push(`FAQ "Hva koster det?" answer block not found — gate cannot verify`);
} else {
  const faqNormalized = faqM[1].replace(/&nbsp;/g, " ").replace(/\s+/g, "");
  for (const o of ldOffers) {
    if (!faqNormalized.includes(o.price)) {
      pricingViolations.push(
        `FAQ "Hva koster det?" answer missing price ${o.price} NOK (Offer "${o.name}")`
      );
    }
  }
}

if (pricingViolations.length > 0) {
  console.error(`\n[BUILD FAIL] pricing-parity invariant violated (${pricingViolations.length} issue(s)):`);
  for (const v of pricingViolations) console.error(`  - ${v}`);
  console.error(`\nSource-of-truth: JSON-LD hasOfferCatalog.itemListElement (index.html ~L100-165).`);
  console.error(`Visible surfaces that must agree: .service-card .service-price on #tjenester, AND the FAQ "Hva koster det?" answer.`);
  console.error(`Pairing rules: unitText "per månad/maaned" -> /mnd card; otherwise token-overlap ≥1 (≥4-char tokens) with service-name.`);

  // Best-effort: log a row to working_memory for the
  // `json_ld_html_pricing_drift_blocks` audit thread the calibration
  // prediction (2026-08-19 deadline) reads from. Skipped during negative
  // testing (BUILD_GATE_NEGATIVE_TEST=1) and when TURSO env is absent.
  if (
    !process.env.BUILD_GATE_NEGATIVE_TEST &&
    process.env.TURSO_URL &&
    process.env.TURSO_AUTH_TOKEN
  ) {
    const note =
      `Pricing-parity gate blocked build at ${new Date().toISOString()}. ` +
      `${pricingViolations.length} violation(s). First: ${pricingViolations[0]}`;
    const r = Bun.spawnSync({
      cmd: [
        "bun",
        "/workspace/tools/pico-db/write-working-memory.ts",
        "--thread",
        "json_ld_html_pricing_drift_blocks",
        "--note",
        note,
        "--cite",
        "/workspace/synlig-site/build.ts",
      ],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (r.exitCode !== 0) {
      console.error(`(note: working-memory write returned exit ${r.exitCode}; continuing with build-fail)`);
    }
  }

  process.exit(1);
}

// Load reports from /workspace/synlig-site/reports/
const reportsDir = "/workspace/synlig-site/reports";
const reportEntries: Array<{ hash: string; html: string }> = [];
try {
  const reportFiles = readdirSync(reportsDir).filter(f => f.endsWith(".html"));
  for (const fname of reportFiles) {
    const hash = fname.replace(".html", "");
    // Defensive: skip empty-hash files (`.html` with no name) — they would
    // become REPORTS[""] and be reachable at /r/ (no path segment). One such
    // file was an early Pierstop prototype shipped in 877cd9b that exposed
    // a "konfidensiell" cold-audit at the bare /r/ URL for 2+ months until
    // discovered on 2026-05-22. Belt-and-braces with the worker-side guard
    // below.
    if (!hash) {
      console.warn(`  ⚠ Skipping empty-hash report file: ${fname} (would expose at /r/)`);
      continue;
    }
    const html = await Bun.file(join(reportsDir, fname)).text();
    reportEntries.push({ hash, html });
    console.log(`  Loaded report: ${hash} (${html.length} bytes)`);
  }
} catch {
  console.log("  No reports directory found, skipping.");
}

// Binary files (base64-encoded)
const pdfBytes = await Bun.file("/workspace/money/aeo/synlig-digital-one-pager.pdf").arrayBuffer();
const PDF_B64 = Buffer.from(pdfBytes).toString("base64");

// Escape backticks and dollar signs for template literals
function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

// Build reports map
const reportsMapEntries = reportEntries
  .map(r => `  "${r.hash}": \`${escape(r.html)}\``)
  .join(",\n");

// Pre-build vertical landing blocks for worker template (auto-derived from VERTICAL_LANDINGS).
// verticalConsts: one "const X_HTML = `...`;" per vertical (the silent 5th wiring place).
// verticalRoutes: three routes per vertical (bare, trailing-slash, .html form).
const verticalConsts = VERTICAL_LANDINGS.map(v => {
  const name = verticalConstName(v.slug);
  return `const ${name} = \`${escape(verticalFiles[name])}\`;`;
}).join('\n\n');

const verticalRoutes = VERTICAL_LANDINGS.map(v => {
  const name = verticalConstName(v.slug);
  return [
    `  "/tjenester/${v.slug}": { body: ${name}, contentType: "text/html; charset=utf-8" },`,
    `  "/tjenester/${v.slug}/": { body: ${name}, contentType: "text/html; charset=utf-8" },`,
    `  "/tjenester/${v.slug}.html": { body: ${name}, contentType: "text/html; charset=utf-8" },`,
  ].join('\n');
}).join('\n');

const worker = `// Auto-generated Cloudflare Worker — do not edit by hand.
// Built from /workspace/synlig-site/ static files.
// Generated: ${new Date().toISOString()}

import { handleAuditRequest } from "./audit-handler";
import { handleCheckoutRequest, handleFundamentCheckout, handleLopendeCheckout, handleLeadCapture, handleStripeWebhook, handleTakkPage } from "./checkout-handler";
import { handleFakturaSubmit } from "./faktura-handler";

const INDEX_HTML = \`${escape(files.INDEX_HTML)}\`;

const PRISER_HTML = \`${escape(files.PRISER_HTML)}\`;

const FAKTURA_HTML = \`${escape(files.FAKTURA_HTML)}\`;

const GUIDE_HTML = \`${escape(files.GUIDE_HTML)}\`;

const DASHBOARD_HTML = \`${escape(files.DASHBOARD_HTML)}\`;

const LLMS_TXT = \`${escape(files.LLMS_TXT)}\`;

const ROBOTS_TXT = \`${escape(files.ROBOTS_TXT)}\`;

const SITEMAP_XML = \`${escape(files.SITEMAP_XML)}\`;

const OG_SVG = \`${escape(files.OG_SVG)}\`;

const FAVICON_SVG = \`${escape(files.FAVICON_SVG)}\`;

const KOMPLETT_AEO_HTML = \`${escape(files.KOMPLETT_AEO_HTML)}\`;

const NORDIC_LITHIUM_CASE_HTML = \`${escape(files.NORDIC_LITHIUM_CASE_HTML)}\`;

const PIERSTOP_CASE_HTML = \`${escape(files.PIERSTOP_CASE_HTML)}\`;

const AGENT_CARD_JSON = \`${escape(files.AGENT_CARD_JSON)}\`;

const BLOGG_INDEX_HTML = \`${escape(files.BLOGG_INDEX_HTML)}\`;

const BLOGG_HVA_ER_AEO_HTML = \`${escape(files.BLOGG_HVA_ER_AEO_HTML)}\`;

const BLOGG_AEO_I_NORGE_2026_HTML = \`${escape(files.BLOGG_AEO_I_NORGE_2026_HTML)}\`;

const BLOGG_NORSK_AEO_BENCHMARK_2026_HTML = \`${escape(files.BLOGG_NORSK_AEO_BENCHMARK_2026_HTML)}\`;

const BLOGG_MCP_SECURITY_MARCH_2026_HTML = \`${escape(files.BLOGG_MCP_SECURITY_MARCH_2026_HTML)}\`;

const BLOGG_AEO_BYRA_NORGE_HTML = \`${escape(files.BLOGG_AEO_BYRA_NORGE_HTML)}\`;

const BLOGG_LOKAL_AI_SYNLIGHET_HTML = \`${escape(files.BLOGG_LOKAL_AI_SYNLIGHET_HTML)}\`;

const BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML = \`${escape(files.BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML)}\`;

const BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML = \`${escape(files.BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML)}\`;

const BLOGG_ER_NETTSIDA_DI_KLAR_HTML = \`${escape(files.BLOGG_ER_NETTSIDA_DI_KLAR_HTML)}\`;

const BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML = \`${escape(files.BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML)}\`;

const BLOGG_HVA_ER_AEO_GUIDE_HTML = \`${escape(files.BLOGG_HVA_ER_AEO_GUIDE_HTML)}\`;

const BLOGG_AEO_VS_SEO_HTML = \`${escape(files.BLOGG_AEO_VS_SEO_HTML)}\`;

const RAPPORT_STATE_AEO_2026_HTML = \`${escape(files.RAPPORT_STATE_AEO_2026_HTML)}\`;

${verticalConsts}

const TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML = \`${escape(files.TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML)}\`;

const BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML = \`${escape(files.BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML)}\`;

const BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML = \`${escape(files.BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML)}\`;

const BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML = \`${escape(files.BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML)}\`;

const BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML = \`${escape(files.BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML)}\`;

const BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML = \`${escape(files.BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML)}\`;

const BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML = \`${escape(files.BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML)}\`;

const BLOGG_AEO_BUDSJETT_45X_HTML = \`${escape(files.BLOGG_AEO_BUDSJETT_45X_HTML)}\`;

const BLOGG_AEO_SJEKKLISTE_2026_HTML = \`${escape(files.BLOGG_AEO_SJEKKLISTE_2026_HTML)}\`;

const BLOGG_GA4_AI_ASSISTANT_2026_HTML = \`${escape(files.BLOGG_GA4_AI_ASSISTANT_2026_HTML)}\`;

const BLOGG_CHATGPT_KONVERTERER_9X_HTML = \`${escape(files.BLOGG_CHATGPT_KONVERTERER_9X_HTML)}\`;

const BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML = \`${escape(files.BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML)}\`;

const BLOGG_90_PROSENT_USYNLIGE_HTML = \`${escape(files.BLOGG_90_PROSENT_USYNLIGE_HTML)}\`;

const BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML = \`${escape(files.BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML)}\`;

const BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML = \`${escape(files.BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML)}\`;

const LEADERBOARD_HTML = \`${escape(files.LEADERBOARD_HTML)}\`;

const LEADERBOARD_JSON = \`${escape(files.LEADERBOARD_JSON)}\`;

const CONTEXT_MD = \`${escape(files.CONTEXT_MD)}\`;

const PRISER_MD = \`${escape(files.PRISER_MD)}\`;

const ONE_PAGER_PDF_B64 = "${PDF_B64}";

// AEO Reports: hash -> HTML content
const REPORTS = {
${reportsMapEntries}
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' mailto:",
};

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600",
};

// 1x1 transparent GIF for tracking pixel
const TRACKING_GIF_B64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const routes = {
  "/": { body: INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/index.html": { body: INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/priser": { body: PRISER_HTML, contentType: "text/html; charset=utf-8" },
  "/priser/": { body: PRISER_HTML, contentType: "text/html; charset=utf-8" },
  "/priser.html": { body: PRISER_HTML, contentType: "text/html; charset=utf-8" },
  "/faktura": { body: FAKTURA_HTML, contentType: "text/html; charset=utf-8" },
  "/faktura/": { body: FAKTURA_HTML, contentType: "text/html; charset=utf-8" },
  "/faktura.html": { body: FAKTURA_HTML, contentType: "text/html; charset=utf-8" },
  "/guide": { body: GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/guide.html": { body: GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/dashboard": { body: DASHBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/dashboard.html": { body: DASHBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/llms.txt": { body: LLMS_TXT, contentType: "text/plain; charset=utf-8" },
  "/robots.txt": { body: ROBOTS_TXT, contentType: "text/plain; charset=utf-8" },
  "/sitemap.xml": { body: SITEMAP_XML, contentType: "application/xml; charset=utf-8" },
  "/og.svg": { body: OG_SVG, contentType: "image/svg+xml" },
  "/favicon.svg": { body: FAVICON_SVG, contentType: "image/svg+xml" },
  "/analyse/komplett-aeo": { body: KOMPLETT_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/analyse/komplett-aeo.html": { body: KOMPLETT_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/case/nordic-lithium": { body: NORDIC_LITHIUM_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/case/nordic-lithium.html": { body: NORDIC_LITHIUM_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/case/pierstop": { body: PIERSTOP_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/case/pierstop.html": { body: PIERSTOP_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/.well-known/agent-card.json": { body: AGENT_CARD_JSON, contentType: "application/json; charset=utf-8" },
  "/.well-known/agent.json": { body: AGENT_CARD_JSON, contentType: "application/json; charset=utf-8" },
  "/blogg": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/index.html": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo": { body: BLOGG_HVA_ER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo.html": { body: BLOGG_HVA_ER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-i-norge-2026": { body: BLOGG_AEO_I_NORGE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-i-norge-2026.html": { body: BLOGG_AEO_I_NORGE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norsk-aeo-benchmark-2026": { body: BLOGG_NORSK_AEO_BENCHMARK_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norsk-aeo-benchmark-2026.html": { body: BLOGG_NORSK_AEO_BENCHMARK_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/mcp-security-march-2026": { body: BLOGG_MCP_SECURITY_MARCH_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/mcp-security-march-2026.html": { body: BLOGG_MCP_SECURITY_MARCH_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-byra-norge": { body: BLOGG_AEO_BYRA_NORGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-byra-norge.html": { body: BLOGG_AEO_BYRA_NORGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/lokal-ai-synlighet": { body: BLOGG_LOKAL_AI_SYNLIGHET_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/lokal-ai-synlighet.html": { body: BLOGG_LOKAL_AI_SYNLIGHET_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/slik-blir-du-synlig-i-chatgpt": { body: BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/slik-blir-du-synlig-i-chatgpt.html": { body: BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/caveman-ai-pricing-april-2026": { body: BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/caveman-ai-pricing-april-2026.html": { body: BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/er-nettsida-di-klar-for-ai-agentar": { body: BLOGG_ER_NETTSIDA_DI_KLAR_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/er-nettsida-di-klar-for-ai-agentar.html": { body: BLOGG_ER_NETTSIDA_DI_KLAR_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/stavanger-agent-beredskap-april-2026": { body: BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/stavanger-agent-beredskap-april-2026.html": { body: BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo-guide": { body: BLOGG_HVA_ER_AEO_GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo-guide.html": { body: BLOGG_HVA_ER_AEO_GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-vs-seo": { body: BLOGG_AEO_VS_SEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-vs-seo.html": { body: BLOGG_AEO_VS_SEO_HTML, contentType: "text/html; charset=utf-8" },
  "/rapport/state-of-aeo-2026": { body: RAPPORT_STATE_AEO_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/rapport/state-of-aeo-2026.html": { body: RAPPORT_STATE_AEO_2026_HTML, contentType: "text/html; charset=utf-8" },
${verticalRoutes}
  "/tjenester/digital-markedsforing-stavanger": { body: TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/digital-markedsforing-stavanger/": { body: TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/digital-markedsforing-stavanger.html": { body: TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/digital-markedsforing-stavanger": { body: BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/digital-markedsforing-stavanger.html": { body: BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/chatgpt-annonser-og-aeo-april-2026": { body: BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/chatgpt-annonser-og-aeo-april-2026.html": { body: BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/automatisert-aeo-vs-radgiving": { body: BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/automatisert-aeo-vs-radgiving.html": { body: BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/stavanger-klinikk-aeo-analyse": { body: BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/stavanger-klinikk-aeo-analyse.html": { body: BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norges-aeo-leaderboard-2026-04": { body: BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norges-aeo-leaderboard-2026-04.html": { body: BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/eu-ai-act-norske-bedrifter": { body: BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/eu-ai-act-norske-bedrifter.html": { body: BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-budsjett-45x-okonomi": { body: BLOGG_AEO_BUDSJETT_45X_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-budsjett-45x-okonomi.html": { body: BLOGG_AEO_BUDSJETT_45X_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-sjekkliste-2026": { body: BLOGG_AEO_SJEKKLISTE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-sjekkliste-2026.html": { body: BLOGG_AEO_SJEKKLISTE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/ga4-ai-assistant-2026": { body: BLOGG_GA4_AI_ASSISTANT_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/ga4-ai-assistant-2026.html": { body: BLOGG_GA4_AI_ASSISTANT_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/chatgpt-konverterer-9x": { body: BLOGG_CHATGPT_KONVERTERER_9X_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/chatgpt-konverterer-9x.html": { body: BLOGG_CHATGPT_KONVERTERER_9X_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-sok-redesign-mai-2026": { body: BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-sok-redesign-mai-2026.html": { body: BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/90-prosent-usynlige-i-ai-sok": { body: BLOGG_90_PROSENT_USYNLIGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/90-prosent-usynlige-i-ai-sok.html": { body: BLOGG_90_PROSENT_USYNLIGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-spam-policy-aeo-mai-2026": { body: BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-spam-policy-aeo-mai-2026.html": { body: BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/93-prosent-ai-mode-null-klikk": { body: BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/93-prosent-ai-mode-null-klikk.html": { body: BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML, contentType: "text/html; charset=utf-8" },
  "/leaderboard": { body: LEADERBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/leaderboard/": { body: LEADERBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/leaderboard.html": { body: LEADERBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/leaderboard.json": { body: LEADERBOARD_JSON, contentType: "application/json; charset=utf-8" },
  "/context.md": { body: CONTEXT_MD, contentType: "text/markdown; charset=utf-8" },
  "/priser.md": { body: PRISER_MD, contentType: "text/markdown; charset=utf-8" },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Click tracking + redirect: GET /click?h={prospect_hash}&t={link_type}&u={url}
    // Logs click to KV (synlig-clicks namespace) then redirects to destination.
    // h = prospect hash (matches report hash), t = link type (report/guide/booking),
    // u = destination URL (URL-encoded)
    if (pathname === "/click") {
      const h = url.searchParams.get("h") || "unknown";
      const t = url.searchParams.get("t") || "link";
      const dest = url.searchParams.get("u");
      const ts = Date.now();
      const ua = request.headers.get("User-Agent") || "-";
      const ref = request.headers.get("Referer") || "-";
      const ip = request.headers.get("CF-Connecting-IP") || "-";
      const country = request.headers.get("CF-IPCountry") || "-";

      // Log to console always
      console.log(\`[CLICK] h=\${h} t=\${t} dest=\${dest} country=\${country} ua=\${ua.substring(0,80)}\`);

      // Store in KV if available
      if (env && env.CLICK_LOG) {
        const key = \`click:\${h}:\${ts}\`;
        const val = JSON.stringify({ h, t, dest, ts, ua: ua.substring(0, 200), ref: ref.substring(0, 200), ip, country });
        await env.CLICK_LOG.put(key, val, { expirationTtl: 7776000 }); // 90 days

        // Update aggregate stats for this hash
        const statsKey = \`stats:\${h}\`;
        const existing = await env.CLICK_LOG.get(statsKey, "json") || { count: 0, last: 0, types: {} };
        existing.count = (existing.count || 0) + 1;
        existing.last = ts;
        existing.types[t] = (existing.types[t] || 0) + 1;
        await env.CLICK_LOG.put(statsKey, JSON.stringify(existing));
      }

      // Redirect to destination, fallback to homepage
      const destination = dest ? decodeURIComponent(dest) : "https://synligdigital.no";
      return new Response(null, {
        status: 302,
        headers: { "Location": destination, "Cache-Control": "no-store" },
      });
    }

    // Click admin: GET /clicks?key={admin_key}
    // Shows all tracked clicks in a simple HTML table.
    if (pathname === "/clicks") {
      const key = url.searchParams.get("key");
      if (key !== "pico2026") {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!env || !env.CLICK_LOG) {
        return new Response("KV not configured", { status: 503 });
      }

      // List all stats keys (aggregated per prospect)
      const statsList = await env.CLICK_LOG.list({ prefix: "stats:" });
      const rows = [];
      for (const item of statsList.keys) {
        const stats = await env.CLICK_LOG.get(item.name, "json");
        if (stats) {
          const hash = item.name.replace("stats:", "");
          const lastDate = new Date(stats.last).toISOString().substring(0, 16).replace("T", " ");
          const typeSummary = Object.entries(stats.types || {}).map(([k, v]) => \`\${k}:\${v}\`).join(" ");
          rows.push(\`<tr><td>\${hash}</td><td>\${stats.count}</td><td>\${lastDate} UTC</td><td>\${typeSummary}</td></tr>\`);
        }
      }

      // List recent individual clicks
      const clickList = await env.CLICK_LOG.list({ prefix: "click:", limit: 50 });
      const recentRows = [];
      for (const item of clickList.keys.reverse()) {
        const click = await env.CLICK_LOG.get(item.name, "json");
        if (click) {
          const date = new Date(click.ts).toISOString().substring(0, 16).replace("T", " ");
          const destShort = (click.dest || "").substring(0, 60);
          recentRows.push(\`<tr><td>\${date}</td><td>\${click.h}</td><td>\${click.t}</td><td>\${click.country}</td><td title="\${click.dest}">\${destShort}</td></tr>\`);
        }
      }

      const html = \`<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"><title>Synlig — Klikk-oversikt</title>
<style>body{font-family:system-ui;padding:2rem;background:#0f172a;color:#e2e8f0}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{padding:.5rem 1rem;text-align:left;border:1px solid #334155}th{background:#1e293b}tr:hover{background:#1e293b}h2{color:#38bdf8}</style></head>
<body><h1>Klikk-oversikt</h1>
<h2>Per prospekt</h2>
<table><tr><th>Hash</th><th>Klikk</th><th>Siste klikk</th><th>Typer</th></tr>\${rows.join("")}</table>
<h2>Siste 50 klikk</h2>
<table><tr><th>Tid</th><th>Hash</th><th>Type</th><th>Land</th><th>Destinasjon</th></tr>\${recentRows.join("")}</table>
</body></html>\`;

      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // Serve PDF binary
    if (pathname === "/one-pager.pdf" || pathname === "/rapport.pdf") {
      const bytes = Uint8Array.from(atob(ONE_PAGER_PDF_B64), c => c.charCodeAt(0));
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "inline; filename=synlig-digital-ai-synlighet.pdf",
          ...SECURITY_HEADERS,
          ...CACHE_HEADERS,
        },
      });
    }

    // Tracking pixel: GET /track?h={hash}
    // Returns 1x1 GIF. Each request logged by Cloudflare Analytics.
    // Check: https://dash.cloudflare.com → Analytics → /track paths
    if (pathname === "/track") {
      const h = url.searchParams.get("h") || "unknown";
      // Log to console (visible in CF Workers logs)
      console.log(\`[TRACK] Report viewed: \${h} | UA: \${request.headers.get("User-Agent") || "-"} | Ref: \${request.headers.get("Referer") || "-"}\`);
      const gifBytes = Uint8Array.from(atob(TRACKING_GIF_B64), c => c.charCodeAt(0));
      return new Response(gifBytes, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Self-service AEO audit: GET /audit or GET /audit?url=...
    if (pathname === "/audit" || pathname === "/audit/") {
      return handleAuditRequest(request, env);
    }

    // Lead capture: POST /api/lead-capture (email + tier + slug)
    // Validates email, persists lead:<sha1>:<ts> marker, mints a 5-min one-time
    // KV handoff token, then 302s to the matching checkout endpoint with
    // ?lead=<token>. Each checkout reads & deletes the token, prefills Stripe
    // customer_email. Email never enters URLs/browser history.
    // Source: checkout-handler.ts → handleLeadCapture.
    if ((pathname === "/api/lead-capture" || pathname === "/api/lead-capture/") && request.method === "POST") {
      return handleLeadCapture(request, env);
    }

    // Stripe Checkout entry: GET /api/handlingsplan-checkout?slug=<attribution>[&lead=<token>]
    // Creates a Stripe Checkout Session (live 4 900 NOK Synlig Handlingsplan AEO)
    // and 302-redirects to session.url. Source: checkout-handler.ts.
    if (pathname === "/api/handlingsplan-checkout") {
      return handleCheckoutRequest(request, env);
    }

    // Tier 2 — GET /api/fundament-checkout?slug=<attribution>
    // 14 900 NOK single-payment Synlig Fundament AEO. Source: checkout-handler.ts.
    // Wired 2026-05-20 after dogfood revealed missing router case (handler existed
    // but was unimported); /priser shipped same day referenced this route.
    if (pathname === "/api/fundament-checkout") {
      return handleFundamentCheckout(request, env);
    }

    // Tier 3 — GET /api/lopende-checkout?slug=<attribution>
    // 4 900 NOK/mnd recurring subscription, Synlig Løpende overvåking AEO.
    // Source: checkout-handler.ts. Wired 2026-05-20 (same dogfood fix as Tier 2).
    if (pathname === "/api/lopende-checkout") {
      return handleLopendeCheckout(request, env);
    }

    // Stripe webhook: POST /api/stripe-webhook
    // Verifies signature, persists order to KV, fires Telegram notification.
    if (pathname === "/api/stripe-webhook" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }

    // Faktura form submit: POST /faktura
    // Replaces broken mailto: CTAs on /priser with a structured capture form.
    // GET /faktura is served from the routes map below (static HTML).
    // Source: faktura-handler.ts. KV: FAKTURA_ORDERS. Email: Resend.
    if ((pathname === "/faktura" || pathname === "/faktura/" || pathname === "/faktura.html") && request.method === "POST") {
      return handleFakturaSubmit(request, env);
    }

    // Order confirmation page: GET /takk-for-bestilling?session_id=<cs_...>&slug=<...>
    if (pathname === "/takk-for-bestilling" || pathname === "/takk-for-bestilling/") {
      return handleTakkPage(request, env);
    }

    // Path-shorthand redirects — typing-pattern conversion repair (2026-05-23 idle audit).
    // Both paths were 404ing despite being the natural URL a prospect types when
    // they hear "sjekk din score på Synlig" or "kontakt Synlig Digital".
    // /sjekk → the AEO audit subdomain app; /kontakt → homepage anchor section.
    // 301 (permanent) because the canonical surface is stable; cached 1 day so the
    // redirect cost is paid once per browser per day, not per click.
    if (pathname === "/sjekk" || pathname === "/sjekk/") {
      return new Response(null, {
        status: 301,
        headers: { "Location": "https://sjekk.synligdigital.no/", "Cache-Control": "public, max-age=86400" },
      });
    }
    if (pathname === "/kontakt" || pathname === "/kontakt/") {
      return new Response(null, {
        status: 301,
        headers: { "Location": "https://synligdigital.no/#kontakt", "Cache-Control": "public, max-age=86400" },
      });
    }

    // AEO Report hosting: GET /r/{hash}
    if (pathname.startsWith("/r/")) {
      const hash = pathname.slice(3); // Remove /r/
      // Defensive: refuse empty-hash requests. /r/ (no segment) must 404,
      // never return REPORTS[""]. Paired with the build.ts filter that skips
      // any reports/.html file. See note above re: 877cd9b Pierstop leak.
      if (!hash) {
        return new Response("Rapport ikke funnet", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      const reportHtml = REPORTS[hash];
      if (reportHtml) {
        return new Response(reportHtml, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store", // Always fresh for prospects
            ...SECURITY_HEADERS,
          },
        });
      }
      return new Response("Rapport ikke funnet", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const route = routes[pathname];
    if (route) {
      return new Response(route.body, {
        status: 200,
        headers: {
          "Content-Type": route.contentType,
          ...SECURITY_HEADERS,
          ...CACHE_HEADERS,
        },
      });
    }

    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...SECURITY_HEADERS,
      },
    });
  },
};
`;

await Bun.write("/workspace/synlig-worker/worker.ts", worker);
console.log("Worker generated successfully");
console.log(`Size: ${worker.length} bytes`);
