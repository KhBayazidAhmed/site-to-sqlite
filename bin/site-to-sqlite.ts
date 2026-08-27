#!/usr/bin/env bun
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const scriptsDir = join(rootDir, "scripts");

const args = Bun.argv.slice(2);
const subcommand = args[0];

function printHelp() {
  console.log(`
site-to-sqlite — High-Speed Web Reconnaissance & SQLite Extractor
=================================================================

Usage:
  site-to-sqlite <command> [options]

Commands:
  discover <url> [options]    [Step 1] Deep DOM inspection, repeating pattern & field discovery with preview
  scrape [options]            [Step 2] High-speed polite scraper into SQLite with checkpointing
  wizard <url> [options]      Interactive 2-step wizard (inspect -> propose/confirm -> scrape)
  recon <url> [options]       Network reconnaissance (sitemaps, robots.txt, JSON-LD, feeds)
  inspect [dbPath] [options]  Inspect database schema, row counts, preview, or export CSV/JSON
  mcp                         Start Model Context Protocol (MCP) stdio server for AI agents

Options:
  -v, --version               Show CLI version
  -h, --help                  Show this help overview

Examples:
  # Step 1: Discover extractable fields and sample records
  site-to-sqlite discover "https://quotes.toscrape.com" -o config.json

  # Step 2: Scrape with confirmed config into SQLite
  site-to-sqlite scrape --config ./config.json --db ./data.sqlite

  # Or run interactive 2-step wizard
  site-to-sqlite wizard "https://quotes.toscrape.com" --db ./data.sqlite

  # Step 3: Inspect database and export
  site-to-sqlite inspect ./data.sqlite --exportCsv ./data.csv

  # Run as MCP Server for Claude / Cursor / Antigravity
  site-to-sqlite mcp

Run 'site-to-sqlite <command> --help' for command-specific flags.
`);
}

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  printHelp();
  process.exit(0);
}

if (subcommand === "--version" || subcommand === "-v") {
  const pkg = await Bun.file(join(rootDir, "package.json")).json();
  console.log(`site-to-sqlite v${pkg.version}`);
  process.exit(0);
}

const scriptMap: Record<string, { script: string; extraArgs?: string[] }> = {
  discover: { script: join(scriptsDir, "discover.ts") },
  plan: { script: join(scriptsDir, "discover.ts") },
  recon: { script: join(scriptsDir, "recon.ts") },
  scrape: { script: join(scriptsDir, "scrape.ts") },
  wizard: { script: join(scriptsDir, "scrape.ts"), extraArgs: ["--interactive"] },
  inspect: { script: join(scriptsDir, "inspect-db.ts") },
  mcp: { script: join(scriptsDir, "mcp-server.ts") },
};

const match = scriptMap[subcommand];

if (!match) {
  console.error(`[Error] Unknown command: "${subcommand}"\n`);
  printHelp();
  process.exit(1);
}

const childArgs = [...(match.extraArgs || []), ...args.slice(1)];
const proc = spawn(process.execPath, ["run", match.script, ...childArgs], {
  stdio: "inherit",
  env: process.env,
});

proc.on("exit", (code) => {
  process.exit(code ?? 0);
});
