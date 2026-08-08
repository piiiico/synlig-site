/**
 * Homepage JSON-LD — the machine layer.
 *
 * This is the product, not decoration: Synlig is the most-cited host in its
 * own category in Norway (12 of 15 question-runs, N=3 measurement 2026-08-08,
 * money/aeo/synlig-aeo-norge-3runs-2026-08-08.json). The redesign ports it
 * node-for-node; a prettier page that dropped it would trade the one thing
 * that works for looks.
 *
 * 2026-08-08 (fase 2) — the ONLY content change in the port, and the reason
 * the task existed: the OfferCatalog advertised a price ladder we had already
 * abandoned that morning (990 / 4 900 / 14 900 / 4 900 per mnd) on measured
 * zeros. Every crawler was being told about a dead self-serve funnel while the
 * visible hero sold a 9 900 kr sitert-måling.
 *
 * Now: one paid flagship Offer (Sitert-måling, 9 900 NOK) + Synlig Lite (990)
 * kept as the demoted lowest orderable entry point + the free sjekk.
 * 4 900 / 14 900 / løpende still exist on /priser — they are simply no longer
 * what the front page claims to sell.
 */

export const ORG_ID = "https://synligdigital.no/#organization";

// ── Block 1: Organization / LocalBusiness / MarketingAgency ───────────────
const organization = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "MarketingAgency", "ProfessionalService"],
  "@id": ORG_ID,
  name: "Synlig Digital",
  alternateName: ["Synlig", "Synlig AEO", "Synlig Answer Engine Optimization"],
  legalName: "Synlig Digital",
  description:
    "Synlig Digital måler om AI-assistenter siterer norske merkevarer. Vi kjører fem kjøpsnære spørsmål fra kundens marked minst ni ganger over flere dager mot ChatGPT, Perplexity og Google AI Overview, og dokumenterer hvem som blir sitert i stedet. Vi leverer også Answer Engine Optimization (AEO): strukturerte data, Google Business Profile-optimalisering, aggregator-registrering og AI-tilpasset innhold.",
  url: "https://synligdigital.no",
  logo: "https://synligdigital.no/og-2026-08.png",
  image: "https://synligdigital.no/og-2026-08.png",
  email: "hei@synligdigital.no",
  foundingDate: "2026",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Stavanger sentrum",
    postalCode: "4006",
    addressLocality: "Stavanger",
    addressRegion: "Rogaland",
    addressCountry: "NO",
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: "58.9700",
    longitude: "5.7331",
  },
  areaServed: { "@type": "Country", name: "Norway" },
  serviceArea: { "@type": "Country", name: "Norway" },
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    opens: "09:00",
    closes: "17:00",
  },
  contactPoint: {
    "@type": "ContactPoint",
    email: "hei@synligdigital.no",
    contactType: "customer service",
    areaServed: "NO",
    availableLanguage: ["Norwegian", "English"],
  },
  knowsAbout: [
    "Answer Engine Optimization",
    "AEO",
    "AI-synlighet",
    "AI synlighet norske bedrifter",
    "Sitert-måling",
    "Schema.org markup",
    "Google Business Profile optimalisering",
    "Lokal SEO",
    "Strukturerte data",
    "ChatGPT synlighet",
    "Perplexity synlighet",
    "Google AI Overview",
    "llms.txt",
    "Norsk aggregator-registrering",
  ],
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "AEO-tjenester for norske bedrifter",
    itemListElement: [
      {
        "@type": "Offer",
        name: "AI-synlighetssjekk",
        description:
          "Gratis analyse av bedriftens synlighet i AI-assistenter. Se hvordan ChatGPT og Perplexity finner — eller ikke finner — bedriften din.",
        price: "0",
        priceCurrency: "NOK",
        url: "https://sjekk.synligdigital.no",
        itemOffered: {
          "@type": "Service",
          name: "Gratis AI-synlighetssjekk",
          serviceType: "AEO Audit",
          provider: { "@id": ORG_ID },
        },
      },
      {
        "@type": "Offer",
        name: "Sitert-måling",
        description:
          "Vi måler om AI-svar siterer merkevaren din. Fem kjøpsnære spørsmål fra ditt marked, stilt minst ni ganger over flere dager mot flere modeller, med navn på hvem som blir sitert i stedet for dere. Skriftlig leveranse på e-post, faktura med 14 dagers frist, ingen møter.",
        price: "9900",
        priceCurrency: "NOK",
        url: "https://synligdigital.no/#tjenester",
        availability: "https://schema.org/InStock",
        itemOffered: {
          "@type": "Service",
          name: "Sitert-måling av AI-svar",
          serviceType: "AI Citation Measurement",
          provider: { "@id": ORG_ID },
        },
      },
      {
        "@type": "Offer",
        name: "Synlig Lite — FAQPage AEO",
        description:
          "FAQPage schema for én side du velger. Vi skriver 3–5 spørsmål-svar-par grunnet i innholdet ditt og leverer JSON-LD klar til innliming i <head>. Levering innen 1 virkedag på e-post.",
        price: "990",
        priceCurrency: "NOK",
        url: "https://synligdigital.no/priser",
        itemOffered: {
          "@type": "Service",
          name: "FAQPage Schema Implementering",
          serviceType: "AEO Schema Implementering",
          provider: { "@id": ORG_ID },
        },
      },
    ],
  },
  priceRange: "990–9900 NOK",
  review: [],
  employee: {
    "@type": "Person",
    name: "Håkon Åmdal",
    jobTitle: "Daglig leder og AEO-spesialist",
    url: "https://synligdigital.no",
    email: "hei@synligdigital.no",
    knowsAbout: [
      "Answer Engine Optimization",
      "AI-synlighet",
      "Schema.org",
      "Norsk digitalt landskap",
    ],
  },
  sameAs: [
    "https://sjekk.synligdigital.no",
    "https://synligdigital.no/blogg/aeo-byra-norge",
    "https://smithery.ai/server/@pico/aeo-mcp",
    "https://synligdigital.no/guide",
  ],
  potentialAction: [
    {
      "@type": "SearchAction",
      name: "Sjekk AI-synlighet gratis",
      description:
        "Gratis AI-synlighetsanalyse — se korleis ChatGPT og Perplexity finn bedriften din",
      target: {
        "@type": "EntryPoint",
        urlTemplate: "https://sjekk.synligdigital.no/?url={url}",
        actionPlatform: [
          "http://schema.org/DesktopWebPlatform",
          "http://schema.org/MobileWebPlatform",
        ],
        httpMethod: "GET",
      },
      "query-input": "required name=url",
    },
  ],
};

