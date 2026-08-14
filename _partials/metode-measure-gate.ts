/**
 * PÅSTAND-MOT-PRIMÆRKILDE-PORT for måletabellen på /metode.
 *
 * Hvorfor (2026-08-12, tredje gang samme klasse): /metode publiserte
 * overskriften «To av fem svar holdt. Tre svingte.» rett over sin egen tabell
 * der TRE rader sto merket «Holdt i hver eneste kjøring» og TO «Varierte».
 * Overskriften var invertert mot tabellen under seg, mot rådataene, og mot vår
 * egen publiserte setning på /leaderboard. De to foregående gangene var
 * 2026-08-06 (case-sidens title/H1/lead sto igjen med den tilbaketrukne
 * februar-påstanden) og 2026-08-06/07 («sitert i 3 av 5», et ett-utvalgs
 * artefakt, sitert to ganger eksternt). Prosa har vært prøvd tre ganger.
 *
 * Porten leser de SERVERTE bytene — ikke src/, ikke modulen som genererte dem —
 * og regner tallene om igjen fra primærkilden. Den fanger derfor tre ting
 * modulen alene ikke fanger: en håndredigert dist/worker-fil, et bygg som ikke
 * ble kjørt før deploy, og et hardkodet tall som sniker seg inn igjen.
 *
 * INVARIANTER (ingen av dem pinner en målt verdi — en ny måling er fri til å
 * endre hvert eneste siffer):
 *   1. Hver «Lenket i X av Y»-rad matcher tracked[komplett.no]/okRuns i JSON,
 *      matchet på spørsmålsteksten.
 *   2. Hver rads etikett («Holdt i hver eneste kjøring» / «Varierte mellom
 *      kjøringene») matcher regelen X === 0 || X === Y.
 *   3. Antall rader merket «Holdt» matcher tallordet i overskriften over dem,
 *      og antall «Varierte» matcher det andre tallordet.
 *   4. Radsettet er komplett: like mange rader som spørsmål i JSON.
 * GULV: 0 rader, manglende overskrift eller uparsebart tallord = FEIL, ikke
 * «ingen avvik funnet». En port som er grønn på tom inngang er blind.
 */
import { loadMetodeMeasurements, numWord } from "./metode-measurements";

export type MetodeGateResult = { rows: number; violations: string[] };

const NUM_WORD_TO_INT: Record<string, number> = {
  null: 0, ett: 1, én: 1, en: 1, to: 2, tre: 3, fire: 4,
  fem: 5, seks: 6, sju: 7, syv: 7, åtte: 8, ni: 9,
};

const HELD_LABEL = "Holdt i hver eneste kjøring";
const VARIED_LABEL = "Varierte mellom kjøringene";

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * @param html  De serverte bytene for /metode (dist-fila eller worker-strengen).
 * @param label Hvilken flate dette er — havner i feilmeldingen.
 */
