// Renders the canonical audit-cta block for a blog post.
//
// Two positions: mid (full block with shared <style>), bottom (form-only, no style).
// Three stages: awareness | consideration | decision — controls which CTA is primary.
//
// Source-of-truth for copy and structure. build.ts replaces
// <!-- AUDIT-CTA:mid --> and <!-- AUDIT-CTA:bottom --> markers with renderer output.
//
// Stage policy:
//   awareness/consideration → audit form is the highlighted card; pricing line is muted secondary.
//   decision → pricing block is the highlighted card; audit form drops to inline secondary.

import { NAMING_PROOF, ENGINE_HEADLINE, ENGINE_PANEL, ENGINE_CAVEAT } from "./naming-proof";

export type Stage = "awareness" | "consideration" | "decision";
export type Position = "mid" | "bottom";

const FREE_AUDIT_HEADLINE = "Hvor synlig er din bedrift i AI-søk?";
const FREE_AUDIT_SUB =
  "Få gratis AEO-score på 2–5 sekunder. Sjekk om AI-crawlere kan lese nettsiden din, og om Perplexity nevner bedriften din når kunder spør. " +
  `Vil du vite hva ${FREE_MEASUREMENT.engines.join(", ").replace(/, ([^,]*)$/, " og $1")} svarer på kundenes egne spørsmål? <a href="/gratis-maaling?src=blog-audit-box">Bestill en gratis måling</a>.`;
const FREE_AUDIT_BTN = "Kjør gratis sjekk &rarr;";
const FREE_AUDIT_TRUST = "Ingen registrering nødvendig. Gratis rapport.";

// 2026-10-30 ladder (task c094dde82a6f79ef, Håkon 10-28 «altfor dyrt» + «mailto: er
// også noe dritt»): free measurement via the on-site form /gratis-maaling →
// Lite → Sitert-pakken → Månedlig måling. Prices come from synlig-worker/prices.ts;
// no CTA here is a mailto any more (a mailto drops everyone without a mail client).
// Never reintroduce a tier /priser does not sell; blog-cta-dual-tier.test.ts
// bans them by name, comments included.
import { PRICES_NOK, kr, FREE_MEASUREMENT } from "../../synlig-worker/prices";
const SITERT = `${kr(PRICES_NOK.sitert)} kr`;
const LITE = `${PRICES_NOK.lite} NOK`;
const PRICING_HEADLINE = "Gratis måling: blir dere nevnt?";
const PRICING_SUB =
  "Skriv inn tre spørsmål kundene deres stiller. Vi stiller dem til ChatGPT, Gemini og Claude, to ganger hver, og sender dere hvem som blir nevnt, med rådataene. Vil dere ha endringene gjort etterpå, koster Sitert-pakken " + SITERT + " eks. mva.";
const PRICING_BTN = "Bestill gratis måling &rarr;";
const gratisHref = (slug: string) => `/gratis-maaling?src=blog-${encodeURIComponent(slug)}`;
const sitertHref = (slug: string) => `/faktura?slug=blog-${encodeURIComponent(slug)}&amp;pakke=priser-sitert`;

// Canonical Lite product page — gives cautious readers a no-email-required
// discovery path. Closes the asymmetric internal-link state for 32 blog
// post footers (parallel to the 2026-06-06 12:40 /priser → product-page link).
const LITE_PRODUCT_PAGE = "/blogg/aeo-lite-faqpage-990-kr";

function auditForm(slug: string, suffix: string): string {
  return `<form class="audit-cta__form" action="https://synligdigital.no/audit" method="get" target="_self">
    <input type="hidden" name="src" class="audit-cta__src-field" value="blog-${slug}${suffix}">
    <div class="audit-cta__row">
      <input
        class="audit-cta__input"
        type="text"
        name="url"
        placeholder="dinbedrift.no"
        autocomplete="off"
        required
      >
      <button class="audit-cta__btn" type="submit">${FREE_AUDIT_BTN}</button>
    </div>
  </form>`;
}

// Proof line: motorpanelet fra _partials/naming-proof.ts (tallene og forbeholdet
// interpoleres, kan ikke gafle seg). Perplexity-raden er historisk siden 2026-10-27.
const ENGINE_PROOF = `<p class="audit-cta__proof-line">${ENGINE_HEADLINE} (${ENGINE_PANEL.measuredAt}: ${ENGINE_CAVEAT.charAt(0).toLowerCase()}${ENGINE_CAVEAT.slice(1, -1)}). <a href="https://synligdigital.no${NAMING_PROOF.docPath}" class="audit-cta__proof-link">Se dokumentasjon →</a></p>`;

