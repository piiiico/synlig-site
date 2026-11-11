# Free AEO Audit

**Purpose:** Score any website's Answer Engine Optimization (AEO) — how visible it
is when buyers ask ChatGPT, Claude, Perplexity, or Google AI Overview for product
or service recommendations.

**Provider:** Synlig Digital (https://synligdigital.no)
**License:** Free, no signup required
**Tuned for:** Norwegian B2B SaaS, but works on any URL

## How to call

### HTTPS

```
GET https://synligdigital.no/audit?url=<website>&format=json
```

Returns JSON (verified 2026-08-13 against stripe.com):

```json
{
  "url": "https://stripe.com",
  "finalUrl": "https://stripe.com/fr",
  "timestamp": "2026-08-13",
  "totalScore": 60,      // 0–100
  "maxScore": 100,
  "grade": "C",          // A–F
  "schema":          { "score": 8,  "recommendations": ["..."] },
  "meta":            { "score": 13, "recommendations": [] },
  "content":         { "score": 16, "recommendations": ["..."] },
  "technical":       { "score": 15, "recommendations": ["..."] },
  "aiSignals":       { "score": 8,  "recommendations": ["..."] },
  "agentVisibility": { "score": 8,  "recommendations": ["..."] },
  "diagnosis":       { "businessTypeLabel": "...", "topIssues": [], "quickWins": [] }
}
```

Recommendations are grouped per component, not in one top-level array, and their
text is Norwegian. Omit `format=json` for an HTML report; add `&lang=en` for an
English HTML report with the recommendations translated.

`sjekk.synligdigital.no` is the Norwegian human-facing form for the same engine.
It returns an HTML page, not JSON — agents should call `/audit` directly.

### MCP (recommended for agents)

Connect to the streamable-HTTP server, then call the `analyze_aeo` tool:

```
POST https://aeo-mcp-server.amdal-dev.workers.dev/mcp
```

```json
{ "name": "analyze_aeo", "arguments": { "url": "https://example.com" } }
```

## What it checks

- Robots.txt + AI-bot directives (GPTBot, ClaudeBot, PerplexityBot, etc.)
- Structured data (JSON-LD / schema.org) — Organization, Service, SoftwareApplication
- llms.txt presence and content
- A2A agent-card.json
- MCP endpoint
- Meta description, canonical URLs, OpenGraph
- For Norwegian B2B SaaS: SoftwareApplication markup, "alternative-to" pages,
  integration pages, AI-optimized buyer-question content

## Scoring

- A (90–100): Agent-native — visible across all major AI assistants
- B (75–89): Strong — minor gaps
- C (60–74): Partial — some surfaces missing
- D (40–59): Weak — significant work needed
- F (0–39): Invisible — fundamental issues

## Output guarantees

- Deterministic: same input URL → same score within a 24h window
- Source-of-truth: all checks performed live against the URL, no cached data
- Privacy: URL is logged for rate limiting; no PII collected

## Next steps after an audit

- Fix top 3 high-priority items first — they typically account for 60–80%
  of the score gap.
- For implementation help: see the `aeo-implementation` skill, or order
  directly at https://synligdigital.no/faktura?slug=ai-synlighetsfundament

## Related

- A2A Agent Card: https://synligdigital.no/.well-known/agent-card.json
- MCP Server Card: https://synligdigital.no/.well-known/mcp.json
- Skills index: https://synligdigital.no/.well-known/agent-skills/index.json
