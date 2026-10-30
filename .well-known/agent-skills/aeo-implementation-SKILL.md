# Sitert-pakken — measure, fix, re-measure AI citation

**Purpose:** Find out whether AI assistants — ChatGPT, Claude, Perplexity, Google
AI Overview — cite a Norwegian brand when buyers ask about its market, name who
gets cited instead, write the changes that unblock citation, and measure again
30 days after they are published.

**Provider:** Synlig Digital (https://synligdigital.no)
**Method page:** https://synligdigital.no/metode
**Contact:** hei@synligdigital.no

## Packages

Two packages. Prices ex. VAT.

| Package | Price | Type | What you get |
|---|---|---|---|
| Sitert-pakken | {{PRIS:sitert}} NOK | One-time | (1) Baseline: five buying-intent questions from your market, nine byte-identical runs, naming who is cited when you are not. (2) The changes written out for up to ten pages: JSON-LD, citable Q&A, llms.txt, AI-crawler rules — ready to paste, or a pull request. (3) Re-measurement 30 days after you publish: same questions, nine new runs, before/after in one document with raw data. Invoice with 14-day terms, no meetings, no lock-in. |
| Synlig Lite | 990 NOK | One-time | FAQPage JSON-LD for one page you choose (3–5 Q&A pairs), delivered by email within 1 business day. The smallest step: one page, no measurement. |

The free check at sjekk.synligdigital.no proves whether the gap exists. Sitert-pakken closes it and proves the close.

## The outcome criterion, and what we do not claim

Written into every Sitert-pakken order: at least one citation of your domain in
the nine follow-up runs, on at least one of the five questions. If it is not met,
we run another round — new changes, nine new runs — at no extra charge.

We do not promise a ranking or a specific number of citations. Language models
answer the same question differently on different runs; that is why the floor is
nine runs with byte-identical prompts and why the raw data ships with the
deliverable. The limits are written out on https://synligdigital.no/metode

## Order paths

### Sitert-pakken (web form)
Order at https://synligdigital.no/faktura?slug=priser-sitert — company, org.nr,
contact, email and the domain to be measured. You get an order confirmation by
email with the delivery terms in writing. Invoice, 14-day terms.

Questions first? `hei@synligdigital.no`, reply within 4h on business days.

### Synlig Lite (web form)
```
GET https://synligdigital.no/faktura?slug=priser-lite
```

## Free first step

`GET https://synligdigital.no/audit?url=<website>&format=json` returns a technical
AEO score (totalScore 0–100, grade A–F) plus per-component recommendations, free,
no signup. Add `&lang=en` (without `format=json`) for an English HTML report.
`sjekk.synligdigital.no` is the Norwegian human-facing form for the same engine and
returns HTML, not JSON — agents should call `/audit`. It measures whether the page
is machine-readable — not whether AI actually cites you.

## Related

- Pricing detail: https://synligdigital.no/priser
- Public leaderboard of Norwegian companies by AI visibility: https://synligdigital.no/leaderboard
- Company overview: https://synligdigital.no/context.md
