# AGENTS.md — Universal Agent Runbook for `site-to-sqlite`

This document defines the standard operating guidelines for any autonomous AI coding agent (e.g., OpenAI Operator/Codex, Cursor, Windsurf, Antigravity, Devin) working with this repository.

---

## Primary Directive

When tasked with web crawling, scraping, or extracting data from a website:
1. **NEVER load full raw HTML pages into the LLM context window.** This wastes tokens and risks context truncation.
2. **Always delegate extraction and crawling to local Bun scripts** (`site-to-sqlite recon`, `site-to-sqlite scrape`, `site-to-sqlite inspect`).
3. Store structured outputs directly into SQLite databases (`.sqlite` / `.db`).

---

## 4-Phase Operating Procedure

### Phase 1: Reconnaissance
Probe the target website to discover sitemaps, robots rules, and fast-path structured data:

```bash
bun run bin/site-to-sqlite.ts recon "<TARGET_URL>"
```

- If `__NEXT_DATA__` or Schema.org `application/ld+json` is detected, use the fast-path extraction strategy.
- Note URL path clusters from sitemaps to plan the crawl scope.

### Phase 2: Formulate Extraction Configuration
Write a declarative JSON config file (e.g. `config.json`) defining the target table and field selectors:

```json
{
  "tableName": "articles",
  "startUrls": ["https://example.com/blog"],
  "itemSelector": ".card",
  "fields": {
    "title": "h2.title",
    "url": { "selector": "a.link", "attribute": "href" },
    "author": ".author",
    "published_date": "time@datetime"
  },
  "pagination": {
    "nextPageSelector": "a.next"
  },
  "options": {
    "concurrency": 3,
    "delayMs": 200,
    "maxPagesTotal": 100
  }
}
```

### Phase 3: Execute Headless Crawl
Run the scraper. The engine automatically handles WAL-mode SQLite writes, checkpointing, retries with exponential backoff on HTTP 429/5xx, and dynamic table column additions:

```bash
bun run bin/site-to-sqlite.ts scrape --config ./config.json --db ./data.sqlite
```

### Phase 4: Validate Database & Export
Inspect the database to verify that data was properly saved, check row counts, and optionally export to CSV or JSON:

```bash
bun run bin/site-to-sqlite.ts inspect ./data.sqlite --exportCsv ./data.csv
```

---

## MCP Server Integration

If running in an MCP-capable environment (Cursor, Claude Desktop, Zed, etc.), the MCP server can be launched directly:

```bash
bun run bin/site-to-sqlite.ts mcp
```

### Available MCP Tools:
- `site_recon`: Deep website reconnaissance (sitemaps, robots, JSON-LD, Next.js props).
- `site_scrape`: High-speed polite scraping into SQLite.
- `site_inspect_db`: Inspect schemas, row counts, sample data, and export CSV/JSON.
