---
name: site-to-sqlite
description: Universal token-efficient web reconnaissance, pattern discovery, and polite SQLite scraper powered by Bun for Antigravity, Claude, Cursor, and any AI agent. Discovers site structure, sitemaps, JSON-LD, and Next.js hydration payloads, synthesizes lightweight extraction rules, and crawls web data into structured SQLite databases without bloating the LLM context window. Use when asked to crawl, scrape, extract, or archive website data into SQLite or CSV/JSON.
---

# Site-to-SQLite Universal Web Reconnaissance & Extraction Engine

Perform token-efficient, high-speed website reconnaissance and polite data extraction into local SQLite databases using the pre-bundled Bun scripts.

## Golden Rules
1. **Never dump full HTML into LLM context**: Use `recon` to discover patterns and `scrape` to crawl and extract data directly on the machine.
2. **Be polite to target servers**: Keep default concurrency between 2–5 workers with 150–300ms jitter delay. Never hammer target endpoints with abusive bursts.
3. **Always inspect and verify**: After extraction, run `inspect` to verify row counts, schema correctness, and present clear summary metrics.

---

## Tool & CLI Reference

| Command | Purpose | Example |
|---|---|---|
| `site-to-sqlite recon` | Site overview, sitemap crawler, framework & structured data detector | `bun run bin/site-to-sqlite.ts recon "https://example.com"` |
| `site-to-sqlite scrape` | High-speed crawler engine with `bun:sqlite`, checkpoint/resume, auto-schema evolution | `bun run bin/site-to-sqlite.ts scrape --config <config.json> --db <output.sqlite>` |
| `site-to-sqlite inspect` | SQLite database inspector, schema summary, and JSON/CSV exporter | `bun run bin/site-to-sqlite.ts inspect <output.sqlite> --exportCsv <output.csv>` |
| `site-to-sqlite mcp` | Model Context Protocol (MCP) server for Claude Desktop, Cursor, and Zed | `bun run bin/site-to-sqlite.ts mcp` |

---

## 4-Phase Scraping Workflow

### Phase 1: Reconnaissance & Site Discovery
Run the reconnaissance command against the target URL:

```bash
bun run bin/site-to-sqlite.ts recon "https://example.com"
```

Analyze the output:
- **Sitemap URLs**: Look at URL path clusters (e.g. `/products/*`, `/blog/*`, `/articles/*`).
- **Structured Data**: Check if JSON-LD (`application/ld+json`) or `__NEXT_DATA__` is present.
- **Feeds**: Check for RSS/Atom feeds for instant data access.

Read [recon-guide.md](./references/recon-guide.md) for detailed fast-path discovery techniques.

---

### Phase 2: Formulate Extraction Configuration
Based on recon findings, create a declarative JSON configuration file.

See [extraction-patterns.md](./references/extraction-patterns.md) for full config syntax.

Example `config.json`:
```json
{
  "tableName": "articles",
  "startUrls": ["https://example.com/blog"],
  "itemSelector": ".post-card",
  "fields": {
    "title": "h2.title",
    "url": { "selector": "h2.title a", "attribute": "href" },
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
bun run bin/site-to-sqlite.ts scrape --config /path/to/config.json --db /path/to/output.sqlite
```

> [!TIP]
> If a crawl is interrupted, re-running the exact same command will automatically skip all URLs that were already successfully crawled with HTTP 200 in the `crawled_urls` table.

---

### Phase 4: Validate Database & Present Results
Inspect the generated SQLite database to verify data integrity and extract summary metrics:

```bash
bun run bin/site-to-sqlite.ts inspect /path/to/output.sqlite --exportCsv /path/to/output.csv
```

Report to the user:
- Total URLs crawled & skipped
- Total structured records extracted
- Summary of tables and column definitions
- Location of the `.sqlite` file and exported `.csv` / `.json` files.