// ── Block 2: WebSite ──────────────────────────────────────────────────────
const website = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://synligdigital.no/#website",
  name: "Synlig Digital",
  url: "https://synligdigital.no",
  description:
    "Vi måler om AI-svar siterer merkevaren din. Norges mest siterte AEO-vert.",
  inLanguage: "nb",
  publisher: { "@id": ORG_ID },
};

// ── Block 3: FAQPage (8 spørsmål) ─────────────────────────────────────────
const faqPage = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://synligdigital.no/#faq",
  mainEntity: [
    {
      "@type": "Question",
      name: "Hva er Answer Engine Optimization (AEO)?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AEO (Answer Engine Optimization) er optimalisering av en bedrifts digitale tilstedeværelse slik at AI-assistenter som ChatGPT, Perplexity og Google AI Overview finner, forstår og anbefaler bedriften. Det inkluderer schema.org-markup, Google Business Profile, aggregator-registrering, innholdsoptimalisering og anmeldelsesstrategi. Målet er å bli det svaret AI gir — ikke bare å rangere på Google.",
      },
    },
    {
      "@type": "Question",
      name: "Hva er forskjellen mellom AEO og SEO?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "SEO (Search Engine Optimization) handler om å rangere blant ti blå lenker på Google. AEO handler om å bli det ene svaret AI gir. AI-assistenter leser nettsiden annerledes enn Google: de trenger strukturerte data (schema.org), tydelige entiteter (hvem, hva, hvor) og innhold som direkte svarer på spørsmål. Mange bedrifter med god SEO scorer F på AEO fordi de mangler maskinlesbar informasjon.",
      },
    },
    {
      "@type": "Question",
      name: "Hvem er Synlig Digital og hva gjør dere?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Synlig Digital er et AEO-selskap i Stavanger. Hovedleveransen er sitert-måling (9 900 NOK): vi kjører fem kjøpsnære spørsmål fra kundens marked minst ni ganger over flere dager og dokumenterer om AI-svarene siterer merkevaren — og hvem som blir sitert i stedet. Kundene er primært B2B SaaS direkte og merkevareportefølje / e-handel via byråpartnerar med 70/30 co-delivery-split. Mindre bedrifter kan bestille Synlig Lite — FAQPage AEO (990 NOK) selvbetjent, eller kjøre en gratis AI-synlighetssjekk på sjekk.synligdigital.no.",
      },
    },
    {
      "@type": "Question",
      name: "Hvilke bedrifter har mest å vinne på AEO?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "To segmenter primært. (1) Norske B2B SaaS — regnskaps-SaaS, HR-SaaS, fintech, marketing-SaaS — direkte. AI-assistenter er det første kjøparen spør når de vurderer ny SaaS ('beste norske regnskaps-SaaS for byrå'), og ChatGPT-trafikk konverterte 9× bedre enn Google organisk (15,9% vs 1,76%, Seer Interactive 2025). (2) Merkevareportefølje og e-handel — sportsutstyr, lifestyle, retail — typisk levert via byråpartnerar med 70/30 co-delivery-split. Felles for begge: snittscore er 43–55 av 100 på AI-synlighet og maskinlesbare signal (schema.org, FAQPage, alternative-to- eller Product-data, llms.txt) manglar hos 80%+ av bedriftene vi har skannet.",
      },
    },
    {
      "@type": "Question",
      name: "Har Synlig Digital dokumenterte resultater?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Ja, dokumentert som metode-case. Nordic Lithium gikk fra AEO-score 67/C til 85/A på to uker etter implementering av schema.org, Google Business Profile og fjerning av AI-crawler-blokkering — uten plattformbytte. Pierstop gikk fra 52/D til 76/B på samme prosess. Begge er nærstående part (Nordic Lithium: felles eierskap; Pierstop: co-styremedlem i AS Åmdal Invest, vederlagsfri levering) — dokumentert med metode og før/etter på /case/nordic-lithium og /case/pierstop, ikke arm's-length kundereferanser. Første arm's-length kundecase er under arbeid.",
      },
    },
    {
      "@type": "Question",
      name: "Hva koster AEO-tjenester fra Synlig Digital?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Sitert-måling koster fra 9 900 NOK eks. mva (engangsbetaling, faktura med 14 dagers frist, levering på e-post uten møter). Synlig Lite — FAQPage AEO koster 990 NOK (engangsbetaling, levering innen 1 virkedag) og er det laveste bestillbare inngangspunktet. AI-synlighetssjekken på sjekk.synligdigital.no er gratis. Kontakt hei@synligdigital.no for tilbud.",
      },
    },
    {
      "@type": "Question",
      name: "Hvor lang tid tar det å se resultater fra AEO?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "De fleste bedrifter ser første forbedringer innen 4–8 uker etter implementering av schema.org, Google Business Profile og aggregator-registrering. Dokumentert eksempel (nærstående metode-case): Nordic Lithium gikk fra 67/C til 85/A på to uker. AI-svar oppdateres hyppigere enn Google-ranking, og aggregator-registrering kan gi resultater innen 2–3 uker.",
      },
    },
    {
      "@type": "Question",
      name: "Hva er de viktigste AEO-signalene for norske bedrifter?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Basert på dokumentert AEO-audit av 30+ norske bedrifter på tvers av 9 bransjer (Norges AEO-leaderboard, mai 2026): 1) Schema.org-markup (SoftwareApplication for SaaS, FAQPage, Service, Organization), 2) Alternative-to- og integrasjonslister (kva andre SaaS vi erstattar eller integrerar mot), 3) Navngitte individer med sertifiseringer, 4) Direkte svar-innhold under H2/H3-overskrifter som matchar kjøpar-spørsmål, 5) Tydelig vertikal- og bruksområde-posisjonering (kven er produktet for).",
      },
    },
  ],
};

