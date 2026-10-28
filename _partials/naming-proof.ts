/**
 * NAVNGIVINGSBEVISET — én kilde for tallene + en port som finner enhver flate
 * som henger igjen med et gammelt (2026-08-14: 28/28 sto håndskrevet på seks
 * flater koplet bare av kommentarer — «collapse to ONE source + gate»).
 *
 * TO BEVIS, ulik status (2026-10-27, Håkon 10-26: Perplexity er 0,9 % av
 * assistent-trafikken):
 *  - ENGINE_PANEL = OVERSKRIFTEN. Avledet ved import fra rådata
 *    (data/engine-panel-2026-10-27.json, tools/engine-panel/measure.ts):
 *    ingen sifre skrevet for hånd. Kjøpsreisens tre flater MÅ bære
 *    ENGINE_HEADLINE ordrett (eller importere den).
 *  - NAMING_PROOF = HISTORISK rad (Perplexity 14.8.2026). Telt for hånd
 *    («Synlig» uten etternavn teller, 2 av 28 — en vurdering, ikke parsing),
 *    valgfri, men der den står gjelder invariantene:
 *   1. «X av 28» i et navngivings-vindu er 28 eller 20.
 *   2. «28 av Y» har Y = 28.
 *   3. Et vindu uten kanonisk hovedpar («28 av 28»/«28/28») er et avvik.
 *   4. Gulv: tomt filsett eller uleselig fil = FEIL, ikke «ingen avvik».
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SITE_DIR = "/workspace/synlig-site";

/**
 * TELT 2026-08-14 av publiseringsøkta, fra fire byte-identiske Perplexity-
 * (Sonar-)kjøringer × sju norske kjøpsintent-spørsmål = 28 svar.
 * Primærkilder: tools/peer-field/readings/2026-08-14-notext.json,
 * -notext-rep2.json, -notext-rep3.json, 2026-08-14-rep3-withtext.json.
 * Siteringen (7/7 spørsmål med lenke i hver lagrede kjøring, også 2026-08-07)
 * er en ANNEN påstand med et annet spenn — bland dem aldri.
 */
export const NAMING_PROOF = {
  /** Svar der Synlig Digital står navngitt i selve svarteksten. */
  named: 28,
  /** Totalt antall svar (4 kjøringer × 7 spørsmål). */
  total: 28,
  /** Nest mest navngitte norske aktør (Mementor/Wud/WeAssist). */
  runnerUp: 20,
  /** Av de navngitte: fullt navn vs. «Synlig» med synligdigital.no som kilde. */
  fullName: 26,
  shortName: 2,
  engine: "Perplexity (Sonar)",
  questions: 7,
  runs: 4,
  measuredAt: "2026-08-14",
  docPath: "/tjenester#navngitt",
  /**
   * OBLIGATORISK FORBEHOLD. Tallet reiser aldri uten denne setningen — den er
   * grunnen til at påstanden er ærlig og ikke bare flatterende.
   */
  caveat: "Blant kildene Perplexity siterer er våre egne publiserte sider.",
} as const;


/**
 * MOTORPANELET 2026-10-27: sju spørsmål × tre kjøringer × tre motorer med
 * leverandørens eget websøk via API — IKKE forbrukerappene. Tallene telles her
 * fra rådata med samme ordgrense-nål som målingen («Synlig Digital», aldri
 * «synlig», som treffer «synlighet»).
 */
const PANEL_ROWS: Array<{ engine: string; run: number; q: string; text: string; error?: string }> =
  JSON.parse(readFileSync(join(SITE_DIR, "data/engine-panel-2026-10-27.json"), "utf-8"));
const ENGINE_NAMES: Record<string, string> = { gpt: "OpenAIs GPT", claude: "Claude", gemini: "Gemini" };
const named = (e: string, re: RegExp) =>
  PANEL_ROWS.filter((r) => r.engine === e && !r.error && re.test(r.text)).length;
