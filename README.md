# 🌐 site-to-sqlite

> Token-efficient web reconnaissance, pattern discovery, and polite SQLite scraper powered by [Bun](https://bun.sh) and TypeScript for **all AI agents** (Antigravity, Claude Code, Claude Desktop, Cursor, Windsurf, Codex, and standalone CLI).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io)
[![Universal Agent](https://img.shields.io/badge/AI%20Agent-Universal-green)](https://github.com/KhBayazidAhmed/site-to-sqlite)

---

## ⚡ Highlights

- 🧠 **Token Efficient**: Never dumps large raw HTML into LLM context. Crawls and parses directly on your local machine into SQLite.
- 🔍 **Multi-Tiered Reconnaissance**: Automatically parses `robots.txt`, sitemaps (`.xml` and `.xml.gz`), RSS/Atom feeds, Schema.org JSON-LD, and Next.js `__NEXT_DATA__` hydration states.
- 🚀 **High Performance & Lightweight**: Built with Bun's native `bun:sqlite` (WAL mode enabled) and `cheerio`.
- 🛡️ **Polite Crawling**: Concurrency throttling (3–5 workers default), random jitter delay (150–300ms), and exponential backoff retry on HTTP 429/5xx.
- 🔁 **Checkpoint & Seamless Resume**: Tracks crawl statuses in `crawled_urls`; interrupted runs resume without duplicate network requests.
- 🧩 **Dynamic SQLite Schema Evolution**: Automatically runs `ALTER TABLE ... ADD COLUMN` if new fields appear during crawling.
- 🔌 **Built-in Model Context Protocol (MCP) Server**: Exposes stdio tools for Claude Desktop, Cursor, Zed, and any MCP client.
- 📊 **Database Inspector & Exporter**: Instant schema visualization, row counts, sample queries, and one-click JSON/CSV export.

---

## 📂 Repository Structure

```text
site-to-sqlite/
├── bin/
│   └── site-to-sqlite.ts     # Unified CLI executable
├── scripts/
│   ├── recon.ts              # Reconnaissance & sitemap/feed/JSON-LD probe
│   ├── scrape.ts             # High-performance crawler engine with bun:sqlite
│   ├── inspect-db.ts         # Database inspector & JSON/CSV exporter
│   └── mcp-server.ts         # Model Context Protocol (MCP) stdio server
├── references/
│   ├── recon-guide.md        # Fast-path discovery guide (APIs, Next.js props, JSON-LD)
│   └── extraction-patterns.md# Config schema, field extractors, transforms & regex
├── examples/
│   └── quotes-config.json    # Ready-to-use sample extraction configuration
├── AGENTS.md                 # Universal agent runbook (Codex, Cursor, Windsurf)
├── CLAUDE.md                 # Guidelines for Claude Code & Claude Desktop
├── SKILL.md                  # Google Antigravity Skill definition
└── package.json              # Bun dependencies & metadata
```

---

## 📥 Installation

### 1. Prerequisites
- [Bun](https://bun.sh) (v1.0+) installed on your machine:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

### 2. Clone & Install
```bash
git clone https://github.com/KhBayazidAhmed/site-to-sqlite.git
cd site-to-sqlite
bun install
```

---

## 🤖 Universal AI Agent Setup

### 1. Google Antigravity (AGY)
Install as a global skill:
```bash
git clone https://github.com/KhBayazidAhmed/site-to-sqlite.git ~/.gemini/antigravity/skills/site-to-sqlite
cd ~/.gemini/antigravity/skills/site-to-sqlite && bun install
```

### 2. Claude Desktop (MCP Server)
Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

### 3. Cursor / Windsurf / Codex
Place `AGENTS.md` in your project or register the MCP server in `.cursor/mcp.json`:

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

## 🛠️ CLI Usage

```bash
# 1. Run Reconnaissance on target website
bun run bin/site-to-sqlite.ts recon "https://quotes.toscrape.com"

# 2. Scrape data using an extraction config into SQLite
bun run bin/site-to-sqlite.ts scrape --config ./examples/quotes-config.json --db ./data.sqlite

# 3. Inspect database and export tables to CSV or JSON
bun run bin/site-to-sqlite.ts inspect ./data.sqlite --exportCsv ./quotes.csv

# 4. Start the MCP Server
bun run bin/site-to-sqlite.ts mcp
```

---

## 🧩 Extraction Configuration Example

```json
{
  "tableName": "quotes",
  "startUrls": ["https://quotes.toscrape.com"],
  "itemSelector": ".quote",
  "fields": {
    "text": ".text",
    "author": ".author",
    "author_url": {
      "selector": ".author + a",
      "attribute": "href"
    },
    "tags": ".tags"
  },
  "pagination": {
    "nextPageSelector": "li.next > a"
  },
  "options": {
    "concurrency": 3,
    "delayMs": 200,
    "maxPagesTotal": 10
  }
}
```

---

## 📄 License

MIT © [KhBayazidAhmed](https://github.com/KhBayazidAhmed)