// Dual-tier secondary block (awareness + consideration stages).
//
// Reader is mid-funnel — still learning. Pricing block is a "if you're ready,
// here's what's available" callout. Lite (990 NOK FAQPage-one-side) stays the
// Enter-key default: it is the only tier with a self-serve rail, and it is an
// easier YES for someone who just finished an explainer. Sitert-måling is the
// considered purchase and sits above it as an e-post-lenke, not a submit button
// — it has no card rail, so a form button would promise a checkout that does
// not exist.
//
// Tier carrier: button.name="tier" (no hidden tier input — would conflict).
// Slug: shared "blog-{slug}" preserves Stripe-attribution continuity.
function pricingBlock(slug: string): string {
  return `<div class="audit-cta__pricing-link">
      ${ENGINE_PROOF}
      <span class="audit-cta__pricing-label">Vil du vite om AI siterer dere? To nivåer:</span>
      <a class="audit-cta__btn audit-cta__btn--wide audit-cta__btn--gratis" href="${gratisHref(slug)}">Gratis måling <span class="audit-cta__btn-detail">(tre av deres spørsmål, tre AI-motorer)</span> &rarr;</a>
      <form method="POST" action="/api/lead-capture" class="lead-form lead-form--dual">
        <input type="email" name="email" class="lead-form-input" placeholder="din@firma.no" required autocomplete="email">
        <input type="hidden" name="slug" value="blog-${slug}">
        <button type="submit" name="tier" value="lite" class="audit-cta__btn audit-cta__btn--secondary">Synlig Lite — ${LITE} <span class="audit-cta__btn-detail">(FAQPage for én side, 1 virkedag)</span> &rarr;</button>
      </form>
      <a class="audit-cta__pricing-learn" href="${LITE_PRODUCT_PAGE}">Usikker på Lite? Les hva 990 kr kjøper deg &rarr;</a>
      <a class="audit-cta__pricing-learn" href="${sitertHref(slug)}">Eller bestill endringene gjort: Sitert-pakken, ${SITERT} &rarr;</a>
    </div>`;
}

// Dual-tier primary block (decision stage).
//
// Reader is buyer-shape — the free measurement leads the card (it is the
// on-ramp to Sitert-pakken). Lite (990 NOK) is the "test først" secondary and keeps the
// self-serve rail. Nothing here may charge a card for sitert-måling: it is
// invoiced only.
//
// Tier carrier: button.name="tier" (same pattern as pricingBlock + case-pages).
function pricingPrimary(slug: string): string {
  return `<h3 class="audit-cta__headline">${PRICING_HEADLINE}</h3>
  <p class="audit-cta__sub">${PRICING_SUB}</p>
  <p class="audit-cta__primary-row"><a class="audit-cta__btn audit-cta__btn--wide audit-cta__btn--gratis" href="${gratisHref(slug)}">${PRICING_BTN}</a></p>
  <form method="POST" action="/api/lead-capture" class="lead-form lead-form--dual">
    <input type="email" name="email" class="lead-form-input" placeholder="din@firma.no" required autocomplete="email">
    <input type="hidden" name="slug" value="blog-${slug}">
    <button type="submit" name="tier" value="lite" class="audit-cta__btn audit-cta__btn--secondary">Test først: Synlig Lite — ${LITE} <span class="audit-cta__btn-detail">(FAQPage, 1 virkedag)</span> &rarr;</button>
  </form>
  <p class="audit-cta__trust">Målingen er gratis. <a href="${sitertHref(slug)}" class="audit-cta__pricing-learn">Sitert-pakken (${SITERT} eks. mva)</a> faktureres med 14 dagers frist, ingen bindingstid. Synlig Lite betales med kort eller faktura, levering 1 virkedag.</p>
  <p class="audit-cta__trust audit-cta__trust--lite-learn"><a href="${LITE_PRODUCT_PAGE}" class="audit-cta__mailto-fallback">Vil du teste først? Les om Synlig Lite (990 NOK, 1 virkedag) &rarr;</a></p>
  ${ENGINE_PROOF}`;
}

function auditPrimary(slug: string, suffix: string): string {
  return `<h3 class="audit-cta__headline">${FREE_AUDIT_HEADLINE}</h3>
  <p class="audit-cta__sub">${FREE_AUDIT_SUB}</p>
  ${auditForm(slug, suffix)}
  <p class="audit-cta__trust">${FREE_AUDIT_TRUST}</p>`;
}

function secondaryAudit(slug: string, suffix: string): string {
  // Compact secondary form (no headline, smaller framing)
  return `<div class="audit-cta__secondary">
    <p class="audit-cta__secondary-label">Eller: kjør først en gratis 5-sek sjekk.</p>
    ${auditForm(slug, suffix)}
  </div>`;
}

