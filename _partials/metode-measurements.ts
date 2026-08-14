/**
 * ÉN SKRIVER FOR MÅLETALLENE PÅ /metode.
 *
 * Hvorfor denne fila finnes (2026-08-12): /metode publiserte «To av fem svar
 * holdt. Tre svingte.» over en tabell der TRE rader var merket «Holdt i hver
 * eneste kjøring» og TO «Varierte». Overskriften var invertert mot sin egen
 * tabell, mot primærkilden og mot vår egen publiserte setning på /leaderboard.
 * Tallene var skrevet for hånd i sida — i en fil hvis eget toppkommentar sa
 * «Ingen tall skrives for hånd». Det er tredje gang overskriftslaget ryker på
 * nøyaktig Komplett-tall (08-06 case-sidens title/H1/lead, 08-06/07 «sitert i
 * 3 av 5» sitert to ganger eksternt).
 *
 * Fiksen er ikke en bedre korrekturrutine. Den er at overskriften og radene
 * REGNES UT fra primærkilden her, slik at et menneske ikke kan skrive dem i
 * utakt. `_partials/metode-measure-gate.ts` leser i tillegg de SERVERTE bytene
 * og regner om det samme fra JSON — den fanger sømmen (dist → worker.ts) og et
 * håndredigert tall som sniker seg inn igjen.
 *
 * DATASETTET: ni kjøringer 6.–8. august 2026. Sida sier «minst ni kjøringer» i
 * protokoll-steget, «Hvorfor ni kjøringer» i seksjonsetiketten, «Hvorfor ni
 * kjøringer?» i FAQ-en og «ni byte-identiske kjøringer» i kildenoten — men
 * flaggskip-eksempelet viste SEKS. Ett datasett, og det er de ni: det er også
 * settet /leaderboard publiserer, som CTA-en rett under tabellen lenker til.
 */
import { readFileSync } from "node:fs";

export const EVIDENCE_PATH =
  "/workspace/money/aeo/leaderboard-score-vs-citation-2026-08-08.json";
export const BRAND_DOMAIN = "komplett.no";

/** Tallord 0–9. Overskriften skrives ut, ikke i siffer. */
const WORD = ["null", "ett", "to", "tre", "fire", "fem", "seks", "sju", "åtte", "ni"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const numWord = (n: number) => WORD[n] ?? String(n);
/** «Ett», «Fire» — tallord i setningsstart. */
export const numWordCap = (n: number) => cap(numWord(n));

export type MeasureRow = {
  /** Spørsmålet, byte-identisk slik det ble stilt. */
  q: string;
  /** Antall vellykkede kjøringer der domenet ble lenket med URL. */
  linked: number;
  /** Antall vellykkede kjøringer. En feilet kjøring teller ikke i det hele tatt. */
  runs: number;
  /**
   * «Holdt i hver eneste kjøring» = samme utfall i ALLE vellykkede kjøringer:
   * enten lenket hver gang, eller aldri lenket. Alt annet varierte. Dette er
   * definisjonen protokoll-steg 4 på sida oppgir, og den eneste som gjør en
   * påstand claim-safe.
   */
  held: boolean;
};

export type MetodeMeasurements = {
  rows: MeasureRow[];
  heldCount: number;
  variedCount: number;
  /** Overskriften over tabellen, utledet — aldri skrevet for hånd. */
  headline: string;
  totalRuns: number;
  /** Datoer (dd.m.) for kjøringene, unike og sortert. */
  runDayLabel: string;
  /** Sum vellykkede svar på tvers av alle kjøringer og spørsmål. */
  answersOk: number;
  /** Svar der domenet var til stede (nevnt i teksten ELLER lenket). */
  answersPresent: number;
  /** Svar med direkte lenke. */
  answersLinked: number;
  /** Færrest/flest spørsmål med lenke i én enkelt kjøring. */
  perRunMin: number;
  perRunMax: number;
  /**
   * Nullet som ikke holdt: spørsmålet med lavest treffrate der MINST én hel dag
   * ga null lenker og minst én annen dag ga lenke. Det er den redaksjonelle
   * poenget i avsnittet under tabellen — at også nullresultater svinger, og at
   * seks kjøringer over to dager derfor ikke er ni over tre. Finnes ikke et
   * slikt spørsmål lenger, kaster vi: da er avsnittet blitt usant og skal
   * skrives om, ikke publiseres videre.
   */
  zeroThatBroke: {
    q: string;
    zeroRuns: number;
    zeroDayLabel: string;
    hitRuns: number;
    hitLinked: number;
    hitDayLabel: string;
  };
};

const MONTH_NB = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
];
/** «7. og 8. august» / «6. august» — norsk oppramsing av dagsetiketter. */
function joinDays(days: string[], month: string): string {
  const nums = days.join(", ").replace(/, (?=[^,]*$)/, " og ");
  return `${nums} ${month}`;
}

