#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import * as cheerio from "cheerio";
import { parseArgs } from "util";
import { createHash } from "crypto";

export interface FieldExtractor {
  selector?: string;
  attribute?: string; // "text", "html", or attribute name like "href", "src", "data-id"
  transform?: "trim" | "number" | "date" | "json" | "lowercase";
  regex?: string; // Optional regex extraction
  regexGroup?: number;
  defaultValue?: any;
}

export interface ExtractorConfig {
  name?: string;
  tableName: string;
  startUrls: string[];
  itemSelector?: string; // If set, extracts multiple items per page (card/repeater pattern)
  fields: Record<string, FieldExtractor | string>;
  pagination?: {
    nextPageSelector?: string;
    maxPages?: number;
    urlPattern?: string; // e.g. "https://example.com/page/{{page}}"
    startPage?: number;
    endPage?: number;
  };
  linkDiscovery?: {
    selector: string;
    urlRegex?: string;
    maxDepth?: number;
  };
  options?: {
    concurrency?: number;
    delayMs?: number;
    maxRetries?: number;
    timeoutMs?: number;
    maxPagesTotal?: number;
    headers?: Record<string, string>;
  };
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 (Antigravity-Scraper/1.0)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

export class PoliteScraper {
  private db: Database;
  private config: ExtractorConfig;
  private queue: string[] = [];
  private enqueuedSet = new Set<string>();
  private activeWorkers = 0;
  private stats = {
    crawled: 0,
    skipped: 0,
    extracted: 0,
    errors: 0,
    startTime: Date.now(),
  };

  constructor(dbPath: string, config: ExtractorConfig) {
    this.db = new Database(dbPath, { create: true });
    this.config = config;
    this.initDatabase();
  }

  private initDatabase() {
    this.db.run(`PRAGMA journal_mode = WAL;`);
    this.db.run(`PRAGMA synchronous = NORMAL;`);

    // Metadata table for checkpointing and URL status
    this.db.run(`
      CREATE TABLE IF NOT EXISTS crawled_urls (
        url TEXT PRIMARY KEY,
        status_code INTEGER,
        duration_ms INTEGER,
        content_hash TEXT,
        error TEXT,
        crawled_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Ensure entity table exists
    const tableName = this.sanitizeIdentifier(this.config.tableName || "extracted_items");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_url TEXT,
        extracted_at TEXT DEFAULT (datetime('now'))
      );
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_source_url" ON "${tableName}"(source_url);`);
  }

