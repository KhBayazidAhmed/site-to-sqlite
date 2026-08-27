# CLAUDE.md — Claude Guidelines for `site-to-sqlite`

Commands, architecture, and coding conventions for Claude Code and Claude Desktop.

---

## CLI & Build Commands

- **Install dependencies**: `bun install`
- **Unified CLI Entry**: `bun run cli -- <subcommand>` or `bun run bin/site-to-sqlite.ts <subcommand>`
- **Reconnaissance**: `bun run recon <url>`
- **Scraper**: `bun run scrape --config <config.json> --db <data.sqlite>`
- **Inspect DB**: `bun run inspect <data.sqlite> [--exportCsv <file.csv>]`
- **MCP Server**: `bun run mcp` (Runs stdio JSON-RPC MCP server)

---

## Architecture & Philosophy

1. **Token Efficiency**: Never fetch or parse entire multi-megabyte HTML files inside LLM context. Always invoke the local Bun scraper scripts and review only the SQLite summary or small sample records.
2. **Polite Crawling**: Default to 3 workers and 150-300ms random jitter delay. Always use WAL-mode SQLite for zero contention.
3. **Dynamic Schema Evolution**: The crawler automatically runs `ALTER TABLE ... ADD COLUMN` when encountering previously unseen fields in extracted objects.
4. **Checkpoint & Resume**: If an extraction is cancelled or restarted, `crawled_urls` tracks HTTP 200 URLs to avoid redundant requests.

---

## Claude Desktop MCP Configuration

Add this server to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "site-to-sqlite": {
      "command": "bun",
      "args": ["run", "/Users/bixbd/Desktop/coding-heaven/site-to-sqlite/scripts/mcp-server.ts"]
    }
  }
}
```
