/**
 * EN-FLATENS PRISPORT — én kilde for hvert tall en utenlandsk kjøper leser.
 *
 * Hvorfor (2026-08-14): 2026-08-13 ble kryss-grense-skinnen bygget
 * (bin/cross-border-invoice.ts) og tatt i bruk utad samme kveld — Ondo-E1
 * siterte «USD 1,100» fra quoteBlock('sitert','usd'). Samtidig kvoterte
 * /en/ Sitert-pakken som «NOK 9,900» på åtte håndholdte steder, inkludert
 * hoved-CTA-en og JSON-LD-tilbudet. Samme produkt, to tall, samme leser:
 * en amerikansk kjøper fikk ett beløp på e-post og et annet på siden vi ba
 * ham klikke til. I tillegg sto TIERS.lite.usd på 11000 (USD 110) mens den
 * LEVENDE Stripe-skinnen (synlig-worker/checkout-handler.ts, lang=en →
 * ["usd","9200"]) faktisk belaster USD 92 — altså en gaffel til, i motsatt
 * retning, mot vår egen kortskinne.
 *
 * CLAUDE.md: «collapse to ONE build-time source + gate so the number cannot
 * fork». Kilden er TIERS i bin/cross-border-invoice.ts. Denne porten leser de
 * SERVERTE bytene og regner de tillatte strengene ut fra TIERS på nytt, så
 * tre ting fanges som modulen alene ikke fanger: en håndredigert en.html, et
 * bygg som ikke ble kjørt før deploy, og et hardkodet tall som sniker seg inn
 * igjen senere.
 *
 * INVARIANTER (ingen av dem pinner en målt verdi — TIERS er fri til å endre
 * hvert siffer, og porten følger etter av seg selv):
 *   1. Hver «USD <tall>» på flaten er enten sitert- eller lite-prisen i TIERS.
 *   2. Enhver side med en sitert-bestillings-CTA (pakke=priser-sitert) kvoterer
 *      sitert-prisen i USD (positiv kontroll — en port som bare forbyr, er
 *      grønn på en side uten priser). Betinget, fordi en EN-side uten CTA
 *      lovlig kan være prisfri (en-blog-aeo-agency-norway).
 *   3. NOK forekommer bare som opplyst norsk listepris-basis, aldri i en
 *      bestillings-CTA (<a href=".../faktura...">) — det er lenken kjøperen
 *      trykker for å betale, og den må vise valutaen han faktisk faktureres i.
 *   4. JSON-LD-tilbud på EN-flaten har priceCurrency USD og en price-verdi
 *      som finnes i TIERS.
 * GULV: tom/kort inngang = FEIL, ikke «ingen avvik». En port som er grønn på
 * tom inngang er blind (CLAUDE.md, 10 tilfeller).
 *
 * KORPUS (2026-08-14, andre runde): porten leste FØRST bare en.html. Da den
 * ble kjørt over hele EN-flaten falt seks andre sider ut med «NOK 9,900» —
 * inkludert /en/blog og /en/case/nordic-lithium, som begge har en
 * bestillings-CTA — pluss «USD 460» for Analyse-pakken vi la ned 2026-08-08.
 * En port over feil filsett er falsk-ren per konstruksjon (CLAUDE.md 08-12).
 * Derfor eier runEnPriceCorpusGate sitt eget omfang: den GLOBBER en*.html fra
 * disk og krever at byggeren ga den hver eneste én. Legger noen til en
 * EN-side uten å koble den på, sier porten fra — omfanget er ikke en liste
 * noen må huske å oppdatere.
 */
import { readFileSync, readdirSync } from "node:fs";
import { TIERS } from "../../bin/cross-border-invoice";

const SITE_DIR = "/workspace/synlig-site";

export type EnPriceGateResult = { prices: number; violations: string[] };

/** minor units → display major, e.g. 110000 → "1,100" */
const major = (minor: number): string => (minor / 100).toLocaleString("en-US");

/**
 * THE INVARIANT: the figure on the page equals the figure the RAIL that will
 * actually charge the buyer. The two live EN tiers sit on different rails, so
 * each derives from its own — deriving both from one table would be tidier and
 * wrong, which is how "USD 1,100 by email / NOK 9,900 on the page" happened.
 *
 *   Sitert → cross-border INVOICE rail  → TIERS.sitert.usd
 *   Lite   → Stripe CARD rail           → checkout-handler.ts unit_amount
 *
 * Reading the card rail's own source (rather than restating it) is what makes
 * a drift on either side fail the build instead of reaching a buyer.
 */