  private sanitizeIdentifier(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  private inferSqliteType(val: any): string {
    if (val === null || val === undefined) return "TEXT";
    if (typeof val === "number") return Number.isInteger(val) ? "INTEGER" : "REAL";
    if (typeof val === "boolean") return "INTEGER";
    return "TEXT";
  }

  private ensureColumns(tableName: string, record: Record<string, any>) {
    const table = this.sanitizeIdentifier(tableName);
    const existingCols = new Set<string>();
    const pragma = this.db.prepare(`PRAGMA table_info("${table}");`).all() as { name: string }[];
    for (const col of pragma) {
      existingCols.add(col.name);
    }

    for (const [key, val] of Object.entries(record)) {
      const sanitizedKey = this.sanitizeIdentifier(key);
      if (!existingCols.has(sanitizedKey)) {
        const colType = this.inferSqliteType(val);
        try {
          this.db.run(`ALTER TABLE "${table}" ADD COLUMN "${sanitizedKey}" ${colType};`);
          existingCols.add(sanitizedKey);
        } catch (err: any) {
          if (!err.message?.includes("duplicate column")) {
            console.error(`Error adding column ${sanitizedKey}:`, err);
          }
        }
      }
    }
  }

  private insertRecord(tableName: string, sourceUrl: string, data: Record<string, any>) {
    const table = this.sanitizeIdentifier(tableName);
    this.ensureColumns(table, data);

    const keys = ["source_url", ...Object.keys(data).map((k) => this.sanitizeIdentifier(k))];
    const placeholders = keys.map(() => "?").join(", ");
    const values = [
      sourceUrl,
      ...Object.keys(data).map((k) => {
        const val = data[k];
        if (val === undefined || val === null) return null;
        if (typeof val === "object") return JSON.stringify(val);
        if (typeof val === "boolean") return val ? 1 : 0;
        return val;
      }),
    ];

    const sql = `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${placeholders});`;
    this.db.prepare(sql).run(...values);
    this.stats.extracted++;
  }

  private isAlreadyCrawled(url: string): boolean {
    const row = this.db.prepare("SELECT status_code FROM crawled_urls WHERE url = ?").get(url) as { status_code: number } | undefined;
    return !!row && row.status_code >= 200 && row.status_code < 400;
  }

  private markCrawled(url: string, statusCode: number, durationMs: number, contentHash?: string, error?: string) {
    this.db
      .prepare(
        `INSERT INTO crawled_urls (url, status_code, duration_ms, content_hash, error, crawled_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(url) DO UPDATE SET
           status_code = excluded.status_code,
           duration_ms = excluded.duration_ms,
           content_hash = excluded.content_hash,
           error = excluded.error,
           crawled_at = excluded.crawled_at;`
      )
      .run(url, statusCode, durationMs, contentHash || null, error || null);
  }

  private async fetchWithRetry(url: string): Promise<{ ok: boolean; status: number; html: string; error?: string; durationMs: number }> {
    const maxRetries = this.config.options?.maxRetries ?? 3;
    const timeoutMs = this.config.options?.timeoutMs ?? 15000;
    const headers = { ...DEFAULT_HEADERS, ...(this.config.options?.headers || {}) };

    let attempt = 0;
    let backoffMs = 1000;

    while (attempt < maxRetries) {
      attempt++;
      const startTime = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (res.status === 429 || res.status >= 500) {
          console.warn(`[HTTP ${res.status}] Rate-limited or server error on ${url}. Retrying in ${backoffMs}ms (Attempt ${attempt}/${maxRetries})...`);
          await Bun.sleep(backoffMs + Math.random() * 500);
          backoffMs *= 2;
          continue;
        }

        const html = await res.text();
        return { ok: res.ok, status: res.status, html, durationMs };
      } catch (err: any) {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        if (attempt >= maxRetries) {
          return { ok: false, status: 0, html: "", error: err.message || String(err), durationMs };
        }
        console.warn(`[Fetch Error] ${err.message || err} on ${url}. Retrying in ${backoffMs}ms...`);
        await Bun.sleep(backoffMs);
        backoffMs *= 2;
      }
    }

    return { ok: false, status: 0, html: "", error: "Max retries reached", durationMs: 0 };
  }

  private extractField($: cheerio.CheerioAPI, contextEl: any, def: FieldExtractor | string): any {
    const config: FieldExtractor = typeof def === "string" ? { selector: def, attribute: "text" } : def;
    let target = config.selector ? $(contextEl).find(config.selector) : $(contextEl);
    if (config.selector && !target.length && contextEl === $.root()) {
      target = $(config.selector);
    }

    let rawVal: string | undefined;
    const attr = config.attribute || "text";

    if (attr === "text") {
      rawVal = target.text();
    } else if (attr === "html") {
      rawVal = target.html() || undefined;
    } else {
      rawVal = target.attr(attr);
    }

    if (!rawVal) {
      return config.defaultValue !== undefined ? config.defaultValue : null;
    }

    let value: any = rawVal.trim();

    if (config.regex) {
      const match = value.match(new RegExp(config.regex));
      if (match) {
        value = match[config.regexGroup ?? 1] ?? match[0];
      }
    }

    if (config.transform) {
      if (config.transform === "trim") value = String(value).trim();
      if (config.transform === "lowercase") value = String(value).toLowerCase();
      if (config.transform === "number") {
        const cleaned = String(value).replace(/[^0-9.-]/g, "");
        const num = parseFloat(cleaned);
        value = isNaN(num) ? null : num;
      }
      if (config.transform === "json") {
        try {
          value = JSON.parse(value);
        } catch {}
      }
    }

    return value;
  }

