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
🌐 site-to-sqlite — High-Speed Web Reconnaissance & SQLite Extractor
=====================================================================

Usage:
  site-to-sqlite <command> [options]

Commands:
  recon <url> [options]       Deep website reconnaissance (sitemaps, robots, JSON-LD, feeds)
  scrape [options]            High-speed polite scraper into SQLite with checkpointing
  inspect [dbPath] [options]  Inspect database schema, row counts, preview, or export CSV/JSON
  mcp                         Start Model Context Protocol (MCP) stdio server for AI agents

Options:
  -v, --version               Show CLI version
  -h, --help                  Show this help overview

Examples:
  # 1. Recon website structure
  site-to-sqlite recon "https://quotes.toscrape.com"

  # 2. Scrape with config into SQLite
  site-to-sqlite scrape --config ./config.json --db ./data.sqlite

  # 3. Inspect database and export
  site-to-sqlite inspect ./data.sqlite --exportCsv ./data.csv

  # 4. Run as MCP Server for Claude / Cursor
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

const scriptMap: Record<string, string> = {
  recon: join(scriptsDir, "recon.ts"),
  scrape: join(scriptsDir, "scrape.ts"),
  inspect: join(scriptsDir, "inspect-db.ts"),
  mcp: join(scriptsDir, "mcp-server.ts"),
};

const targetScript = scriptMap[subcommand];

if (!targetScript) {
  console.error(`❌ Unknown command: "${subcommand}"\n`);
  printHelp();
  process.exit(1);
}

const childArgs = args.slice(1);
const proc = spawn(process.execPath, ["run", targetScript, ...childArgs], {
  stdio: "inherit",
  env: process.env,
});

proc.on("exit", (code) => {
  process.exit(code ?? 0);
});