// Tracking script: fires navigator.sendBeacon to /api/track-click when a visitor
// clicks a mailto fallback CTA. Emitted once per page (with mid CTA only).
// /api/track-click stores the click in KV under mailto-click:{src}:{ts}.
// This gives us an intent signal for blog-originated mailto interest without
// relying on email-client instrumentation (which bypasses the server entirely).
const MAILTO_TRACKING_SCRIPT = `<script>
(function(){
  document.querySelectorAll('a.audit-cta__btn--gratis').forEach(function(link){
    link.addEventListener('click',function(){
      var cta=link.closest('.audit-cta');
      var raw=cta?cta.getAttribute('data-slug'):'unknown';
      var slug=raw?raw.replace(/-end$/,''):'unknown';
      navigator.sendBeacon('/api/track-click?src=blog-'+encodeURIComponent(slug)+'&type=gratis');
    });
  });
  document.querySelectorAll('a.audit-cta__pricing-learn').forEach(function(link){
    link.addEventListener('click',function(){
      var cta=link.closest('.audit-cta');
      var raw=cta?cta.getAttribute('data-slug'):'unknown';
      var slug=raw?raw.replace(/-end$/,''):'unknown';
      navigator.sendBeacon('/api/track-click?src=blog-'+encodeURIComponent(slug)+'&type=lite-learn');
    });
  });
})();
</script>`;

const SHARED_STYLE = `<style>
.audit-cta {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  padding: 1.5rem 1.75rem;
  margin: 2rem 0;
}
.audit-cta__headline {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 0.4rem;
  letter-spacing: -0.01em;
}
.audit-cta__sub {
  color: var(--text-dim);
  font-size: 0.95rem;
  margin-bottom: 1rem;
}
.audit-cta__row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.audit-cta__input {
  flex: 1 1 200px;
  min-width: 160px;
  padding: 0.55rem 0.9rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
}
.audit-cta__input:focus { border-color: var(--accent); }
.audit-cta__btn {
  padding: 0.55rem 1.1rem;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
  white-space: nowrap;
  text-decoration: none;
  display: inline-block;
}
.audit-cta__btn:hover { opacity: 0.88; }
/* Tier buttons carry a price AND a detail span, which is wider than the CTA
   card on a phone. nowrap (correct for the short primary button) clipped the
   labels mid-word on every migrated blog post. Let these wrap; they are the
   paid-offer click. */
.lead-form--dual .audit-cta__btn {
  white-space: normal;
  text-align: center;
}
/* Sitert-måling has no card rail, so its CTA is an <a>, not a submit button.
   .audit-cta__btn is inline-block; an anchor in a block context must be told
   to fill the card or it collapses to text width next to a 100%-wide form. */
.audit-cta__btn--wide {
  display: block;
  width: 100%;
  box-sizing: border-box;
  text-align: center;
  white-space: normal;
}
.audit-cta__btn--link { color: var(--bg); }
.audit-cta__btn--secondary {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
}
.audit-cta__btn--secondary:hover {
  background: var(--bg);
  opacity: 1;
}
.audit-cta__btn-detail {
  font-weight: 400;
  font-size: 0.82rem;
  opacity: 0.85;
  margin-left: 0.25rem;
}
.lead-form--dual {
  gap: 0.45rem;
}
.lead-form--dual .audit-cta__btn {
  text-align: center;
}
.audit-cta__primary-row { margin: 0.5rem 0 0.6rem; }
.audit-cta__trust {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 0.6rem;
}
.audit-cta__pricing-link {
  display: block;
  margin-top: 1rem;
  padding: 0.7rem 0.9rem;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
  font-size: 0.9rem;
  transition: border-color 0.15s, background 0.15s;
}
.audit-cta__pricing-link:hover {
  border-color: var(--accent);
  background: var(--bg);
}
.audit-cta__pricing-label {
  display: block;
  color: var(--text-dim);
  font-size: 0.82rem;
  margin-bottom: 0.15rem;
}
.audit-cta__pricing-anchor {
  display: block;
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}
.audit-cta__pricing-anchor:hover { text-decoration: underline; }
.audit-cta__pricing-mail {
  display: block;
  color: var(--text-dim);
  font-size: 0.78rem;
  margin-top: 0.35rem;
  text-decoration: none;
}
.audit-cta__pricing-mail:hover { color: var(--text); text-decoration: underline; }
.audit-cta__pricing-learn {
  display: block;
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 500;
  margin-top: 0.55rem;
  text-decoration: none;
  border-bottom: 1px dashed transparent;
  width: fit-content;
}
.audit-cta__pricing-learn:hover {
  border-bottom-color: var(--accent);
  text-decoration: none;
}
.audit-cta__trust--lite-learn { margin-top: 0.45rem; }
.audit-cta__proof-line {
  font-size: 0.8rem;
  color: var(--text-dim);
  margin: 0.5rem 0 0.6rem;
  line-height: 1.5;
}
.audit-cta__proof-link {
  color: var(--accent);
  text-decoration: underline;
}
.audit-cta__proof-link:hover { opacity: 0.85; }
.audit-cta__mailto-fallback {
  color: var(--text-dim);
  text-decoration: underline;
}
.audit-cta__mailto-fallback:hover { color: var(--text); }
.audit-cta__secondary {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--border);
}
.audit-cta__secondary-label {
  color: var(--text-dim);
  font-size: 0.85rem;
  margin-bottom: 0.6rem;
}
@media (max-width: 600px) {
  .audit-cta__row { flex-direction: column; }
  /* The row's main axis is now vertical, so the 200px flex-basis above would
     size the input's HEIGHT, not its width — a 200px-tall empty text field on
     every phone. Basis must be content-driven once the axis flips. */
  .audit-cta__input, .audit-cta__btn { width: 100%; flex-basis: auto; }
}
.lead-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.5rem 0 0.3rem;
}
.lead-form-input {
  width: 100%;
  padding: 0.55rem 0.9rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.95rem;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.lead-form-input:focus { border-color: var(--accent); }
.lead-form .audit-cta__btn { width: 100%; font-family: inherit; }
</style>`;