export const ENGINE_PANEL = (() => {
  const total = PANEL_ROWS.filter((r) => r.engine === "gpt" && !r.error).length;
  const engines = ["gpt", "claude", "gemini"].map((e) => ({
    key: e,
    name: ENGINE_NAMES[e],
    total: PANEL_ROWS.filter((r) => r.engine === e && !r.error).length,
    us: named(e, /\bSynlig\s+Digital\b/i),
    mementor: named(e, /\bMementor\b/),
  }));
  // Gulv: et panel uten svar er en blind kilde, ikke et null-resultat.
  if (total < 21 || engines.some((x) => x.total !== total)) {
    throw new Error(`ENGINE_PANEL: ufullstendig panel (${engines.map((x) => x.total).join("/")})`);
  }
  return { total, engines, measuredAt: "27.10.2026", runs: 3, questions: 7 };
})();
const [gpt, claude, gemini] = ENGINE_PANEL.engines;
// Setningen under påstår en sammenligning; holder den ikke lenger, skal bygget
// stoppe og noen skrive den om — ikke rendre en usann komparativ.
if (!(gemini.mementor > gemini.us && claude.mementor > claude.us)) {
  throw new Error("ENGINE_HEADLINE: «Mementor nevnt oftere» holder ikke lenger i rådata — skriv om setningen");
}
const mem = gemini.mementor === claude.mementor
  ? `${gemini.mementor} av ${gemini.total} hos begge`
  : `${gemini.mementor} og ${claude.mementor} av ${gemini.total}`;
export const ENGINE_HEADLINE =
  `${gpt.name} navngir Synlig Digital i ${gpt.us} av ${gpt.total} svar, ${claude.name} i ${claude.us} og ${gemini.name} i ${gemini.us}. ` +
  `Hos ${gemini.name} og ${claude.name} er Mementor nevnt oftere enn oss (${mem}).`;
/** Per spørsmål: hvor mange av tre kjøringer hver motor navnga oss. */
export const ENGINE_ROWS = [...new Set(PANEL_ROWS.map((r) => r.q))].map((q) => ({
  q,
  counts: ENGINE_PANEL.engines.map((e) => ({
    name: e.name,
    n: PANEL_ROWS.filter((r) => r.q === q && r.engine === e.key && /\bSynlig\s+Digital\b/i.test(r.text)).length,
    of: PANEL_ROWS.filter((r) => r.q === q && r.engine === e.key && !r.error).length,
  })),
}));
/**
 * Skiltet i forsidens hero (Vegvisning 2026-10-28): første spørsmål, per motor
 * de seks første unike vertene kjøring 1 siterte, og navngitt-tellingen. Alt
 * telles her fra rådata — aldri håndskrevet i markupen.
 */
export const ENGINE_SIGN = (() => {
  const q = ENGINE_ROWS[0].q;
  const rows = PANEL_ROWS.filter((r) => r.q === q) as Array<(typeof PANEL_ROWS)[number] & { at?: string; cites?: string[] }>;
  const engines = ENGINE_PANEL.engines.map((e, i) => {
    const run1 = rows.find((r) => r.engine === e.key && r.run === 1 && !r.error);
    const hosts = [...new Set((run1?.cites ?? []).map((u) => new URL(u).hostname.replace(/^www\./, "")))].slice(0, 6);
    if (hosts.length < 3) throw new Error(`ENGINE_SIGN: ${e.key} kjøring 1 har ${hosts.length} kilder`);
    return { ...ENGINE_ROWS[0].counts[i], name: e.name.replace("OpenAIs ", ""), hosts };
  });
  const ats = rows.map((r) => r.at).filter(Boolean).sort() as string[];
  const hm = (iso: string) => iso.slice(11, 16).replace(":", ".");
  return { q, engines, window: `${hm(ats[0])}–${hm(ats[ats.length - 1])} UTC` };
})();
export const ENGINE_CAVEAT =
  "Målt via leverandørenes API med eget websøk, ikke i forbrukerappene. Tre kjøringer samme kveld. Sidene motorene oftest siterer om oss er våre egne.";