  private extractPageData(url: string, html: string): Record<string, any>[] {
    const $ = cheerio.load(html);
    const results: Record<string, any>[] = [];

    // Check for itemSelector (multiple items per page)
    if (this.config.itemSelector) {
      const items = $(this.config.itemSelector);
      items.each((_, el) => {
        const record: Record<string, any> = {};
        for (const [key, fieldDef] of Object.entries(this.config.fields)) {
          record[key] = this.extractField($, el, fieldDef);
        }
        // If relative links were extracted, normalize them
        for (const [k, v] of Object.entries(record)) {
          if (typeof v === "string" && (v.startsWith("/") || v.startsWith("./")) && !v.startsWith("//")) {
            try {
              record[k] = new URL(v, url).toString();
            } catch {}
          }
        }
        results.push(record);
      });
    } else {
      // Single record per page
      const record: Record<string, any> = {};
      for (const [key, fieldDef] of Object.entries(this.config.fields)) {
        record[key] = this.extractField($, $.root(), fieldDef);
      }
      for (const [k, v] of Object.entries(record)) {
        if (typeof v === "string" && (v.startsWith("/") || v.startsWith("./")) && !v.startsWith("//")) {
          try {
            record[k] = new URL(v, url).toString();
          } catch {}
        }
      }
      results.push(record);
    }

    return results;
  }

  private discoverNextLinks(url: string, html: string): string[] {
    const discovered: string[] = [];
    const $ = cheerio.load(html);

    // Pagination selector
    if (this.config.pagination?.nextPageSelector) {
      const nextHref = $(this.config.pagination.nextPageSelector).attr("href");
      if (nextHref) {
        try {
          discovered.push(new URL(nextHref, url).toString());
        } catch {}
      }
    }

    // Link discovery selector
    if (this.config.linkDiscovery?.selector) {
      $(this.config.linkDiscovery.selector).each((_, el) => {
        const href = $(el).attr("href");
        if (href) {
          try {
            const resolved = new URL(href, url).toString();
            if (this.config.linkDiscovery?.urlRegex) {
              if (new RegExp(this.config.linkDiscovery.urlRegex).test(resolved)) {
                discovered.push(resolved);
              }
            } else {
              discovered.push(resolved);
            }
          } catch {}
        }
      });
    }

    return discovered;
  }

  public enqueue(urls: string[]) {
    for (const u of urls) {
      try {
        const clean = new URL(u).toString();
        if (!this.enqueuedSet.has(clean)) {
          this.enqueuedSet.add(clean);
          this.queue.push(clean);
        }
      } catch {}
    }
  }

  public async run(): Promise<{ crawled: number; extracted: number; skipped: number; errors: number }> {
    // Generate parameterized pagination if specified
    if (this.config.pagination?.urlPattern && this.config.pagination.startPage !== undefined && this.config.pagination.endPage !== undefined) {
      const pageUrls: string[] = [];
      for (let p = this.config.pagination.startPage; p <= this.config.pagination.endPage; p++) {
        pageUrls.push(this.config.pagination.urlPattern.replace("{{page}}", String(p)));
      }
      this.enqueue(pageUrls);
    }

    this.enqueue(this.config.startUrls);

    const concurrency = Math.min(Math.max(this.config.options?.concurrency ?? 3, 1), 10);
    const delayMs = this.config.options?.delayMs ?? 200;
    const maxPages = this.config.options?.maxPagesTotal ?? Infinity;

    console.log(`\n[Starting Scraper] Table: "${this.config.tableName}"`);
    console.log(`   Initial Queue: ${this.queue.length} URLs | Concurrency: ${concurrency} | Base Delay: ${delayMs}ms\n`);

    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(
        (async () => {
          while (this.queue.length > 0 && this.stats.crawled < maxPages) {
            const url = this.queue.shift();
            if (!url) break;

            // Checkpoint check
            if (this.isAlreadyCrawled(url)) {
              this.stats.skipped++;
              process.stdout.write(`\r[RESUME] Skipped already crawled (${this.stats.skipped}): ${url.slice(0, 70)}...`);
              continue;
            }

            // Polite jitter delay (150ms - 300ms)
            const jitter = delayMs + (Math.random() * 150 - 75);
            await Bun.sleep(Math.max(jitter, 50));

            const res = await this.fetchWithRetry(url);
            const contentHash = res.html ? createHash("md5").update(res.html).digest("hex") : undefined;

            this.markCrawled(url, res.status, res.durationMs, contentHash, res.error);

            if (res.ok && res.html) {
              this.stats.crawled++;
              const extractedRecords = this.extractPageData(url, res.html);
              for (const item of extractedRecords) {
                this.insertRecord(this.config.tableName, url, item);
              }

              // Discover next URLs
              const nextUrls = this.discoverNextLinks(url, res.html);
              this.enqueue(nextUrls);

              process.stdout.write(
                `\r[PROGRESS] Crawled: ${this.stats.crawled} | Extracted: ${this.stats.extracted} rows | Queue: ${this.queue.length} | Latency: ${res.durationMs}ms`
              );
            } else {
              this.stats.errors++;
              console.error(`\n[Error] Failed to crawl ${url} (Status: ${res.status}, Error: ${res.error || "None"})`);
            }
          }
        })()
      );
    }