export function runMetodeMeasureGate(input: string, label: string): MetodeGateResult {
  const violations: string[] = [];
  const push = (v: string) => violations.push(`${label}: ${v}`);

  const M = loadMetodeMeasurements();
  const expected = new Map(M.rows.map((r) => [r.q, r]));

  // ── Avgrens til bevisseksjonen ────────────────────────────────────────────
  // .measure-row brukes også av forsiden, med et HELT annet datasett («Sitert
  // med lenke i 3 av 3» for vår egen merkevare). Kjøres porten på worker.ts —
  // som er alle sidene i én streng — matcher den forsidens rader og rapporterer
  // støy. Derfor er #stokastisk-seksjonen porten sitt eneste arbeidsområde, og
  // et manglende anker er FEIL: da er /metode ikke i bytene den fikk.
  const start = input.indexOf('id="stokastisk"');
  if (start < 0) {
    push(
      `fant ikke seksjonen id="stokastisk" i ${input.length} tegn — /metode er ikke i disse bytene, ` +
        `eller ankeret er endret. Porten har ingenting å avstemme.`,
    );
    return { rows: 0, violations };
  }
  const end = input.indexOf("</section>", start);
  const html = input.slice(start, end < 0 ? input.length : end);

  // ── Radene ────────────────────────────────────────────────────────────────
  const rowRe =
    /<li class="measure-row[^"]*">([\s\S]*?)<\/li>/g;
  const rows: { q: string; linked: number; runs: number; label: string }[] = [];
  for (const m of html.matchAll(rowRe)) {
    const block = m[1];
    const q = decode(block.match(/class="measure-q"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "")
      .replace(/^«|»$/g, "");
    const verdict = decode(block.match(/class="measure-verdict"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
    const others = decode(block.match(/class="measure-others"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
    const cnt = verdict.match(/Lenket i (\d+) av (\d+)/);
    if (!q || !cnt) {
      push(`måletabell-rad uten spørsmål eller «Lenket i X av Y»: «${decode(block).slice(0, 90)}»`);
      continue;
    }
    rows.push({ q, linked: Number(cnt[1]), runs: Number(cnt[2]), label: others });
  }

  // GULV 1: tom inngang er en brukket port, ikke en ren side.
  if (rows.length === 0) {
    push(
      `0 .measure-row funnet i de serverte bytene (${html.length} tegn). Porten er blind — ` +
        `enten er markupen endret, eller /metode ble ikke bygget.`,
    );
    return { rows: 0, violations };
  }
  if (rows.length !== M.rows.length) {
    push(`${rows.length} rader servert, ${M.rows.length} spørsmål i primærkilden.`);
  }

  for (const r of rows) {
    const src = expected.get(r.q);
    if (!src) {
      push(`raden «${r.q}» finnes ikke i primærkilden (${M.rows.map((x) => x.q).join(" | ")}).`);
      continue;
    }
    if (r.linked !== src.linked || r.runs !== src.runs) {
      push(
        `«${r.q}»: siden sier «Lenket i ${r.linked} av ${r.runs}», primærkilden sier ${src.linked} av ${src.runs}.`,
      );
    }
    const wantLabel = src.held ? HELD_LABEL : VARIED_LABEL;
    if (r.label !== wantLabel) {
      push(`«${r.q}»: merket «${r.label}», men ${src.linked} av ${src.runs} betyr «${wantLabel}».`);
    }
  }

  // ── Overskriften over tabellen ────────────────────────────────────────────
  const tableAt = html.indexOf('class="measure-rows');
  const head = html.slice(0, tableAt < 0 ? html.length : tableAt);
  const h2 = decode([...head.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].at(-1)?.[1] ?? "");
  // GULV 2: uten overskrift har porten ingenting å avstemme mot.
  if (!h2) {
    push("fant ingen <h2> over måletabellen — kan ikke avstemme «holdt»-tellingen.");
    return { rows: rows.length, violations };
  }
  const words = h2.toLowerCase().match(/^(\S+) av (\S+) svar holdt\. (\S+) svingte\./);
  if (!words) {
    push(
      `overskriften «${h2}» har ikke formen «<tallord> av <tallord> svar holdt. <tallord> svingte.» — ` +
        `porten kan ikke lese tellingen ut av den.`,
    );
    return { rows: rows.length, violations };
  }
  const [, heldW, totalW, variedW] = words;
  const parse = (w: string, what: string) => {
    const n = NUM_WORD_TO_INT[w];
    if (n === undefined) push(`overskriften: «${w}» (${what}) er ikke et tallord porten kjenner.`);
    return n;
  };
  const heldSaid = parse(heldW, "holdt");
  const totalSaid = parse(totalW, "totalt");
  const variedSaid = parse(variedW, "svingte");

  const heldRows = rows.filter((r) => r.label === HELD_LABEL).length;
  const variedRows = rows.filter((r) => r.label === VARIED_LABEL).length;

  if (heldSaid !== undefined && heldSaid !== heldRows) {
    push(`overskriften sier ${heldW} holdt (${heldSaid}), tabellen under har ${heldRows} rader merket «${HELD_LABEL}».`);
  }
  if (variedSaid !== undefined && variedSaid !== variedRows) {
    push(`overskriften sier ${variedW} svingte (${variedSaid}), tabellen under har ${variedRows} rader merket «${VARIED_LABEL}».`);
  }
  if (totalSaid !== undefined && totalSaid !== rows.length) {
    push(`overskriften sier «av ${totalW}» (${totalSaid}), tabellen har ${rows.length} rader.`);
  }
  if (heldSaid !== undefined && heldSaid !== M.heldCount) {
    push(
      `overskriften sier ${heldW} holdt, primærkilden gir ${M.heldCount} (${numWord(M.heldCount)}). ` +
        `Regelen er: lenket i alle kjøringer, eller i ingen.`,
    );
  }

  return { rows: rows.length, violations };
}