/** Filer kjøpsreisen går gjennom. Mister én av dem motorpanelet, feiler bygget. */
const REQUIRED_CLAIM_FILES = [
  join(SITE_DIR, "src/pages/index.astro"),
  join(SITE_DIR, "priser.html"),
  join(SITE_DIR, "tjenester/index.html"),
];

/**
 * HVA SOM ER EN PÅSTAND OM BEVISET — målt mot korpuset FØR porten ble skrevet,
 * fordi et deteksjonsmønster er en hypotese til det er talt (CLAUDE.md 08-12:
 * en «defekt» flertallet har, er base rate).
 *
 * Første forsøk ankret bare på ordet «navngi*». Det traff 208 av 305 filer —
 * altså vanlig prosa («robots.txt navngir ingen AI-agent» på /leaderboard),
 * ikke vår påstand. Krav om «Perplexity» i samme vindu tok det til 189, med
 * ÉN gjenværende falsk positiv: leaderboard.html, der begge ordene finnes i
 * en AI-crawler-liste. Tredje ledd, «Synlig» i samme vindu, gir 188 av 305
 * treffsider og NULL uten kanonisk hovedpar. Porten er altså målt til 0 falske
 * positive på den faktiske trafikken, ikke bare på fikstursene jeg fant på.
 */
const WINDOW = 200;
const NAMING_ANCHOR = /navngi(?:r|tt|tte|ving|vingen)/gi;
const CO_REQUIRED = [/perplexity/i, /synlig/i];
/**
 * Kilden kan ikke gafle seg fra seg selv, og doc-kommentaren her siterer
 * delsummene (26 + 2 av 28) som porten ellers ville lest som avvik.
 */
const SELF = join(SITE_DIR, "_partials/naming-proof.ts");
/** «28 av 28», «28/28», «20 av 28» — begge skrivemåtene vi faktisk publiserer. */
const PAIR = /(\d{1,3})\s*(?:av|\/)\s*(\d{1,3})\b/g;

export type NamingViolation = { file: string; claim: string; why: string };
export type NamingGateResult = {
  scanned: number;
  claimFiles: number;
  violations: NamingViolation[];
};

function scopeFiles(): string[] {
  const out: string[] = [];
  const dirs: Array<[string, RegExp]> = [
    [SITE_DIR, /\.(html|astro|md|txt|ts)$/],
    [join(SITE_DIR, "tjenester"), /\.html$/],
    [join(SITE_DIR, "rapport"), /\.html$/],
    [join(SITE_DIR, "reports"), /\.html$/],
    [join(SITE_DIR, "_partials"), /\.ts$/],
    [join(SITE_DIR, "src/pages"), /\.astro$/],
    [join(SITE_DIR, "src/content/blogg"), /\.html$/],
    [join(SITE_DIR, "src/content/case"), /\.html$/],
  ];
  for (const [dir, re] of dirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && re.test(d.name))
        .map((d) => d.name);
    } catch {
      entries = [];
    }
    for (const f of entries) out.push(join(dir, f));
  }
  return out;
}