export function loadMetodeMeasurements(): MetodeMeasurements {
  const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));

  const rows: MeasureRow[] = evidence.perQuestion
    .map((q: any) => {
      const linked = q.tracked?.[BRAND_DOMAIN];
      const runs = q.okRuns;
      if (typeof linked !== "number" || typeof runs !== "number" || runs === 0) {
        throw new Error(
          `[metode-measurements] ${EVIDENCE_PATH} mangler tracked["${BRAND_DOMAIN}"]/okRuns for «${q.question}» — nekter å regne ut en overskrift fra hull.`,
        );
      }
      return { q: q.question, linked, runs, held: linked === 0 || linked === runs };
    })
    .sort((a: MeasureRow, b: MeasureRow) => b.linked / b.runs - a.linked / a.runs);

  if (rows.length === 0) {
    throw new Error(`[metode-measurements] 0 spørsmål i ${EVIDENCE_PATH} — tom inngang, ikke en ren måling.`);
  }

  const heldCount = rows.filter((r) => r.held).length;
  const variedCount = rows.length - heldCount;

  // Rådataene bak aggregatet. Vi teller til stede = nevnt i svarteksten ELLER
  // lenket, fordi det er skillet Rettinger-avsnittet handler om: Komplett
  // bestred «usynlig for AI», og de hadde delvis rett — de nevnes, men lenken
  // går et annet sted.
  let answersOk = 0;
  let answersPresent = 0;
  let answersLinked = 0;
  const perRunLinked: number[] = [];
  const dayLabels = new Set<string>();
  const months = new Set<number>();
  /** spørsmål → dagsetikett → { lenket, kjøringer } */
  const byDay = new Map<string, Map<string, { linked: number; runs: number }>>();

  for (const rel of evidence.sourceFiles as string[]) {
    const raw = JSON.parse(readFileSync(`/workspace/${rel}`, "utf8"));
    for (const run of raw.runs) {
      let runLinked = 0;
      const d = new Date(run.measuredAt);
      const day = `${d.getUTCDate()}.`;
      for (const r of run.results) {
        if (r.error || !r.answer) continue; // feilet kjøring teller ikke som fravær
        answersOk++;
        const linked = (r.citations ?? []).some((c: any) => /komplett\.no/i.test(c.url ?? ""));
        const mentioned = /Komplett/.test(r.answer);
        if (linked) {
          answersLinked++;
          runLinked++;
        }
        if (linked || mentioned) answersPresent++;
        const perQ = byDay.get(r.question) ?? new Map();
        const cell = perQ.get(day) ?? { linked: 0, runs: 0 };
        cell.runs++;
        if (linked) cell.linked++;
        perQ.set(day, cell);
        byDay.set(r.question, perQ);
      }
      perRunLinked.push(runLinked);
      dayLabels.add(day);
      months.add(d.getUTCMonth());
    }
  }

  if (answersOk === 0 || perRunLinked.length === 0) {
    throw new Error(
      `[metode-measurements] leste 0 svar fra sourceFiles (${(evidence.sourceFiles ?? []).join(", ")}) — instrumentet er brukket, ikke målingen ren.`,
    );
  }
  if (perRunLinked.length !== evidence.runs) {
    throw new Error(
      `[metode-measurements] aggregatet sier ${evidence.runs} kjøringer, rådataene ga ${perRunLinked.length}.`,
    );
  }

  const days = [...dayLabels].sort((a, b) => parseInt(a) - parseInt(b));
  if (months.size !== 1) {
    throw new Error(`[metode-measurements] kjøringene spenner over ${months.size} måneder — dagsetikettene under forutsetter én.`);
  }
  const month = MONTH_NB[[...months][0]];

  // Nullet som ikke holdt. Kandidatene er de varierte spørsmålene med minst én
  // helt null dag OG minst én dag med treff; vi velger det svakeste, fordi det
  // er der «et nullresultat» faktisk ble påstått.
  const zeroThatBroke = rows
    .filter((r) => !r.held)
    .sort((a, b) => a.linked / a.runs - b.linked / b.runs)
    .map((r) => {
      const cells = [...(byDay.get(r.q) ?? new Map())].sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
      const zero = cells.filter(([, c]) => c.linked === 0);
      const hit = cells.filter(([, c]) => c.linked > 0);
      if (zero.length === 0 || hit.length === 0) return null;
      return {
        q: r.q,
        zeroRuns: zero.reduce((n, [, c]) => n + c.runs, 0),
        zeroDayLabel: joinDays(zero.map(([d]) => d), month),
        hitRuns: hit.reduce((n, [, c]) => n + c.runs, 0),
        hitLinked: hit.reduce((n, [, c]) => n + c.linked, 0),
        hitDayLabel: joinDays(hit.map(([d]) => d), month),
      };
    })
    .find((x) => x !== null);

  if (!zeroThatBroke) {
    throw new Error(
      "[metode-measurements] ingen null-dag som ble brutt av en annen dag — avsnittet «også nullene svinger» har ikke lenger dekning i dataene og må skrives om.",
    );
  }

  return {
    zeroThatBroke,
    rows,
    heldCount,
    variedCount,
    headline: `${cap(numWord(heldCount))} av ${numWord(rows.length)} svar holdt. ${cap(numWord(variedCount))} svingte.`,
    totalRuns: evidence.runs,
    runDayLabel: joinDays(days, month),
    answersOk,
    answersPresent,
    answersLinked,
    perRunMin: Math.min(...perRunLinked),
    perRunMax: Math.max(...perRunLinked),
  };
}
