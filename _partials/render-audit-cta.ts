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

export type Stage = "awareness" | "consideration" | "decision";
export type Position = "mid" | "bottom";

const FREE_AUDIT_HEADLINE = "Hvor synlig er din bedrift i AI-søk?";
const FREE_AUDIT_SUB =
  "Få gratis AEO-score på 30 sekunder. Sjekk hva ChatGPT, Perplexity og Google AI faktisk vet om bedriften din.";
const FREE_AUDIT_BTN = "Kjør gratis sjekk &rarr;";
const FREE_AUDIT_TRUST = "Ingen registrering nødvendig. Gratis rapport.";

const PRICING_HEADLINE = "Full handlingsplan, 4 900 NOK";
const PRICING_SUB =
  "Du får en gjennomgang av hva ChatGPT, Perplexity og Google AI ser om bedriften din, pluss konkrete tiltak du kan iverksette neste uke. Levering innen 5 virkedager.";
const PRICING_BTN = "Bestill handlingsplan — 4 900 NOK &rarr;";

function checkoutHref(slug: string): string {
  return `/api/handlingsplan-checkout?slug=${encodeURIComponent(slug)}`;
}

function mailtoFor(slug: string): string {
  const subject = `Handlingsplan AEO — ${slug}`;
  const body =
    `Hei,\n\nJeg leste blogginnlegget «${slug}» på synligdigital.no og er interessert i å bestille en full handlingsplan (4 900 NOK).\n\nKan du ringe meg, eller foreslå tidspunkt for en kort prat?\n\nVennlig hilsen,\n`;
  // mailto requires URL-encoded subject + body
  return `mailto:hei@synligdigital.no?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

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

function pricingBlock(slug: string): string {
  return `<div class="audit-cta__pricing-link">
      <span class="audit-cta__pricing-label">Vil du ha en plan?</span>
      <form method="POST" action="/api/lead-capture" class="lead-form">
        <input type="email" name="email" class="lead-form-input" placeholder="din@firma.no" required autocomplete="email">
        <input type="hidden" name="tier" value="handlingsplan">
        <input type="hidden" name="slug" value="blog-${slug}">
        <button type="submit" class="audit-cta__btn">Full handlingsplan, 4 900 NOK &rarr;</button>
      </form>
      <a class="audit-cta__pricing-mail" href="${mailtoFor(slug)}">Eller send oss en e-post</a>
    </div>`;
}

function pricingPrimary(slug: string): string {
  return `<h3 class="audit-cta__headline">${PRICING_HEADLINE}</h3>
  <p class="audit-cta__sub">${PRICING_SUB}</p>
  <form method="POST" action="/api/lead-capture" class="lead-form">
    <input type="email" name="email" class="lead-form-input" placeholder="din@firma.no" required autocomplete="email">
    <input type="hidden" name="tier" value="handlingsplan">
    <input type="hidden" name="slug" value="blog-${slug}">
    <button type="submit" class="audit-cta__btn">${PRICING_BTN}</button>
  </form>
  <p class="audit-cta__trust">Sikker betaling via Stripe. Levering innen 5 virkedager. <a href="${mailtoFor(slug)}" class="audit-cta__mailto-fallback">Eller send oss en e-post: hei@synligdigital.no</a></p>`;
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
    <p class="audit-cta__secondary-label">Eller: kjør først en gratis 30-sek sjekk.</p>
    ${auditForm(slug, suffix)}
  </div>`;
}