const CARD_RAIL_SRC = "/workspace/synlig-worker/checkout-handler.ts";

function liteCardRailMinor(): number {
  const src = readFileSync(CARD_RAIL_SRC, "utf-8");
  const m = src.match(/lang === "en" \? \["usd", "(\d+)"\] : \["nok", "\d+"\]/);
  if (!m) {
    throw new Error(
      `en-price-gate: could not read the Lite card-rail amount from ${CARD_RAIL_SRC}. ` +
        `The gate refuses to guess a price — fix the selector, do not default.`,
    );
  }
  return Number(m[1]);
}

/** Every EN-surface price string is derived here, never typed. */
export const EN_PRICES = {
  sitertUsd: `USD ${major(TIERS.sitert.usd)}`,
  liteUsd: `USD ${major(liteCardRailMinor())}`,
  /** Norwegian list price — allowed on the EN surface ONLY as stated basis. */
  sitertNok: `NOK ${major(TIERS.sitert.nok)}`,
} as const;

/** Bare digits a JSON-LD "price" field may carry, derived from the same source. */
const JSONLD_ALLOWED = new Set([
  String(TIERS.sitert.usd / 100),
  String(liteCardRailMinor() / 100),
]);

const ALLOWED_USD = new Set([EN_PRICES.sitertUsd, EN_PRICES.liteUsd]);

/**
 * The SAME prices in "$" notation. Order buttons are written '… — $92 →', not
 * '… — USD 92 →', so a gate that only knows "USD" is blind to exactly the
 * control a buyer clicks. That blindness was not theoretical: the first
 * corpus run came back green while /en/blog/llm-smell-check-benchmark still
 * rendered a submit button reading "Or full write-up — $460 →" for the
 * Analysis tier, discontinued six days earlier.
 */
const ALLOWED_DOLLAR = new Set(
  [...ALLOWED_USD].map((s) => s.replace(/^USD /, "$")),
);

/**
 * Tier ids an EN order control may post. Derived from the price table, so
 * retiring a tier disarms its order path on the next build instead of leaving
 * a button that sells a product we no longer have.
 */
const LIVE_TIER_IDS = new Set(Object.keys(TIERS));

const MIN_HTML_BYTES = 5_000;

/**
 * Floor for an EXTRACTED surface (a JS object literal, not a page). The page
 * floor would false-fail one: EN_PACKAGES is 3.9 kB of real, shipping,
 * buyer-read text. Each caller states what "present" means for its own surface
 * rather than one number pretending to fit both.
 */
export const MIN_BLOCK_BYTES = 1_000;

/**
 * Buttons and order anchors — the controls a buyer actually clicks.
 *
 * Comments are stripped FIRST. A comment describing a control (`deliberately
 * an <a href="/faktura"> rather than a second submit`) otherwise opens a match
 * that runs on until some later `</a>`, swallowing unrelated text and
 * reporting a violation against a control that does not exist. Found by the
 * bidirectional test of this very gate: the revert arm produced two true
 * violations and one phantom. A gate that invents a third defect is not
 * stricter, it is wrong, and the next reader spends the afternoon on it.
 *
 * Only the CONTROL arm strips comments. The currency arms deliberately keep
 * reading them — a dead price parked in a comment still ships to the browser
 * and still gets quoted back by an answer engine, which is how two retired
 * tiers surfaced here.
 */
function orderControls(html: string): string[] {
  const live = html
    .replace(/<!--[\s\S]*?-->/g, "") // HTML comments
    .replace(/^[ \t]*\/\/.*$/gm, ""); // JS line comments (line-anchored: never eats https://)
  return [
    ...(live.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []),
    ...(live.match(/<a\b[^>]*href="[^"]*\/faktura[^"]*"[^>]*>[\s\S]*?<\/a>/g) ?? []),
  ];
}

