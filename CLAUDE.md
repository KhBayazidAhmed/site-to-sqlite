# CLAUDE.md — Claude Guidelines for `site-to-sqlite`

Commands, architecture, and coding conventions for Claude Code and Claude Desktop.

---

## CLI & Build Commands

- **Install dependencies**: `bun install`
- **Unified CLI Entry**: `bun run cli -- <subcommand>` or `bun run bin/site-to-sqlite.ts <subcommand>`
- **Step 1 Discovery**: `bun run discover <url> [-o config.json]`
- **Step 2 Scraper**: `bun run scrape --config <config.json> --db <data.sqlite>`
- **Interactive Wizard**: `bun run wizard <url> [--db data.sqlite]`
- **Reconnaissance**: `bun run recon <url>`
- **Inspect DB**: `bun run inspect <data.sqlite> [--exportCsv <file.csv>]`
- **MCP Server**: `bun run mcp` (Runs stdio JSON-RPC MCP server)

---

## Architecture & 2-Step Workflow

1. **Step 1 (Inspect & Propose)**: Never load raw HTML into LLM context. Always run `discover` or call MCP `site_discover` to extract candidate repeating items, field selectors, and sample records. Formulate a clean candidate list and ask the user for confirmation.
2. **Step 2 (Execution)**: Execute `scrape` with the confirmed/adjusted config.
3. **Polite Crawling**: Default to 3 workers and 150-300ms random jitter delay. Always use WAL-mode SQLite for zero contention.
4. **Enhanced Extraction**: Supports shorthand `"selector@attribute"` (e.g. `"a@href"`, `"time@datetime"`), auto-attribute deduction, array fields (`array: true`), and detail page merging (`detailPage: { ... }`).
5. **Dynamic Schema Evolution**: The crawler automatically runs `ALTER TABLE ... ADD COLUMN` when encountering previously unseen fields in extracted objects.
6. **Checkpoint & Resume**: If an extraction is cancelled or restarted, `crawled_urls` tracks HTTP 200 URLs to avoid redundant requests.

---

## Claude Desktop MCP Configuration

Add this server to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "site-to-sqlite": {
      "command": "bun",
      "args": ["run", "/path/to/site-to-sqlite/scripts/mcp-server.ts"]
    }
  }
}
```
