---
name: site-to-sqlite
description: Universal token-efficient web reconnaissance, pattern discovery, and polite SQLite scraper powered by Bun for Antigravity, Claude, Cursor, and any AI agent. Discovers site structure, sitemaps, JSON-LD, and Next.js hydration payloads, synthesizes lightweight extraction rules, and crawls web data into structured SQLite databases without bloating the LLM context window. Use when asked to crawl, scrape, extract, or archive website data into SQLite or CSV/JSON.
---

# Site-to-SQLite Universal Web Reconnaissance & Extraction Engine

Perform token-efficient, high-speed website inspection, candidate data discovery, and polite extraction into local SQLite databases using pre-bundled Bun scripts.

## Golden Rules
1. **Never dump full HTML into LLM context**: Use `discover` to identify patterns and fields, and `scrape` to crawl and extract data directly on the machine.
2. **Follow the 2-Step Workflow**:
   - **Step 1 (Inspect & Propose)**: Inspect the target URL, discover repeating items/tables/fields, generate a candidate proposal with sample data previews, and request user confirmation.
   - **Step 2 (Execute Scrape)**: Scrape into SQLite based on the confirmed configuration, inspect data counts, and export to CSV/JSON if requested.
3. **Be polite to target servers**: Keep default concurrency between 2–5 workers with 150–300ms jitter delay. Never hammer target endpoints with abusive bursts.

---

## Tool & CLI Reference

| Command | Purpose | Example |
|---|---|---|
| `site-to-sqlite discover` | [Step 1] Deep DOM inspection, repeating candidate discovery, field selector synthesis & sample preview | `bun run bin/site-to-sqlite.ts discover "https://example.com" -o config.json` |
| `site-to-sqlite scrape` | [Step 2] High-speed crawler engine with `bun:sqlite`, checkpoint/resume, auto-schema evolution | `bun run bin/site-to-sqlite.ts scrape --config <config.json> --db <output.sqlite>` |
| `site-to-sqlite wizard` | Interactive 2-step wizard CLI (inspect $\rightarrow$ confirm $\rightarrow$ scrape) | `bun run bin/site-to-sqlite.ts wizard "https://example.com" --db data.sqlite` |
| `site-to-sqlite recon` | Network overview, sitemaps crawler, framework & structured data detector | `bun run bin/site-to-sqlite.ts recon "https://example.com"` |
| `site-to-sqlite inspect` | SQLite database inspector, schema summary, and JSON/CSV exporter | `bun run bin/site-to-sqlite.ts inspect <output.sqlite> --exportCsv <output.csv>` |
| `site-to-sqlite mcp` | Model Context Protocol (MCP) server for Claude Desktop, Cursor, and Zed | `bun run bin/site-to-sqlite.ts mcp` |

---

## 2-Step Scraping Workflow

### Step 1: Inspection, Candidate Discovery & User Confirmation
Run the discovery tool against the target website:

```bash
bun run bin/site-to-sqlite.ts discover "https://example.com" -o config.json
```

Or call the MCP tool `site_discover({ url: "https://example.com" })`.

The tool automatically analyzes:
- **Repeating Collections**: Cards, product items, blog entries, review blocks.
- **HTML Tables**: Headers `<th>` and rows `<tr><td>`.
- **Field Candidates**: `title`, `url`, `price`, `image`, `tags` (array), `author`, `date`, `rating`, `description`.
- **Pagination**: Next page selectors (`a[rel="next"]`, `li.next a`) and query URL patterns.
- **Sample Records**: Live sample previews showing exact extracted data.

**Confirm with User**:
Present the discovered candidate fields, sample records, and pagination details to the user and confirm whether they want to proceed or add any custom selectors.

---

### Step 2: Execute Headless Scraping & Validate Database
Run the polite crawler engine with the confirmed config:

```bash
bun run bin/site-to-sqlite.ts scrape --config ./config.json --db ./output.sqlite
```

The scraper handles:
- `@attribute` shorthand (`"a@href"`, `"time@datetime"`, `"img@src"`)
- Auto-attribute resolution (`img` -> `src`, `a` -> `href`, `time` -> `datetime`)
- Array fields (`array: true` -> JSON string array in SQLite)
- Detail page following (`detailPage: { ... }`)
- Checkpointing in `crawled_urls` and dynamic `ALTER TABLE` column additions.

After scraping, inspect and verify the database:

```bash
bun run bin/site-to-sqlite.ts inspect ./output.sqlite --exportCsv ./output.csv
```

Report to the user:
- Total URLs crawled & skipped
- Total structured records extracted
- Summary of table schemas and sample data
- Locations of `.sqlite` and exported `.csv` / `.json` files.