export function renderAuditCta(slug: string, position: Position, stage: Stage): string {
  const suffix = position === "bottom" ? "-end" : "";
  const dataSlugAttr = position === "bottom" ? `${slug}-end` : slug;

  let inner: string;
  if (stage === "decision") {
    inner = `${pricingPrimary(slug)}
  ${secondaryAudit(slug, suffix)}`;
  } else {
    // awareness + consideration: audit primary, pricing secondary
    inner = `${auditPrimary(slug, suffix)}
  ${pricingBlock(slug)}`;
  }

  const block = `<div class="audit-cta" data-slug="${dataSlugAttr}" data-stage="${stage}">
  ${inner}
</div>`;

  // Style + tracking script only emitted with mid (shared across both blocks per post).
  return position === "mid" ? `${block}\n${SHARED_STYLE}\n${MAILTO_TRACKING_SCRIPT}` : block;
}

// Validation helper for build.ts: every blog post must use both markers exactly once.
export const MID_MARKER = "<!-- AUDIT-CTA:mid -->";
export const BOTTOM_MARKER = "<!-- AUDIT-CTA:bottom -->";

// Exports for build-time invariants: every rendered blog post must carry
// BOTH a /api/lead-capture entry point AND the /gratis-maaling form link, and
// NO mailto (2026-10-30: the on-site form replaced every CTA mailto).
// CHECKOUT_HREF_PREFIX kept as tombstone in case any page still has a direct checkout link.
export const LEAD_CAPTURE_PATH = "/api/lead-capture";
export const CHECKOUT_HREF_PREFIX = "/api/handlingsplan-checkout?slug=";
export const MAILTO_PREFIX = "mailto:hei@synligdigital.no";
export const GRATIS_PATH = "/gratis-maaling";

// The paid-offer anchors this renderer writes. build.ts asserts every blog
// post surfaces at least one. That is the real invariant behind the check
// this replaced, which named a single price literally and therefore started
// demanding a discontinued one: a reader researching on the blog must see a
// PRICE, not just the free audit — and it must be a price we still sell.
//
// Exported from here, not restated in build.ts, because this file is the
// single writer of the copy the gate is checking. build.ts additionally
// verifies each pattern still occurs in THIS file's source — so renaming a
// price without updating this list fails the build loudly instead of leaving
// the gate quietly matching nothing.
export const LIVE_PRICE_ANCHORS: Array<[RegExp, string]> = [
  [/Gratis måling/, "Gratis måling (/gratis-maaling)"],
  [/990\s*NOK/, "Synlig Lite 990 NOK"],
];

export function applyMarkers(slug: string, html: string, stage: Stage): { html: string; errors: string[] } {
  const errors: string[] = [];
  const midCount = (html.match(/<!-- AUDIT-CTA:mid -->/g) || []).length;
  const botCount = (html.match(/<!-- AUDIT-CTA:bottom -->/g) || []).length;
  if (midCount !== 1) errors.push(`expected 1 ${MID_MARKER}, found ${midCount}`);
  if (botCount !== 1) errors.push(`expected 1 ${BOTTOM_MARKER}, found ${botCount}`);
  if (errors.length > 0) return { html, errors };

  const out = html
    .replace(MID_MARKER, renderAuditCta(slug, "mid", stage))
    .replace(BOTTOM_MARKER, renderAuditCta(slug, "bottom", stage));
  return { html: out, errors: [] };
}
