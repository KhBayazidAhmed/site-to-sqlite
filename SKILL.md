---
name: site-to-sqlite
description: Token-efficient web reconnaissance, pattern discovery, and polite SQLite scraper powered by Bun. Discovers site structure, sitemaps, JSON-LD, and Next.js hydration payloads, synthesizes lightweight extraction rules, and crawls web data into structured SQLite databases without bloating the LLM context window. Use when asked to crawl, scrape, extract, or archive website data into SQLite or CSV/JSON.
---

# Site-to-SQLite Web Reconnaissance & Extraction Engine

Perform token-efficient, high-speed website reconnaissance and polite data extraction into local SQLite databases using the pre-bundled Bun scripts.

## Golden Rules
1. **Never dump full HTML into LLM context**: Use `scripts/recon.ts` to discover patterns and `scripts/scrape.ts` to crawl and extract data directly on the user's machine.
2. **Be polite to target servers**: Keep default concurrency between 2–5 workers with 150–300ms jitter delay. Never hammer target endpoints with abusive bursts.
3. **Always inspect and verify**: After extraction, run `scripts/inspect-db.ts` to verify row counts, schema correctness, and present clear summary metrics to the user.

---

## Tool Reference

The skill scripts are located at `~/.gemini/antigravity/skills/site-to-sqlite/scripts/`:

| Script | Purpose | Command Example |
|---|---|---|
| [`recon.ts`](./scripts/recon.ts) | Site overview, sitemap crawler, framework & structured data detector | `bun run ~/.gemini/antigravity/skills/site-to-sqlite/scripts/recon.ts <URL>` |
| [`scrape.ts`](./scripts/scrape.ts) | High-speed crawler engine with `bun:sqlite`, checkpoint/resume, auto-schema evolution | `bun run ~/.gemini/antigravity/skills/site-to-sqlite/scripts/scrape.ts --config <config.json> --db <output.sqlite>` |
| [`inspect-db.ts`](./scripts/inspect-db.ts) | SQLite database inspector, schema summary, and JSON/CSV exporter | `bun run ~/.gemini/antigravity/skills/site-to-sqlite/scripts/inspect-db.ts -d <output.sqlite> --exportCsv <output.csv>` |

---

## 4-Phase Scraping Workflow

### Phase 1: Reconnaissance & Site Discovery
Run the reconnaissance script against the target URL to discover `robots.txt`, sitemaps, framework payloads, and URL patterns:

```bash
bun run ~/.gemini/antigravity/skills/site-to-sqlite/scripts/recon.ts "https://example.com"
```

Analyze the output:
- **Sitemap URLs**: Look at URL path clusters (e.g. `/products/*`, `/blog/*`, `/articles/*`).
- **Structured Data**: Check if JSON-LD (`application/ld+json`) or `__NEXT_DATA__` is present.
- **Feeds**: Check for RSS/Atom feeds for instant data access.

Read [recon-guide.md](./references/recon-guide.md) for detailed fast-path discovery techniques.

---

### Phase 2: Formulate Extraction Configuration
Based on the recon findings, create a declarative JSON configuration file (e.g., in the workspace or scratch folder).

See [extraction-patterns.md](./references/extraction-patterns.md) for full config syntax.

Example `config.json`:
```json
{
  "tableName": "articles",
  "startUrls": ["https://example.com/blog"],
  "itemSelector": ".post-card",
  "fields": {
    "title": "h2.title",
    "url": {
      "selector": "h2.title a",
      "attribute": "href"
    },
    "author": ".author-name",
    "published_date": "time@datetime",
    "snippet": ".excerpt"
  },
  "pagination": {
    "nextPageSelector": "a.pagination-next"
  },
  "options": {
    "concurrency": 3,
    "delayMs": 200,
    "maxPagesTotal": 100
  }
}
```

---

### Phase 3: Execute Headless Scraping
Run the polite crawler engine. It handles rate-limiting, retries with exponential backoff on 429/503, checkpointing, and dynamic SQLite column creation:

```bash
bun run ~/.gemini/antigravity/skills/site-to-sqlite/scripts/scrape.ts \
  --config /path/to/config.json \
  --db /path/to/output.sqlite
```

> [!TIP]
> If a crawl is interrupted, re-running the exact same command will automatically skip all URLs that were already successfully crawled with HTTP 200 in the `crawled_urls` table.

---

### Phase 4: Validate Database & Present Results
Inspect the generated SQLite database to verify data integrity and extract summary metrics:

```bash
bun run ~/.gemini/antigravity/skills/site-to-sqlite/scripts/inspect-db.ts \
  -d /path/to/output.sqlite \
  --exportCsv /path/to/output.csv
```

Report to the user:
- Total URLs crawled & skipped
- Total structured records extracted
- Summary of tables and column definitions
- Location of the `.sqlite` file and exported `.csv` / `.json` files.
