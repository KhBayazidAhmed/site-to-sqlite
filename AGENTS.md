# AGENTS.md — Universal Agent Runbook for `site-to-sqlite`

This document defines the standard operating guidelines for any autonomous AI coding agent (e.g., Google Antigravity, Claude Code, OpenAI Operator/Codex, Cursor, Windsurf, Devin) working with this repository.

---

## Primary Directive

When tasked with web crawling, scraping, or extracting data from any website:
1. **NEVER load full raw HTML pages into the LLM context window.** This wastes tokens and risks context truncation.
2. **Always follow the 2-Step Workflow**:
   - **Step 1**: Run `site-to-sqlite discover <url>` to inspect the site, discover extractable repeating entities, tables, and fields, and formulate a proposal for user confirmation.
   - **Step 2**: After confirming with the user, run `site-to-sqlite scrape --config <config.json> --db <data.sqlite>` to crawl into SQLite.
3. Store structured outputs directly into SQLite databases (`.sqlite` / `.db`).

---

## 2-Step Operating Procedure

### Step 1: Deep Inspection, Data Discovery & User Confirmation
Inspect the target website to discover repeating cards, items, HTML tables, JSON-LD schemas, Next.js hydration props, pagination links, and candidate fields:

```bash
bun run bin/site-to-sqlite.ts discover "<TARGET_URL>" -o config.json
```

Or via MCP: call `site_discover({ url: "<TARGET_URL>" })`.

**Present findings to the user:**
1. List the discovered candidate entities (e.g. products, articles, quotes, tables).
2. Show the detected fields (e.g. `title`, `price`, `url`, `image`, `tags`, `author`, `published_date`).
3. Show live sample previews and confidence scores.
4. **Ask the user for confirmation**: "Here is the candidate schema discovered from `<TARGET_URL>`. Would you like to proceed with scraping these fields, or should we add/modify any selectors?"

---

### Step 2: Headless Scraping & Database Validation
Once the user confirms or provides adjustments, execute the scrape engine:

```bash
bun run bin/site-to-sqlite.ts scrape --config ./config.json --db ./data.sqlite
```

Or via MCP: call `site_scrape({ config: <CONFIG_OBJECT>, dbPath: "./data.sqlite" })`.

The engine automatically handles:
- `@attribute` shorthand selectors (`"a@href"`, `"time@datetime"`, `"img@src"`)
- Auto-attribute deduction (`img` -> `src`, `a` -> `href`, `time` -> `datetime`)
- Array field extraction (`array: true` -> JSON string in SQLite)
- Detail-page follow crawling (`detailPage: { ... }`)
- WAL-mode SQLite writes & dynamic schema evolution (`ALTER TABLE ADD COLUMN`)
- Rate-limiting jitter & exponential backoff on HTTP 429/5xx
- Checkpoint/resume tracking in `crawled_urls`

---

### Validation & Export
Inspect the database to verify that data was properly saved, check row counts, and export to CSV or JSON:

```bash
bun run bin/site-to-sqlite.ts inspect ./data.sqlite --exportCsv ./data.csv
```

---

## MCP Server Integration

For MCP-capable environments (Claude Desktop, Cursor, Zed, Antigravity):

```bash
bun run bin/site-to-sqlite.ts mcp
```

### Available MCP Tools:
- `site_discover`: [Step 1] Deep DOM inspection, repeating candidate discovery, field selector synthesis, and sample previews.
- `site_recon`: Network reconnaissance (sitemaps, robots.txt, JSON-LD, feeds).
- `site_scrape`: [Step 2] High-speed polite scraping into SQLite.
- `site_inspect_db`: Inspect schemas, row counts, sample data, and export CSV/JSON.
