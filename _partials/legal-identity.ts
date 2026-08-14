// ─────────────────────────────────────────────────────────────────────────────
// legal-identity.ts — SINGLE SOURCE for "which legal entity is this, and who
// will invoice me?" Injected into every shipped footer at build time.
//
// WHY THIS EXISTS (2026-08-14, fase 4 /om-avgjørelsen):
// The task asked whether to build an /om page. Measured live the same morning:
//   /om      -> 404
//   /kontakt -> 301 https://synligdigital.no/#kontakt
//   footer   -> "Synlig Digital · Stavanger · hei@synligdigital.no · synligdigital.no"
// The footer carried NO legal entity, NO org.nr, NO MVA status. An enterprise
// buyer (the Komplett-class reader this whole redesign targets) does not want a
// prose "om oss" page — he wants to know which juridical person will send the
// invoice, and to look it up himself. /metode already does the professional
// "how we work" job, and a thin /om would be worse than none.
//
// So the verdict was DO-NOT-BUILD, and this file is what replaces it: the
// legitimacy facts move into the footer, where they are on EVERY page instead
// of on one page the buyer has to find. The addition absorbs /om entirely.
//
// PRIMARY SOURCE — Brønnøysundregistrene, read 2026-08-14:
//   https://data.brreg.no/enhetsregisteret/api/enheter/921058640
//   navn:                              "AS ÅMDAL INVEST"
//   organisasjonsform:                 AS (Aksjeselskap)
//   registrertIMvaregisteret:          true (fra 2024-07-29)
//   forretningsadresse:                Eilert Sundts gate 17, 4010 STAVANGER
//   stiftelsesdato:                    2018-06-02
//   naeringskode1:                     62.200 IT-konsulentvirksomhet
// Consistent with what the site already told buyers in two places before this
// file existed (priser.html FAQ + leaderboard.html): "fakturert fra AS Åmdal
// Invest". This makes that claim verifiable instead of merely asserted.
//
// STREET ADDRESS IS DELIBERATELY NOT PUBLISHED HERE. Brreg lists it as a c/o
// on Håkon's private home address. It is public record, but broadcasting a
// person's home address across ~260 pages (incl. 193 named-prospect reports)
// is a personal-identity decision, not a copy decision. The Brreg link gives
// any buyer the full record from the authoritative registry — which is better
// trust design than restating it anyway.
//
// SINGLE-SOURCE INVARIANT: the org.nr must never be typed anywhere else. It is
// a derived number across ~260 footers; if it forks, the wrong entity gets
// looked up. build.ts injects from here and then GATES on the marker being
// present in every surface that has a <footer>. Pinned by
// synlig-worker/legal-identity.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const LEGAL = {
  /** Public-facing brand. Not a registered entity — a trading name. */
  brand: "Synlig Digital",
  /** Registered legal entity that contracts and invoices. Brreg 2026-08-14. */
  entity: "AS Åmdal Invest",
  /** 9 digits, no spaces. The canonical value. */
  orgnrPlain: "921058640",
  /** Norwegian display convention: 3-3-3, non-breaking so it never wraps. */
  orgnrDisplay: "921&nbsp;058&nbsp;640",
  /** registrertIMvaregisteret: true, since 2024-07-29. */
  mvaRegistered: true,
  /** Business municipality (city only — see street-address note above). */
  city: "Stavanger",
  region: "Rogaland",
  /**
   * Postal code of the REGISTERED business address (Brreg forretningsadresse
   * 2026-08-14). Coarse enough to publish; the street number is not.
   */
  postalCode: "4010",
  /** Human-readable authoritative registry entry. */
  brregUrl: "https://virksomhet.brreg.no/nb/oppslag/enheter/921058640",
} as const;

/**
 * Postal codes this site has asserted in the past and must never assert again.
 *
 * 2026-08-14: "4006" was claimed in 17 places — including three LocalBusiness
 * JSON-LD blocks and the shipped front page — while Brreg's registered address
 * is 4010. NAP consistency (name/address/phone agreeing everywhere an engine
 * can look) is a thing this agency SELLS; the Pierstop case study on our own
 * pricing page says in so many words "vi rettet JSON-LD og NAP-konsistens".
 * Our own entity disagreed with the national registry an AI would join against.
 *
 * Banned rather than merely replaced, because a string swept once comes back:
 * 4006 lived in prose, in FAQ answer text, in three schema blocks and in two
 * hand-written footers. build.ts fails on any recurrence in any shipped
 * surface.
 */
export const DEAD_POSTAL_CODES = ["4006"] as const;

/**
 * Marker attribute the build gate keys on. Also makes the block idempotent:
 * a surface that already carries it is never injected twice (build.ts runs
 * over registries that can overlap, and reports/ get re-patched by the
 * patch-reports-*.ts scripts).
 */
export const LEGAL_MARKER = "data-legal-identity";

/**
 * The footer block. Inline styles only — this ships into ~30 hand-written
 * legacy pages, 193 generated reports and one Tailwind/Astro layout, and those
 * three families share no class names. `opacity` + `inherit` mean it adopts
 * whatever footer colour the host page already uses, light or dark.
 *
 * SELF-PADDING IS LOAD-BEARING, not decoration. injectLegalIdentity always
 * lands this as a DIRECT CHILD of <footer> — i.e. OUTSIDE whatever
 * .container / .mx-auto wrapper the host page uses for its gutters. Caught by
 * rendering the shipped artifact before deploy (2026-08-14): without the
 * max-width + padding below the text runs edge-to-edge on a 390px phone.
 * Because the insert point is deterministic (direct child, never inside a
 * container) the padding can never double up. Pinned in legal-identity.test.ts.
 */
export function renderLegalLine(): string {
  return (
    `<p ${LEGAL_MARKER} style="max-width:1120px;margin:12px auto 0;padding:0 24px;font-size:0.75rem;line-height:1.6;opacity:0.7;color:inherit;">` +
    `${LEGAL.brand} drives av <strong style="font-weight:600;color:inherit;">${LEGAL.entity}</strong>` +
    ` &middot; org.nr <a href="${LEGAL.brregUrl}" rel="noopener nofollow" style="color:inherit;text-decoration:underline;">${LEGAL.orgnrDisplay}</a>` +
    ` &middot; MVA-registrert &middot; ${LEGAL.city}, Norge` +
    `<br>Fakturaer sendes fra ${LEGAL.entity}. Org.nr kan slås opp i Brønnøysundregistrene.` +
    `</p>`
  );
}

/**
 * Insert the block immediately before the LAST </footer> in the document.
 * Last, not first: a page with two footers (report scaffolds nest one inside a
 * print wrapper) should carry it on the one the reader actually ends on.
 *
 * Returns the html unchanged when there is no footer, or when the marker is
 * already present. Never throws — build.ts gates on the result instead, so a
 * silent no-op here still fails the build loudly there.
 */
export function injectLegalIdentity(html: string): string {
  if (html.includes(LEGAL_MARKER)) return html;
  const idx = html.lastIndexOf("</footer>");
  if (idx === -1) return html;
  return html.slice(0, idx) + renderLegalLine() + html.slice(idx);
}

/** True when this surface is expected to carry the block. */
export function hasFooter(html: string): boolean {
  return /<footer\b/i.test(html) && html.includes("</footer>");
}