    await Promise.all(workers);
    console.log(`\n\n[Scrape Completed]`);
    console.log(`   Total Crawled:   ${this.stats.crawled}`);
    console.log(`   Total Extracted: ${this.stats.extracted} records`);
    console.log(`   Total Skipped:   ${this.stats.skipped} (from previous checkpoints)`);
    console.log(`   Total Errors:    ${this.stats.errors}`);
    console.log(`   Time Elapsed:    ${((Date.now() - this.stats.startTime) / 1000).toFixed(1)}s\n`);

    return this.stats;
  }

  public close() {
    this.db.close();
  }
}

// CLI Execution
if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      config: { type: "string", short: "c" },
      db: { type: "string", short: "d", default: "data.sqlite" },
      url: { type: "string", short: "u" },
      table: { type: "string", short: "t", default: "items" },
      concurrency: { type: "string", default: "3" },
      delay: { type: "string", default: "200" },
      limit: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help || (!values.config && !values.url && positionals.length === 0)) {
    console.log(`
Polite Web Scraper to SQLite (site-to-sqlite)
Usage:
  bun run scripts/scrape.ts --config <config.json> [options]
  bun run scripts/scrape.ts --url <url> --table <name> [options]

Options:
  -c, --config <file>     JSON config file defining extraction rules
  -u, --url <url>         Single start URL (uses automated heuristic extraction)
  -d, --db <file>         SQLite database output path (default: data.sqlite)
  -t, --table <name>      Target SQLite table name (default: items)
  --concurrency <num>     Number of parallel workers (default: 3, max: 10)
  --delay <ms>            Base delay between requests in ms (default: 200)
  --limit <num>           Max total pages to crawl
  -h, --help              Show help message
`);
    process.exit(0);
  }

  let extractorConfig: ExtractorConfig;

  if (values.config) {
    const configText = await Bun.file(values.config).text();
    extractorConfig = JSON.parse(configText);
  } else {
    // Basic automatic extractor config
    const targetUrl = values.url || positionals[0];
    extractorConfig = {
      tableName: values.table || "items",
      startUrls: [targetUrl],
      fields: {
        title: "title, h1",
        description: 'meta[name="description"]@content, p',
        body_text: "article, main, body",
      },
    };
  }

  if (values.concurrency) {
    extractorConfig.options = {
      ...(extractorConfig.options || {}),
      concurrency: parseInt(values.concurrency, 10),
    };
  }
  if (values.delay) {
    extractorConfig.options = {
      ...(extractorConfig.options || {}),
      delayMs: parseInt(values.delay, 10),
    };
  }
  if (values.limit) {
    extractorConfig.options = {
      ...(extractorConfig.options || {}),
      maxPagesTotal: parseInt(values.limit, 10),
    };
  }

  const dbPath = values.db || "data.sqlite";
  const scraper = new PoliteScraper(dbPath, extractorConfig);
  await scraper.run();
  scraper.close();
}
