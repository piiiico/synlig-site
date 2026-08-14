/**
 * EN-FLATENS HowTo — ÉN kilde for hva /en/ forteller svarmotorene at vi selger.
 *
 * HVORFOR (2026-08-14): /en/ shippet en HowTo-node som beskrev det NEDLAGTE
 * fire-stegs programmet — «Free AEO score» → «Technical AEO analysis and
 * report» → «Implementation» → «Continuous monitoring and optimization»,
 * totalTime P14D, estimatedCost USD 1400 — mens hvert eneste Offer, hver FAQ
 * og hver knapp på SAMME side solgte Sitert-pakken til USD 1,100 i tre steg.
 * Prisen ble rettet samme dag; produktbeskrivelsen sto igjen. Det er verre enn
 * prisen: JSON-LD er flaten svarmotorene faktisk leser, og vi selger å bli
 * riktig sitert av AI. Vi matet dem en retainer vi ikke har (steg 4) og et
 * implementeringsoppdrag /metode eksplisitt sier vi ikke selger.
 *
 * Rotårsaken er den samme som på /metode 08-12 (åtte håndholdte påstandssteder
 * → én utledet kilde): produktdefinisjonen fantes fire steder i samme fil,
 * hvert sted håndskrevet. Tre av dem ble migrert da tilbudet ble reposisjonert.
 * Det fjerde var det ingen leser med øynene — så det overlevde.
 *
 * INVARIANT: HowTo-noden på /en/ ER denne modulen. Porten (checkEnCitedHowTo)
 * leser de SERVERTE bytene, bygger noden på nytt fra TIERS, og feiler bygget
 * på hvert eneste avvik — én bokstav i et steg, ett siffer i prisen, en node
 * som forsvant. Endrer du produktet, endrer du denne fila; alt annet er en
 * gaffel bygget nekter å deploye.
 *
 * PRISEN utledes fra TIERS.sitert.usd (bin/cross-border-invoice.ts), skinnen
 * som faktisk fakturerer kjøperen. Ingen siffer skrives for hånd her.
 *
 * totalTime ER MED VILJE UTELATT. Den norske søsternoden droppet den 08-09 med
 * begrunnelsen «en frist i markup er et løfte til hver crawler som leser den».
 * Her er den dessuten umulig å oppgi ærlig: steg 3 kjøres 30 dager etter at
 * KUNDEN publiserer, og vi kontrollerer ikke den datoen. P14D var oppdiktet.
 *
 * KILDE for stegene (lest 2026-08-14): priser.html — Offer-beskrivelsen,
 * leveransetabellen og FAQ-en «Hvor lang tid tar det?» — og en.html sin egen
 * Offer-node for Sitert-pakken. Stegene under er den engelske formuleringen av
 * nøyaktig det de to sier.
 */
import { TIERS } from "../../bin/cross-border-invoice";

const HOWTO_ID = "https://synligdigital.no/en/#howto-aeo";
const STEP_URL = "https://synligdigital.no/en/";

/** minor units → bare JSON-LD figure, e.g. 110000 → "1100" */
const bare = (minor: number): string => String(minor / 100);

export const CITED_STEPS = [
  {
    name: "Baseline measurement",
    text:
      "Five buying-intent questions from your market, written the way a buyer types them. You approve or replace them before anything runs. Each question is then run at least nine times over several days with byte-identical prompts — one run is not a measurement, because the same model answers the same question differently. You get how often your domain was cited with a link, and the names of who was cited instead.",
  },
  {
    name: "The changes, written out for up to ten pages",
    text:
      "JSON-LD, citable questions and answers, llms.txt and AI-crawler rules — written out for up to ten pages, ready to paste or delivered as a pull request, within five business days of question approval. You publish them, and they stay in your own pages afterwards.",
  },
  {
    name: "Re-measurement 30 days after you publish",
    text:
      "The same five questions, nine new runs, before and after in one document with the raw data: question, model, timestamp per run, who was cited with a link and who was only mentioned. Written outcome criterion — at least one citation of your domain in the follow-up runs. If it is not met, we run another round at no extra charge.",
  },
] as const;

export function citedHowToNode() {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": HOWTO_ID,
    name: "How the Cited package runs: baseline, changes, re-measurement",
    description:
      "How Synlig Digital's Cited package runs end to end: a baseline measurement on five buying-intent questions with at least nine byte-identical runs, the changes written out for up to ten pages, and a re-measurement 30 days after you publish — with a written outcome criterion and the raw data included.",
    inLanguage: "en",
    estimatedCost: {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: bare(TIERS.sitert.usd),
    },
    step: CITED_STEPS.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
      url: STEP_URL,
    })),
  };
}

/** The exact bytes the block occupies in en.html. Written by tooling, not by hand. */
export function renderCitedHowToBlock(): string {
  return (
    `<script type="application/ld+json">\n` +
    JSON.stringify(citedHowToNode(), null, 2) +
    `\n</script>`
  );
}

/** Flatten @graph / arrays so a node is found wherever a future edit puts it. */
function nodesOf(parsed: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      out.push(v as Record<string, unknown>);
      const g = (v as Record<string, unknown>)["@graph"];
      if (g) walk(g);
    }
  };
  walk(parsed);
  return out;
}