const SHARED_STYLE = `<style>
.audit-cta {
  background: var(--bg-raised, #111113);
  border: 1px solid var(--border, #222225);
  border-left: 3px solid var(--accent, #6ee7b7);
  border-radius: 8px;
  padding: 1.5rem 1.75rem;
  margin: 2rem 0;
}
.audit-cta__headline {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--accent, #6ee7b7);
  margin-bottom: 0.4rem;
  letter-spacing: -0.01em;
}
.audit-cta__sub {
  color: var(--text-dim, #9f9faa);
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
  background: var(--bg, #0a0a0b);
  border: 1px solid var(--border, #222225);
  border-radius: 6px;
  color: var(--text, #e8e8ed);
  font-size: 0.95rem;
  outline: none;
}
.audit-cta__input:focus { border-color: var(--accent, #6ee7b7); }
.audit-cta__btn {
  padding: 0.55rem 1.1rem;
  background: var(--accent, #6ee7b7);
  color: var(--bg, #0a0a0b);
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
.audit-cta__btn--link { color: var(--bg, #0a0a0b); }
.audit-cta__primary-row { margin: 0.5rem 0 0.6rem; }
.audit-cta__trust {
  color: var(--text-muted, #9f9faa);
  font-size: 0.8rem;
  margin-top: 0.6rem;
}
.audit-cta__pricing-link {
  display: block;
  margin-top: 1rem;
  padding: 0.7rem 0.9rem;
  border: 1px dashed var(--border, #2a2a30);
  border-radius: 6px;
  color: var(--text, #e8e8ed);
  text-decoration: none;
  font-size: 0.9rem;
  transition: border-color 0.15s, background 0.15s;
}
.audit-cta__pricing-link:hover {
  border-color: var(--accent, #6ee7b7);
  background: rgba(110, 231, 183, 0.04);
}
.audit-cta__pricing-label {
  display: block;
  color: var(--text-dim, #9f9faa);
  font-size: 0.82rem;
  margin-bottom: 0.15rem;
}
.audit-cta__pricing-anchor {
  display: block;
  color: var(--accent, #6ee7b7);
  font-weight: 600;
  text-decoration: none;
}
.audit-cta__pricing-anchor:hover { text-decoration: underline; }
.audit-cta__pricing-mail {
  display: block;
  color: var(--text-dim, #9f9faa);
  font-size: 0.78rem;
  margin-top: 0.35rem;
  text-decoration: none;
}
.audit-cta__pricing-mail:hover { color: var(--text, #e8e8ed); text-decoration: underline; }
.audit-cta__mailto-fallback {
  color: var(--text-dim, #9f9faa);
  text-decoration: underline;
}
.audit-cta__mailto-fallback:hover { color: var(--text, #e8e8ed); }
.audit-cta__secondary {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--border, #2a2a30);
}
.audit-cta__secondary-label {
  color: var(--text-dim, #9f9faa);
  font-size: 0.85rem;
  margin-bottom: 0.6rem;
}
@media (max-width: 600px) {
  .audit-cta__row { flex-direction: column; }
  .audit-cta__input, .audit-cta__btn { width: 100%; }
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
  background: var(--bg, #0a0a0b);
  border: 1px solid var(--border, #222225);
  border-radius: 6px;
  color: var(--text, #e8e8ed);
  font-size: 0.95rem;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.lead-form-input:focus { border-color: var(--accent, #6ee7b7); }
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

  // Style only emitted with mid (shared across both blocks per post).
  return position === "mid" ? `${block}\n${SHARED_STYLE}` : block;
}

// Validation helper for build.ts: every blog post must use both markers exactly once.
export const MID_MARKER = "<!-- AUDIT-CTA:mid -->";
export const BOTTOM_MARKER = "<!-- AUDIT-CTA:bottom -->";

// Exports for build-time invariants: every rendered blog post must carry
// BOTH a /api/lead-capture entry point AND a mailto:hei@synligdigital.no
// fallback. Primary CTA = lead-capture form → Stripe; secondary = email (low-trust path).
// CHECKOUT_HREF_PREFIX kept as tombstone in case any page still has a direct checkout link.
export const LEAD_CAPTURE_PATH = "/api/lead-capture";
export const CHECKOUT_HREF_PREFIX = "/api/handlingsplan-checkout?slug=";
export const MAILTO_PREFIX = "mailto:hei@synligdigital.no";

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
