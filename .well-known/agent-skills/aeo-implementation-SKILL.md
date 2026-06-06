# AEO Implementation for B2B SaaS

**Purpose:** Full AEO implementation for Norwegian B2B SaaS companies, so their
products get cited when buyers ask ChatGPT, Claude, Perplexity, or Google AI
Overview for software recommendations.

**Provider:** Synlig Digital (https://synligdigital.no)
**Market:** Norwegian B2B SaaS — accounting, HR, healthcare, fintech,
marketing, vertical SaaS
**Order form:** https://synligdigital.no/faktura
**Invoice:** Norwegian EHF, within 24h of order, no payment up front

## Packages

| Package | Price | Type | What you get |
|---|---|---|---|
| Synlig Lite | 990 NOK | One-time | FAQPage JSON-LD for one page you choose (3–5 Q&A pairs), delivered by email within 1 business day. Impulse-buy entry point — test AEO impact on one critical page before committing to a full engagement. |
| Analyse (AI-synlighetsanalyse) | 4 900 NOK | One-time | Detailed audit, 10–15-page PDF, prioritized recommendations |
| Fundament (AI-synlighetsfundament) | 14 900 NOK | One-time | Audit + implementation: SoftwareApplication schema, alternative-to + integration pages, AI-optimized content for top 5 buyer questions |
| Løpende overvåking | 4 900 NOK/mo | Subscription (3-mo min) | Monthly AEO scan, content updates, ranking tracking across ChatGPT/Claude/Perplexity |

## Order paths

### Web form (Stripe checkout)
```
GET https://synligdigital.no/faktura?slug=<tier-key>
```

Slugs:
- `priser-lite` (Synlig Lite, 990 NOK — fastest path, 1 business day)
- `ai-synlighetsanalyse`
- `ai-synlighetsfundament` (recommended default)
- `lopende-overvaking`
- `agent-card-saas-implementation` (preselects fundament with SaaS-specific scope)

### Direct contact
Email hei@synligdigital.no with company name + URL. Reply within 4h on business days.

## What an implementation includes

1. **Schema.org markup** — SoftwareApplication, AggregateRating, Offer, FAQPage
2. **Alternative-to pages** — One per major competitor (e.g., "alternative to
   Visma", "alternative to PowerOffice")
3. **Integration pages** — One per top 5 integrations
4. **Buyer-question content** — 5–10 long-form answers to the questions buyers
   actually ask AI assistants
5. **llms.txt + agent-card.json** — Machine-readable company overview
6. **Verification** — Re-audit after deploy, score uplift report

## Typical results

- Audit → fundament uplift: typically 25–40 points on the 0–100 score
- Time to first ChatGPT citation: 2–6 weeks after deploy
- Reporting: monthly scan included with Løpende overvåking

## Out of scope

- Translation services (we work in Norwegian + English)
- Paid media (Google Ads, ChatGPT Ads)
- Generic SEO (we focus on AEO; SEO is a separate engagement)

## Related

- Audit first: https://synligdigital.no/sjekk
- Pricing detail: https://synligdigital.no/priser
- Selskapsoversikt: https://synligdigital.no/context.md