export function runEnPriceGate(
  html: string,
  label: string,
  minBytes: number = MIN_HTML_BYTES,
): EnPriceGateResult {
  const violations: string[] = [];

  // ── FLOOR ────────────────────────────────────────────────────────────────
  if (typeof html !== "string" || html.length < minBytes) {
    return {
      prices: 0,
      violations: [
        `${label}: FLOOR — input is ${html?.length ?? 0} bytes (< ${minBytes}). ` +
          `Refusing to report "no price violations" over an absent surface.`,
      ],
    };
  }

  // ── 1. every USD figure is a TIERS figure ────────────────────────────────
  const usdHits = html.match(/USD\s?[\d][\d,.]*/g) ?? [];
  for (const raw of usdHits) {
    const norm = raw.replace(/\s+/g, " ").replace(/[.,]$/, "").trim();
    if (!ALLOWED_USD.has(norm)) {
      violations.push(
        `${label}: "${norm}" is not a TIERS price. Allowed: ${[...ALLOWED_USD].join(", ")} ` +
          `(source: bin/cross-border-invoice.ts TIERS).`,
      );
    }
  }

  // ── 2. positive control, where a buyer can actually order ────────────────
  // Scoped to pages carrying the sitert order CTA: those are the pages where a
  // missing USD figure is a broken purchase, not an editorial choice.
  if (html.includes("pakke=priser-sitert") && !html.includes(EN_PRICES.sitertUsd)) {
    violations.push(
      `${label}: page carries a sitert order CTA but never quotes ${EN_PRICES.sitertUsd}. ` +
        `A buyer clicking it is invoiced in USD; the page must say so before he clicks.`,
    );
  }

  // ── 3. NOK may inform, never price the order button ──────────────────────
  const nokHits = html.match(/NOK\s?[\d][\d,.]*/g) ?? [];
  for (const raw of nokHits) {
    const norm = raw.replace(/\s+/g, " ").replace(/[.,]$/, "").trim();
    if (norm !== EN_PRICES.sitertNok) {
      violations.push(
        `${label}: "${norm}" is not the Norwegian list-price basis (${EN_PRICES.sitertNok}).`,
      );
    }
  }
  for (const anchor of html.match(/<a\b[^>]*href="[^"]*\/faktura[^"]*"[^>]*>[\s\S]*?<\/a>/g) ?? []) {
    if (/NOK/.test(anchor)) {
      violations.push(
        `${label}: an order CTA quotes NOK — the buyer clicking it is invoiced in USD. ` +
          `CTA: ${anchor.replace(/\s+/g, " ").slice(0, 120)}`,
      );
    }
  }

  // ── 3b. order controls: "$" notation and dead tier ids ───────────────────
  // Scoped to controls, not prose: "$13.5B by 2032" in an article is editorial,
  // "$460 →" on a button is a product we stopped selling.
  for (const ctrl of orderControls(html)) {
    for (const raw of ctrl.match(/\$\s?[\d][\d,.]*/g) ?? []) {
      const norm = raw.replace(/\s+/g, "").replace(/[.,]$/, "");
      if (!ALLOWED_DOLLAR.has(norm)) {
        violations.push(
          `${label}: order control prices "${norm}", not a live price ` +
            `(allowed: ${[...ALLOWED_DOLLAR].join(", ")}). ` +
            `Control: ${ctrl.replace(/\s+/g, " ").slice(0, 120)}`,
        );
      }
    }
    const tier = ctrl.match(/name="tier"\s+value="([^"]+)"/);
    if (tier && !LIVE_TIER_IDS.has(tier[1])) {
      violations.push(
        `${label}: order control posts tier="${tier[1]}", which is not in TIERS ` +
          `(live: ${[...LIVE_TIER_IDS].join(", ")}). It is selling a discontinued product. ` +
          `Control: ${ctrl.replace(/\s+/g, " ").slice(0, 120)}`,
      );
    }
  }

  // ── 3c. package price FIELDS — NOK may accompany the charge, never BE it ──
  // Both order surfaces state each package's price in a `price:` field rather
  // than in a CTA, so arm 3's anchor check is structurally blind to them. Those
  // fields are the LAST figure a buyer reads before he submits the order and
  // the FIRST one he reads after: EN_PACKAGE_DISPLAY on /faktura, EN_PACKAGES
  // in the confirmation email. On 2026-08-14 the sitert field read "NOK 9,900
  // excl. VAT (one-off)" while the CTA that sent him there read "USD 1,100 →"
  // and the invoice rail charged USD 1,100 — the whole en*.html corpus green,
  // the build log saying reconciled, and the next page in the funnel
  // disagreeing. It was found by curling the live URL, not by this gate; this
  // arm is what makes the gate able to find it.
  //
  // Derived, not enumerated: a field quoting NOK at all must also quote a live
  // USD price. A vertical priced by scope carries no figure and stays silent.
  for (const m of html.matchAll(/\bprice:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const value = m[1];
    if (!/\bNOK\b|\bkr\b/.test(value)) continue;
    if ([...ALLOWED_USD].some((p) => value.includes(p))) continue;
    violations.push(
      `${label}: a package price field is quoted in NOK with no USD figure beside it — ` +
        `this buyer is invoiced in USD. Field: "${value.slice(0, 110)}"`,
    );
  }

  // Positive control for the same fields. Arm 3c only forbids, so it is green
  // on a price field that lost its figure entirely; arm 2's positive control
  // keys on "pakke=priser-sitert", a string these JS blocks do not contain.
  const sitertEntry = html.match(
    /"priser-sitert"\s*:\s*\{[\s\S]*?\bprice:\s*"((?:[^"\\]|\\.)*)"/,
  );
  if (sitertEntry && !sitertEntry[1].includes(EN_PRICES.sitertUsd)) {
    violations.push(
      `${label}: the priser-sitert entry does not quote ${EN_PRICES.sitertUsd}. ` +
        `That is what the invoice rail charges (TIERS.sitert.usd); the order form and ` +
        `the confirmation email must both say it. Field: "${sitertEntry[1].slice(0, 110)}"`,
    );
  }

  // ── 4. JSON-LD offers speak the same currency ────────────────────────────
  for (const m of html.matchAll(/"priceCurrency"\s*:\s*"([A-Z]{3})"/g)) {
    if (m[1] !== "USD") {
      violations.push(
        `${label}: JSON-LD priceCurrency "${m[1]}" — the EN surface must offer in USD ` +
          `so AI engines and buyers read the same rail.`,
      );
    }
  }
  // 2026-08-14: this loop read "price" ONLY, and money in JSON-LD does not
  // always arrive under that key. Live /en/ shipped a HowTo whose estimatedCost
  // MonetaryAmount carried {"currency":"USD","value":"1400"} — a retired price —
  // while every Offer and every visible control on the same page said USD 1,100.
  // The gate was green the whole time: it was scoped to one FIELD, blind to the
  // sibling field with the same meaning. Same shape as the comment-stripper
  // scoped to one SYNTAX (HTML 08-08 → CSS 08-09 → JS 08-14). The surface that
  // read the wrong number is the one we sell — answer engines ingest JSON-LD.
  // "value" is safe to police corpus-wide: it appears exactly once across all
  // *.html + tjenester/*.html, and that once was this defect.
  for (const m of html.matchAll(/"(?:price|value)"\s*:\s*"([\d,.]+)"/g)) {
    if (!JSONLD_ALLOWED.has(m[1].replace(/,/g, ""))) {
      violations.push(
        `${label}: JSON-LD price "${m[1]}" is not a TIERS price ` +
          `(allowed: ${[...JSONLD_ALLOWED].join(", ")}).`,
      );
    }
  }

  const prices = usdHits.length + nokHits.length;
  if (prices === 0 && html.includes("pakke=priser-sitert")) {
    violations.push(
      `${label}: FLOOR — an order CTA with zero currency figures on a ${html.length}-byte page. ` +
        `Either the selector broke or the page lost its prices; both are failures.`,
    );
  }

  return { prices, violations };
}