// ── Block 4: BreadcrumbList ───────────────────────────────────────────────
const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Synlig Digital",
      item: "https://synligdigital.no",
    },
  ],
};

// ── Block 5: WebPage + Speakable ──────────────────────────────────────────
const webPage = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": "https://synligdigital.no/#webpage",
  url: "https://synligdigital.no",
  name: "Synlig Digital — blir merkevaren din sitert når AI svarer?",
  description:
    "Synlig Digital måler om AI-assistenter siterer merkevaren din, og hvem som blir sitert i stedet. Fem kjøpsnære spørsmål, minst ni kjøringer, fra 9 900 kr.",
  inLanguage: "nb",
  isPartOf: { "@id": "https://synligdigital.no/#website" },
  about: { "@id": ORG_ID },
  speakable: {
    "@type": "SpeakableSpecification",
    cssSelector: [
      "h1",
      "h2",
      ".hero-sub",
      ".service-desc",
      ".case-intro",
      ".case-quote",
    ],
  },
  citation: [
    {
      "@type": "WebSite",
      name: "Schema.org — Strukturerte data-standard",
      url: "https://schema.org",
    },
    {
      "@type": "WebSite",
      name: "Google Search Central — Strukturerte data-dokumentasjon",
      url: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    },
  ],
};

// ── Block 6: Case Studies ItemList ────────────────────────────────────────
const caseStudies = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  "@id": "https://synligdigital.no/#case-studies",
  name: "Dokumenterte AEO-resultater — Synlig Digital",
  description:
    "Dokumenterte case studies som viser effekten av Answer Engine Optimization for norske bedrifter.",
  numberOfItems: 2,
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      item: {
        "@type": "Article",
        "@id": "https://synligdigital.no/case/nordic-lithium",
        headline:
          "Nordic Lithium: Fra 67/C til 85/A på to uker — nærstående metode-case",
        url: "https://synligdigital.no/case/nordic-lithium",
        description:
          "Nordic Lithium (nærstående part — felles eierskap med Synlig) gikk fra AEO-score 67/C til 85/A på to uker etter intern implementering av schema.org, Google Business Profile og fjerning av AI-crawler-blokkering — uten plattformbytte. Eierskapsopplysning på /case/nordic-lithium.",
        datePublished: "2026-03",
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
        about: {
          "@type": "Thing",
          name: "Answer Engine Optimization",
          description: "AEO-implementering for norsk bedrift i gruvesektoren",
        },
      },
    },
    {
      "@type": "ListItem",
      position: 2,
      item: {
        "@type": "Article",
        "@id": "https://synligdigital.no/case/pierstop",
        headline:
          "Pierstop: Fra 52/D til 76/B — nærstående metode-case (cruisehavn-guide)",
        url: "https://synligdigital.no/case/pierstop",
        description:
          "Pierstop (nærstående part — co-styremedlem AS Åmdal Invest, vederlagsfri levering) økte AEO-score med 24 poeng etter schema.org-sprint. Dokumentert metode-case: perfekt teknisk infrastruktur, manglende schema-signaler. Eierskapsopplysning på /case/pierstop.",
        datePublished: "2026-03-16",
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
        about: {
          "@type": "Thing",
          name: "Answer Engine Optimization",
          description: "AEO-implementering for norsk reiselivsaktør",
        },
      },
    },
  ],
};