/** First differing path, so the build error names the drift instead of dumping two blobs. */
function firstDiff(a: unknown, b: unknown, path = ""): string | null {
  if (a === b) return null;
  const prim = (v: unknown) => v === null || typeof v !== "object";
  if (prim(a) || prim(b)) {
    return `${path || "(root)"}: shipped ${JSON.stringify(a)} — source says ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return `${path || "(root)"}: shipped ${Array.isArray(a) ? "array" : "object"}, source has the other`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return `${path || "(root)"}: shipped ${a.length} entries, source has ${b.length}`;
    }
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    if (!(k in ao)) return `${path}.${k}: missing from the shipped node`;
    if (!(k in bo)) return `${path}.${k}: shipped but not in the source module`;
    const d = firstDiff(ao[k], bo[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

const MIN_HTML_BYTES = 5_000;

/**
 * RETAINER-VOKABULAR — den samme påstanden, ett felt unna.
 *
 * Da HowTo-noden var rettet, sto det NEDLAGTE programmet fortsatt i WebPage-
 * nodens description på samme side: «Free AEO score, written audit, full
 * implementation, and continuous monitoring». En port bygget rundt ÉN node er
 * per konstruksjon blind for søskenet i neste blokk — nøyaktig samme form som
 * prisporten som leste feltet `price` og ikke `value` samme morgen.
 *
 * Derfor leses ALLE JSON-LD-blokker på EN-forsiden etter ord som bare kan
 * beskrive et abonnement. Vi selger ett engangsprodukt; en retainer finnes ikke
 * i prislisten (TIERS har to engangs-tiers).
 *
 * BASISRATE MÅLT FØR PORTEN BLE SKREVET (CLAUDE.md: en «defekt» flertallet har,
 * er basisraten, ikke en defekt): på en.html traff listen 2 av 2 kjente
 * defekter og 0 andre steder. På resten av EN-korpuset traff «full
 * implementation» ÉN blogg-FAQ som beskriver KUNDENS implementeringstid, ikke
 * vårt tilbud — derfor er porten scoped til forsiden, og derfor står ikke
 * «written audit» på listen: den er tvetydig (vi leverer skriftlig rapport).
 */
const RETAINER_VOCAB = [
  "continuous monitoring",
  "monthly measurement",
  "continuous adjustment",
  "per month",
  "/mo",
];

/**
 * GULV FØRST: tom, kort eller node-løs inngang er FEIL, ikke «ingen avvik».
 * En port som er grønn når HowTo-noden forsvant, sertifiserer en tom flate —
 * og det er nøyaktig feilmodusen (falsk-CLEAN på fraværende input) CLAUDE.md
 * har talt ti ganger.
 */
export function checkEnCitedHowTo(html: string, label = "en.html"): string[] {
  const v: string[] = [];
  if (!html || html.length < MIN_HTML_BYTES) {
    return [
      `${label}: FLOOR — ${html?.length ?? 0} bytes reached the HowTo gate (expected ≥ ${MIN_HTML_BYTES}). ` +
        `Empty input is a broken reader, not a clean surface.`,
    ];
  }

  const blocks = [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ];
  if (blocks.length === 0) {
    return [`${label}: FLOOR — zero JSON-LD blocks on the surface we sell to answer engines.`];
  }

  const found: Record<string, unknown>[] = [];
  for (const [i, b] of blocks.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(b[1]);
    } catch (e) {
      v.push(`${label}: JSON-LD block ${i + 1} does not parse (${(e as Error).message}).`);
      continue;
    }
    for (const n of nodesOf(parsed)) {
      if (n["@id"] === HOWTO_ID || n["@type"] === "HowTo") found.push(n);
    }
  }

  if (found.length === 0) {
    v.push(
      `${label}: no HowTo node with @id ${HOWTO_ID}. It is the node that tells ChatGPT and ` +
        `Perplexity what we actually sell — its absence is a failure, not a pass.`,
    );
    return v;
  }
  if (found.length > 1) {
    v.push(
      `${label}: ${found.length} HowTo nodes on one surface. Two answers to "what do you sell" ` +
        `is how the retired four-step programme survived beside the live three-step one.`,
    );
  }

  const canonical = JSON.parse(JSON.stringify(citedHowToNode()));
  const diff = firstDiff(found[0], canonical);
  if (diff) {
    v.push(
      `${label}: the HowTo node has forked from _partials/en-cited-howto.ts → ${diff}. ` +
        `Change the product in that module; the page is its serialisation, not a second opinion.`,
    );
  }

  // Samme påstand, andre noder. Leses på hele JSON-LD-laget, ikke bare HowTo-en.
  for (const [i, b] of blocks.entries()) {
    const lower = b[1].toLowerCase();
    for (const dead of RETAINER_VOCAB) {
      if (lower.includes(dead)) {
        v.push(
          `${label}: JSON-LD block ${i + 1} sells a retainer ("${dead}"). ` +
            `TIERS has two one-off tiers and no subscription — this is the retired programme ` +
            `surviving in a node nobody reads with their eyes.`,
        );
      }
    }
  }
  return v;
}
