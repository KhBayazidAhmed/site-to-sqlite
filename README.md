# site-to-sqlite

> Token-efficient web reconnaissance, pattern discovery, and polite SQLite scraper powered by [Bun](https://bun.sh) and TypeScript for **all AI agents** (Antigravity, Claude Code, Claude Desktop, Cursor, Windsurf, Codex, and standalone CLI).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io)
[![Universal Agent](https://img.shields.io/badge/AI%20Agent-Universal-green)](https://github.com/KhBayazidAhmed/site-to-sqlite)

---

## Key Highlights

- **2-Step Intelligent Discovery & Scrape Workflow**:
  1. **Step 1 (Inspect & Propose)**: Deeply inspects websites, discovers repeating cards, tables, JSON-LD schemas, and candidate fields, and synthesizes ready-to-use extraction schemas with live sample records.
  2. **Step 2 (Execution)**: Crawls and scrapes directly on your local machine into structured SQLite tables.
- **Zero LLM Token Bloat**: Never load massive raw HTML payloads into the LLM context.
- **Enhanced Selector Engine**: Supports shorthand `@attribute` notation (`a@href`, `time@datetime`, `img@src`), multi-selector fallbacks, auto-attribute detection, array/list field extraction, and detail-page multi-tier crawling.
- **High Performance & Lightweight**: Built with native `bun:sqlite` (WAL mode enabled) and `cheerio`.
- **Polite Crawling**: Concurrency throttling (3-5 workers default), random jitter delay (150-300ms), and exponential backoff retry on HTTP 429/5xx.
- **Checkpoint & Seamless Resume**: Tracks crawl statuses in `crawled_urls`; interrupted runs resume without duplicate network requests.
- **Dynamic SQLite Schema Evolution**: Automatically executes `ALTER TABLE ... ADD COLUMN` if new fields appear during crawling.
- **Built-in Model Context Protocol (MCP) Server**: Exposes stdio tools (`site_discover`, `site_recon`, `site_scrape`, `site_inspect_db`) for Claude Desktop, Cursor, Zed, and any MCP-compliant client.
- **Database Inspector & Exporter**: Instant schema visualization, row counts, sample queries, and one-click JSON/CSV export.

---

## Repository Structure

```text
site-to-sqlite/
├── bin/
│   └── site-to-sqlite.ts     # Unified CLI executable
├── scripts/
│   ├── discover.ts           # [Step 1] Website inspection & candidate pattern discovery
│   ├── scrape.ts             # [Step 2] High-performance crawler engine with bun:sqlite
│   ├── recon.ts              # Network reconnaissance (sitemaps, robots.txt, feeds)
│   ├── inspect-db.ts         # Database inspector and JSON/CSV exporter
│   └── mcp-server.ts         # Model Context Protocol (MCP) stdio server
├── references/
│   ├── recon-guide.md        # Fast-path discovery guide (APIs, Next.js props, JSON-LD)
│   └── extraction-patterns.md# Config schema, field extractors, transforms, and regex
├── examples/
│   └── quotes-config.json    # Ready-to-use sample extraction configuration
├── AGENTS.md                 # Universal agent runbook (Codex, Cursor, Windsurf)
├── CLAUDE.md                 # Guidelines for Claude Code and Claude Desktop
├── SKILL.md                  # Google Antigravity Skill definition
└── package.json              # Bun dependencies and metadata
```

---

## Installation

### 1. Prerequisites
- [Bun](https://bun.sh) (v1.0+) installed on your machine:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

### 2. Clone and Install
```bash
git clone https://github.com/KhBayazidAhmed/site-to-sqlite.git
cd site-to-sqlite
bun install
```

---

## 2-Step CLI Usage

### Step 1: Discover Extractable Fields & Candidate Schema
Inspect any website to see what repeating cards, tables, and fields can be scraped:

```bash
bun run bin/site-to-sqlite.ts discover "https://quotes.toscrape.com" -o config.json
```

### Step 2: Scrape into SQLite
Run the scraper with the generated configuration:

```bash
bun run bin/site-to-sqlite.ts scrape --config ./config.json --db ./data.sqlite
```

### Or use the Interactive 2-Step Wizard:
```bash
bun run bin/site-to-sqlite.ts wizard "https://quotes.toscrape.com" --db ./data.sqlite
```

### Inspect Database & Export:
```bash
bun run bin/site-to-sqlite.ts inspect ./data.sqlite --exportCsv ./quotes.csv
```

---

## MCP Server Setup

Add this server configuration to Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) or Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "site-to-sqlite": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/site-to-sqlite/scripts/mcp-server.ts"]
    }
  }
}
```

---

## License

MIT (c) [KhBayazidAhmed](https://github.com/KhBayazidAhmed)