/**
 * The /faktura ORDER PAGE's English surface.
 *
 * This is the page a foreign buyer reaches by clicking "Order the Sitert
 * package — USD 1,100 →", and for two hours on 2026-08-14 it answered him with
 * "NOK 9,900 excl. VAT (one-off)". Found by fetching the live URL the live /en/
 * actually links to, after the whole en*.html corpus was green and deployed —
 * the build log said the prices were reconciled, and the next page in the
 * funnel still contradicted them.
 *
 * It is NOT an en*.html file, so the corpus glob cannot see it: /faktura is one
 * bilingual document whose Norwegian body legitimately quotes "9 900 kr" and
 * whose English strings live in two JS objects swapped in client-side. Handing
 * the whole file to the gate would fail on the Norwegian prices, which is
 * presumably why nobody gated it. So extract exactly the English objects.
 *
 * `EN_STRINGS` carries the package <option> labels; `EN_PACKAGE_DISPLAY`
 * carries the price/SLA panel. Both are read by an English buyer, so both are
 * surfaces.
 */
export function faktura_EN_SURFACE(html: string): string {
  return ["EN_STRINGS", "EN_PACKAGE_DISPLAY"].map((n) => jsBlock(html, n)).join("\n");
}

/**
 * The CONFIRMATION-EMAIL surface — `EN_PACKAGES` in synlig-worker/faktura-handler.ts.
 *
 * The third English price table, and the one nobody was looking at. Its own
 * comment says «cross-referenced with EN_PACKAGE_DISPLAY … Keep in sync» — a
 * hand-maintained fork with a note asking the next human to remember, which is
 * precisely the shape the single-source rule exists to delete. It cannot import
 * this module (the gate reads node:fs; the file is bundled into a Cloudflare
 * Worker), so the collapse is the other direction: the gate reads BOTH tables
 * and re-derives both from TIERS, and the number cannot fork without failing
 * the build.
 *
 * It is a buyer surface in the strictest sense — the contract text a foreign
 * customer receives by email after paying us.
 */