// ── Block 7: HowTo — AEO-prosessen ────────────────────────────────────────
const howTo = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  "@id": "https://synligdigital.no/#howto-aeo",
  name: "Slik blir norske bedrifter synlige i ChatGPT og Perplexity",
  description:
    "Synlig Digitals AEO-prosess for å øke AI-synlighet for norske bedrifter — B2B SaaS direkte og merkevareportefølje / e-handel via byråpartnerar (70/30 co-delivery). Basert på dokumentert AEO-audit av 30+ norske bedrifter (Norges AEO-leaderboard).",
  totalTime: "P14D",
  estimatedCost: {
    "@type": "MonetaryAmount",
    currency: "NOK",
    value: "9900",
  },
  step: [
    {
      "@type": "HowToStep",
      position: 1,
      name: "Gratis AI-synlighetssjekk",
      text: "Sjekk bedriftens nåværende AEO-score på sjekk.synligdigital.no. Se nøyaktig hva AI-assistenter vet — og ikke vet — om bedriften din.",
      url: "https://sjekk.synligdigital.no",
    },
    {
      "@type": "HowToStep",
      position: 2,
      name: "Sitert-måling: måler om AI faktisk lenker til deg",
      text: "Fem kjøpsnære spørsmål fra ditt marked, stilt minst ni ganger over flere dager mot flere modeller. Du får dokumentert hvor ofte merkevaren siteres, hvem som siteres i stedet, og hvilke kilder AI-svarene henter fra. En AEO-score sier hva siden har på plass; sitert-målingen sier om det virker.",
      url: "https://synligdigital.no/#tjenester",
    },
    {
      "@type": "HowToStep",
      position: 3,
      name: "Implementering av AEO-tiltak",
      text: "Implementering av schema.org-markup tilpassa vertikalen: SoftwareApplication for SaaS (med alternative-to- og integrasjonslister); Product, Brand og Organization for merkevarer og e-handel (med ProductCollection, AggregateRating der relevant). FAQPage og Service for begge. Optimalisering av Google Business Profile og relevante aggregatorar: G2/Capterra for SaaS, finansportalen.no for fintech, byrabasen.no for byrå-portefølje.",
      url: "https://synligdigital.no",
    },
    {
      "@type": "HowToStep",
      position: 4,
      name: "Løpende overvåking og optimalisering",
      text: "Månedlig måling av AI-synlighet: sjekk hvor mange ganger bedriften nevnes i AI-svar. Løpende tilpasning til nye AI-modeller og oppdateringer.",
      url: "https://synligdigital.no",
    },
  ],
};

export const HOMEPAGE_JSONLD = [
  organization,
  website,
  faqPage,
  breadcrumb,
  webPage,
  caseStudies,
  howTo,
];
