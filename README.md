# 🌐 site-to-sqlite

> Token-efficient web reconnaissance, pattern discovery, and polite SQLite scraper skill powered by [Bun](https://bun.sh) and TypeScript for **Google Antigravity (AGY)** and standalone CLI use.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-black?logo=bun)](https://bun.sh)
[![Antigravity Skill](https://img.shields.io/badge/Antigravity-Custom%20Skill-blue)](https://github.com/KhBayazidAhmed)

---

## ⚡ Highlights

- 🧠 **Token Efficient**: Never dumps large raw HTML into LLM context. Crawls and parses directly on your local machine into SQLite.
- 🔍 **Multi-Tiered Reconnaissance**: Automatically parses `robots.txt`, sitemaps (`.xml` and `.xml.gz`), RSS/Atom feeds, Schema.org JSON-LD, and Next.js `__NEXT_DATA__` hydration states.
- 🚀 **High Performance & Lightweight**: Built with Bun's native `bun:sqlite` (WAL mode enabled) and `cheerio`.
- 🛡️ **Polite Crawling**: Concurrency throttling (3–5 workers default), random jitter delay (150–300ms), and exponential backoff retry on HTTP 429/5xx.
- 🔁 **Checkpoint & Seamless Resume**: Tracks crawl statuses in `crawled_urls`; interrupted runs resume without duplicate network requests.
- 🧩 **Dynamic SQLite Schema Evolution**: Automatically runs `ALTER TABLE ... ADD COLUMN` if new fields appear during crawling.
- 📊 **Database Inspector & Exporter**: Instant schema visualization, row counts, sample queries, and one-click JSON/CSV export.

---

## 📂 Repository Structure

```text
site-to-sqlite/
├── SKILL.md                  # Main Antigravity Skill runbook
├── package.json              # Bun dependencies (cheerio, @types/bun)
├── scripts/
│   ├── recon.ts              # Reconnaissance & sitemap/feed/JSON-LD probe
│   ├── scrape.ts             # High-performance crawler engine with bun:sqlite
│   └── inspect-db.ts         # Database inspector & JSON/CSV exporter
├── references/
│   ├── recon-guide.md        # Fast-path discovery guide (APIs, Next.js props, JSON-LD)
│   └── extraction-patterns.md# Config schema, field extractors, transforms & regex
└── examples/
    └── quotes-config.json    # Ready-to-use sample extraction configuration
```

---

## 📥 Installation

### 1. Prerequisites
- [Bun](https://bun.sh) (v1.0+) installed on your system:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

### 2. Install as an Antigravity Global Skill
Clone or place this repository into your Antigravity skills directory:

```bash
git clone https://github.com/KhBayazidAhmed/site-to-sqlite.git ~/.gemini/antigravity/skills/site-to-sqlite
cd ~/.gemini/antigravity/skills/site-to-sqlite
bun install
```

---

## 🛠️ Standalone CLI Usage

### Phase 1: Reconnaissance
Inspect site structure, discover sitemaps, and check for structured data:

```bash
bun run scripts/recon.ts "https://quotes.toscrape.com"
```

### Phase 2: Create Extraction Config
Create a declarative JSON config defining the target table, selectors, and pagination:

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

### Phase 3: Run Polite Scraper
Execute the crawler engine to save structured data into SQLite:

```bash
bun run scripts/scrape.ts --config ./examples/quotes-config.json --db ./data.sqlite
```

### Phase 4: Inspect & Export
View SQLite tables, schemas, and export to CSV or JSON:

```bash
# Print summary & preview top rows
bun run scripts/inspect-db.ts -d ./data.sqlite

# Export table to CSV and JSON
bun run scripts/inspect-db.ts -d ./data.sqlite --exportCsv ./quotes.csv --exportJson ./quotes.json
```

---

## 🤖 Using with Antigravity

Once installed, simply ask Antigravity in any conversation:
> *"Scrape all products/articles from `https://example.com` into an SQLite database."*

Antigravity will automatically activate the **`site-to-sqlite`** skill, probe the site architecture, synthesize the extraction config, execute the Bun crawler, and return the structured SQLite database.

---

## 📄 License

MIT © [KhBayazidAhmed](https://github.com/KhBayazidAhmed)