export function fakturaConfirmation_EN_SURFACE(src: string): string {
  return jsBlock(src, "EN_PACKAGES");
}

/**
 * Extract a named JS object literal by brace balance.
 *
 * Brace balance rather than a closing-delimiter search because the two order
 * surfaces indent their closing brace differently (`\n};` in the worker,
 * `\n      };` in the page), and an indentation-specific probe reads as
 * "extracted nothing" on the file it was not written for — a false-clean
 * surface, which is the failure this whole gate exists to stop.
 *
 * Absence returns a loud sentinel, never "": renaming the object would
 * otherwise silently empty the surface and the gate would certify the void.
 * The sentinel carries "NOK 0" so it trips the currency arm even if a future
 * caller forgets the floor.
 */
function jsBlock(src: string, name: string): string {
  const m = src.match(new RegExp(`(?:var|const|let)\\s+${name}\\b[^=]*=\\s*\\{`));
  if (!m) return `MISSING_BLOCK ${name} NOK 0`;
  let depth = 0;
  for (let i = m.index! + m[0].length - 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(m.index!, i + 1);
  }
  return `MISSING_BLOCK ${name} (unterminated) NOK 0`;
}

/**
 * Corpus arm — checks the bytes that SHIP, over a scope it owns itself.
 * (The first version of this gate read en.html alone and was green while six
 * sibling EN pages quoted the dead NOK price, two quoted a tier retired
 * 2026-08-08, and one still rendered a live order button for it.)
 *
 * `surfaces` is label → SERVED bytes (build.ts `files`, AFTER the build's own
 * transforms). It must be the served bytes, never the file on disk: build.ts
 * splices an analytics beacon into every page, so the two differ by ~750 bytes
 * each. A first cut of this gate read disk and asserted the served bytes
 * matched — all 8 surfaces failed, which is the gate catching ITSELF doing the
 * 08-12 thing: certifying an artifact nobody serves.
 *
 * The disk glob survives as a SCOPE floor, so "you added an EN page and never
 * wired it into the price gate" is a build failure rather than a silent hole.
 */
export function runEnPriceCorpusGate(
  surfaces: Record<string, string>,
): EnPriceGateResult & { files: number } {
  const violations: string[] = [];
  const labels = Object.keys(surfaces);

  // ── FLOOR A: scope — every EN page on disk is represented ────────────────
  const onDisk = readdirSync(SITE_DIR).filter((f) => /^en.*\.html$/.test(f));
  if (onDisk.length === 0) {
    violations.push(
      `FLOOR — globbed ${SITE_DIR} for en*.html and found none. Refusing to report ` +
        `"no price violations" over an empty corpus.`,
    );
  }
  if (labels.length < onDisk.length) {
    violations.push(
      `FLOOR — ${onDisk.length} en*.html exist on disk but only ${labels.length} surfaces were ` +
        `handed to the price gate. Every EN page a buyer can land on must be price-checked; ` +
        `wire it into build.ts \`files\`.`,
    );
  }

  // ── per-surface invariants ───────────────────────────────────────────────
  let prices = 0;
  for (const label of labels) {
    // The floor is chosen from what the surface IS, not from a list someone
    // maintains: a page carries <html>, an extracted order table does not, and
    // a 3.9 kB table of shipping buyer-read text would false-fail the page
    // floor. An empty or truncated surface still floors under either number.
    const isPage = /<html[\s>]/i.test(surfaces[label] ?? "");
    const r = runEnPriceGate(
      surfaces[label],
      label,
      isPage ? MIN_HTML_BYTES : MIN_BLOCK_BYTES,
    );
    prices += r.prices;
    violations.push(...r.violations);
  }

  // ── FLOOR B: a globally broken selector reads as "all clear" otherwise ───
  if (prices === 0 && labels.length > 0) {
    violations.push(
      `FLOOR — zero currency figures across all ${labels.length} EN surfaces. ` +
        `The selector broke or the flat lost its prices; both are failures.`,
    );
  }

  return { prices, files: labels.length, violations };
}
