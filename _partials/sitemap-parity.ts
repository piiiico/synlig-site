/**
 * ÉN PARITETSHJELPER for de tre registrene som uttrykker samme invariant:
 * «en side som er live SKAL stå i katalogene svarmotorene leser — og en side
 * som er avpublisert skal IKKE stå der».
 *
 * HVORFOR DENNE FILA FINNES (2026-08-15): build.ts hadde tre separate
 * sitemap-drift-porter (VERTICAL_LANDINGS, blogFileMap, EN_PAGES), hver skrevet
 * for hånd, hver med sin egen matching. Workeren som bygde den tredje navnga
 * selv zoom-uten og lot den ligge: «tre separate sitemap-drift-porter som alle
 * uttrykker samme invariant — kandidat for én generisk paritetshjelper».
 *
 * Og det var nettopp den tredje som BEVISLIG var falsk-grønn: den brukte
 * includes() på rå URL, og «https://synligdigital.no/en/» er delstreng av hver
 * eneste andre engelske URL. Fjernet du rot-linja fra llms.txt, meldte porten
 * alt-i-orden. Den KORTESTE URL-en i et sett er alltid den som stille blir
 * grønn — derfor er mentionsUrl() grensebundet, og derfor er /en/ den negative
 * armen i testen, aldri en tilfeldig rad.
 *
 * Før kollapsen ble den strenge <loc>-formen målt mot dagens sitemap for alle
 * tre registrene (9 verticals, 36 blogginnlegg, 8 EN-sider): null divergens mot
 * den løsere matchingen de brukte. Kollapsen endrer altså ingen oppførsel — den
 * fjerner tre steder en framtidig rad kan gaffle seg fra.
 */

/**
 * Er URL-en NEVNT som egen adresse — ikke bare som prefiks av en lengre?
 * includes() er falsk-grønn for hver URL som er prefiks av en annen i settet.
 */
export function mentionsUrl(text: string, url: string): boolean {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Grensetegn inkluderer > slik at <loc>URL</loc> og <a href=…> også teller.
  return new RegExp(escaped + "(?=[\\s)\\]<>,]|$)", "m").test(text);
}

export type ParityEntry = {
  /** Full kanonisk URL. */
  url: string;
  /** Skal den stå i sitemap? false = avpublisert/de-promotert, og da er nærvær feilen. */
  listed?: boolean;
  /** Menneskelig navn i feilmeldingen. */
  name?: string;
};

/**
 * GULV FØRST: et tomt register eller en sitemap uten <urlset> er en ØDELAGT
 * leser, ikke en ren flate. Uten gulvet sertifiserer porten hva som helst i det
 * øyeblikket en parser eller en filsti ryker.
 */
export function sitemapParity(opts: {
  label: string;
  sitemap: string;
  entries: ParityEntry[];
  /** Minste antall rader registeret kan ha før porten regnes som blind. */
  minEntries: number;
  /** Hva mennesket skal gjøre. Legges under avvikene. */
  remedy?: string;
}): string[] {
  const { label, sitemap, entries, minEntries } = opts;
  const v: string[] = [];

  if (!sitemap.includes("<urlset")) {
    return [`${label}: GULV — sitemap mangler <urlset> (${sitemap.length} byte). Porten leser noe annet enn en sitemap.`];
  }
  if (entries.length < minEntries) {
    return [
      `${label}: GULV — registeret har ${entries.length} rader, gulvet er ${minEntries}. ` +
        `Et krympet register fjerner sider fra sitemap uten å si fra, og gjør porten grønn mens det skjer.`,
    ];
  }

  for (const e of entries) {
    const name = e.name ?? e.url;
    const shouldBeListed = e.listed !== false;
    // Streng <loc>-form: en URL som bare er PREFIKS av en annen teller ikke.
    const n = sitemap.split(`<loc>${e.url}</loc>`).length - 1;
    if (shouldBeListed && n === 0) {
      v.push(`${label}: "${name}" er live, men mangler i sitemap.xml (${e.url}).`);
    }
    if (!shouldBeListed && n > 0) {
      v.push(
        `${label}: "${name}" er de-promotert, men står fortsatt i sitemap.xml (${e.url}). ` +
          `De-promoterte sider holdes live for resttrafikk, men skal ikke annonseres til søkemotorer.`,
      );
    }
    // Dobbeltoppføring: en håndholdt <loc> som lever ved siden av den genererte.
    if (n > 1) {
      v.push(`${label}: "${name}" står ${n} ganger i sitemap.xml — en håndholdt oppføring lever ved siden av den genererte.`);
    }
  }
  return v;
}

export type EnPageRef = { path: string; aliases: string[] };

/**
 * EN-FLATENS PARITET — ruter, llms.txt, sitemap og lenkene fra /en/, målt mot
 * de SERVERTE bytene (den genererte workeren), ikke mot filene på disk. En port
 * som leser kilden sertifiserer noe ingen serverer.
 */
export function enSurfaceParity(opts: {
  worker: string;
  llms: string;
  sitemap: string;
  enBody: string;
  pages: EnPageRef[];
  origin?: string;
  minLlmsBytes?: number;
  minPages?: number;
}): string[] {
  const {
    worker, llms, sitemap, enBody, pages,
    origin = "https://synligdigital.no",
    minLlmsBytes = 8000,
    minPages = 4, // EN prune 2026-10-31: 8 → 4
  } = opts;
  const v: string[] = [];

  if (pages.length < minPages) {
    return [`EN_PAGES har ${pages.length} rader, gulvet er ${minPages} — en krympet tabell gjør alle konsumentene blinde i stedet for røde.`];
  }

  const routePaths = new Set(pages.flatMap(p => [p.path, ...p.aliases]));
  // «/en» fulgt av slutt, «/» eller «.» — så /en.html teller, men /energi ikke.
  const shipped = new Set(
    [...worker.matchAll(/^  "(\/en(?:[\/.][^"]*)?)": \{ body:/gm)].map(m => m[1]),
  );

  // Gulv: finner regexen ingenting, er porten blind — ikke grønn.
  if (shipped.size < routePaths.size) {
    v.push(`workeren serverer ${shipped.size} /en/-ruter, EN_PAGES definerer ${routePaths.size} — parseren fant for få (gulv).`);
  }
  for (const r of shipped) {
    if (!routePaths.has(r)) v.push(`ruten ${r} finnes i workeren, men ikke i EN_PAGES — legg til en rad der, ikke en linje i routes.`);
  }
  for (const r of routePaths) {
    if (!shipped.has(r)) v.push(`EN_PAGES lover ruten ${r}, men workeren serverer den ikke.`);
  }

  if (llms.length < minLlmsBytes) {
    v.push(`servert llms.txt er ${llms.length} byte — under gulvet (${minLlmsBytes}), porten leser en avkortet fil.`);
  }
  for (const p of pages) {
    if (!mentionsUrl(llms, `${origin}${p.path}`)) {
      v.push(`${p.path} mangler i llms.txt (fila svarmotorene leser først).`);
    }
  }

  v.push(
    ...sitemapParity({
      label: "EN_PAGES",
      sitemap,
      entries: pages.map(p => ({ url: `${origin}${p.path}`, name: p.path })),
      minEntries: minPages,
    }),
  );

  // /en/ må ha vei videre inn i sitt eget innhold.
  for (const p of pages.filter(p => p.path.startsWith("/en/blog"))) {
    if (!enBody.includes(`href="${p.path}"`)) {
      v.push(`/en/ lenker ikke til ${p.path} — den engelske bloggen er foreldreløs fra sin egen språkrot.`);
    }
  }
  return v;
}