/** Ren funksjon, testbar med syntetisk innhold — begge armer. */
export function checkNamingText(text: string): { windows: number; violations: string[] } {
  const violations: string[] = [];
  const windows: string[] = [];
  NAMING_ANCHOR.lastIndex = 0;
  for (let m = NAMING_ANCHOR.exec(text); m; m = NAMING_ANCHOR.exec(text)) {
    const w = text.slice(Math.max(0, m.index - WINDOW), m.index + WINDOW);
    if (CO_REQUIRED.every((re) => re.test(w))) windows.push(w);
  }
  if (windows.length === 0) return { windows: 0, violations };

  const { named, total, runnerUp } = NAMING_PROOF;
  const canonical = new RegExp(`\\b${named}\\s*(?:av|\\/)\\s*${total}\\b`);
  let sawCanonical = canonical.test(text);
  /**
   * AVLEDEDE FLATER (2026-08-14). En fil som interpolerer NAMING_PROOF skriver
   * ingen sifre selv og KAN ikke gafle seg — å kreve et litteralt hovedpar der
   * ville vært baklengs: porten ville tvunget fram nøyaktig den hardkodingen
   * den finnes for å fjerne. Men unntaket er smalt med vilje: det gjelder bare
   * hvis fila ikke har ETT eneste litteralt tallpar i vinduet. Har den det, er
   * den delvis hardkodet, og da gjelder invariant 3 fullt ut — ellers ville
   * «30 av 30» i en avledet fil sluppet gjennom alle tre invariantene.
   */
  const derivesFromSource = /NAMING_PROOF/.test(text);
  let sawAnyPair = false;

  for (const win of windows) {
    PAIR.lastIndex = 0;
    for (let p = PAIR.exec(win); p; p = PAIR.exec(win)) {
      const a = Number(p[1]);
      const b = Number(p[2]);
      sawAnyPair = true;
      // Invariant 1: nevneren er totalen ⇒ telleren er 28 eller 20.
      if (b === total && a !== named && a !== runnerUp) {
        violations.push(`«${p[0]}» — ${a} av ${total} er verken ${named} eller ${runnerUp}`);
      }
      // Invariant 2: telleren er 28 ⇒ nevneren er totalen.
      if (a === named && b !== total) {
        violations.push(`«${p[0]}» — ${named} av ${b}, totalen er ${total}`);
      }
    }
  }
  // Invariant 3: et vindu uten kanonisk hovedpar kan ha fått BEGGE tall byttet.
  if (!sawCanonical && !(derivesFromSource && !sawAnyPair)) {
    violations.push(
      `navngivings-påstand uten kanonisk hovedpar («${named} av ${total}» / «${named}/${total}»)`
    );
  }
  return { windows: windows.length, violations };
}

export function runNamingProofGate(): NamingGateResult {
  const files = scopeFiles();
  const violations: NamingViolation[] = [];
  // Invariant 5, del 1: tomt omfang er en blind port, ikke en ren port.
  if (files.length < 200) {
    violations.push({
      file: SITE_DIR,
      claim: `${files.length} filer i omfanget`,
      why: "omfanget kollapset — en port over tomt filsett er falsk-ren per konstruksjon",
    });
    return { scanned: files.length, claimFiles: 0, violations };
  }
  let claimFiles = 0;
  const seen = new Set<string>();
  for (const p of files) {
    if (p === SELF) continue;
    let text = "";
    try {
      text = readFileSync(p, "utf-8");
    } catch {
      // Invariant 5, del 2: en uleselig fil er en feil, ikke en fil uten avvik.
      violations.push({ file: p, claim: "", why: "uleselig fil i omfanget" });
      continue;
    }
    const r = checkNamingText(text);
    if (r.windows === 0) continue;
    claimFiles++;
    seen.add(p);
    // Dedup per fil: overlappende vinduer rundt «navngir»/«navngitte» leser det
    // SAMME tallparet flere ganger, og tre identiske linjer om ett avvik gjør
    // feilmeldingen verre, ikke bedre.
    for (const v of new Set(r.violations)) {
      violations.push({ file: p, claim: v, why: "tallet har gaflet seg fra NAMING_PROOF" });
    }
  }
  // Kjøpsreisens tre flater må bære motorpanelet ordrett eller importere det.
  for (const req of REQUIRED_CLAIM_FILES) {
    const t = existsSync(req) ? readFileSync(req, "utf-8") : "";
    if (!t.includes(ENGINE_HEADLINE) && !/import\s*\{[^}]*\bENGINE_HEADLINE\b[^}]*\}\s*from/.test(t)) {
      violations.push({ file: req, claim: ENGINE_HEADLINE, why: "obligatorisk flate mangler motorpanelet (eller har en gammel versjon)" });
    }
  }
  return { scanned: files.length, claimFiles, violations };
}
