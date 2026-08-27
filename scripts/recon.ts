#!/usr/bin/env bun
import * as cheerio from "cheerio";
import { parseArgs } from "util";
import { gunzipSync } from "zlib";

interface ReconOptions {
  url: string;
  limit?: number;
  json?: boolean;
  output?: string;
}

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

interface ReconReport {
  targetUrl: string;
  baseUrl: string;
  serverInfo?: {
    server?: string;
    poweredBy?: string;
    contentType?: string;
    status: number;
  };
  frameworksDetected: string[];
  structuredDataTypes: string[];
  robotsTxt: {
    found: boolean;
    crawlDelay?: number;
    disallowedPaths: string[];
    sitemaps: string[];
  };
  sitemaps: {
    totalUrls: number;
    discoveredUrls: SitemapUrl[];
    urlPatterns: Record<string, number>;
  };
  feeds: string[];
  samplePayloads: {
    hasJsonLd: boolean;
    hasHydrationData: boolean;
    hydrationType?: string;
    sampleEntities?: any[];
  };
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 (Antigravity-Recon/1.0)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchWithTimeout(url: string, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function parseRobotsTxt(baseUrl: string) {
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();
  const res = {
    found: false,
    crawlDelay: undefined as number | undefined,
    disallowedPaths: [] as string[],
    sitemaps: [] as string[],
  };

  try {
    const response = await fetchWithTimeout(robotsUrl, 8000);
    if (response.ok) {
      res.found = true;
      const text = await response.text();
      const lines = text.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith("#") || !line) continue;
        const [directive, ...rest] = line.split(":");
        const val = rest.join(":").trim();
        if (!directive || !val) continue;

        const key = directive.toLowerCase();
        if (key === "disallow") {
          res.disallowedPaths.push(val);
        } else if (key === "sitemap") {
          res.sitemaps.push(val);
        } else if (key === "crawl-delay") {
          const delay = parseFloat(val);
          if (!isNaN(delay)) res.crawlDelay = delay;
        }
      }
    }
  } catch {
    // Ignore robots.txt fetch error
  }
  return res;
}

async function parseSitemapXml(xmlText: string): Promise<{ urls: SitemapUrl[]; subSitemaps: string[] }> {
  const $ = cheerio.load(xmlText, { xmlMode: true });
  const urls: SitemapUrl[] = [];
  const subSitemaps: string[] = [];

  // Check for sitemapindex
  $("sitemapindex > sitemap > loc").each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) subSitemaps.push(loc);
  });

  // Check for urlset
  $("urlset > url").each((_, el) => {
    const loc = $(el).find("loc").text().trim();
    if (loc) {
      urls.push({
        loc,
        lastmod: $(el).find("lastmod").text().trim() || undefined,
        changefreq: $(el).find("changefreq").text().trim() || undefined,
        priority: $(el).find("priority").text().trim() || undefined,
      });
    }
  });

  return { urls, subSitemaps };
}

async function fetchSitemap(url: string): Promise<{ urls: SitemapUrl[]; subSitemaps: string[] }> {
  try {
    const res = await fetchWithTimeout(url, 15000);
    if (!res.ok) return { urls: [], subSitemaps: [] };

    let xmlText = "";
    if (url.endsWith(".gz")) {
      const buffer = await res.arrayBuffer();
      const decompressed = gunzipSync(Buffer.from(buffer));
      xmlText = decompressed.toString("utf-8");
    } else {
      xmlText = await res.text();
    }

    return parseSitemapXml(xmlText);
  } catch {
    return { urls: [], subSitemaps: [] };
  }
}

async function discoverSitemaps(baseUrl: string, hints: string[], maxTotalUrls = 1000): Promise<{ urls: SitemapUrl[]; urlPatterns: Record<string, number> }> {
  const candidateUrls = new Set<string>(hints);
  candidateUrls.add(new URL("/sitemap.xml", baseUrl).toString());
  candidateUrls.add(new URL("/sitemap_index.xml", baseUrl).toString());
  candidateUrls.add(new URL("/sitemap/sitemap.xml", baseUrl).toString());

  const discoveredUrls: SitemapUrl[] = [];
  const processedSitemaps = new Set<string>();
  const queue = Array.from(candidateUrls);

  while (queue.length > 0 && discoveredUrls.length < maxTotalUrls) {
    const currentSitemap = queue.shift()!;
    if (processedSitemaps.has(currentSitemap)) continue;
    processedSitemaps.add(currentSitemap);

    const { urls, subSitemaps } = await fetchSitemap(currentSitemap);
    for (const sub of subSitemaps) {
      if (!processedSitemaps.has(sub)) queue.push(sub);
    }
    for (const u of urls) {
      discoveredUrls.push(u);
      if (discoveredUrls.length >= maxTotalUrls) break;
    }
  }

  // Aggregate URL patterns
  const urlPatterns: Record<string, number> = {};
  for (const item of discoveredUrls) {
    try {
      const parsed = new URL(item.loc);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const pattern = segments.length > 0 ? `/${segments[0]}/*` : "/";
      urlPatterns[pattern] = (urlPatterns[pattern] || 0) + 1;
    } catch {
      // ignore bad URLs
    }
  }

  return { urls: discoveredUrls, urlPatterns };
}

async function probePage(targetUrl: string) {
  const result = {
    serverInfo: undefined as ReconReport["serverInfo"],
    frameworksDetected: [] as string[],
    structuredDataTypes: [] as string[],
    feeds: [] as string[],
    samplePayloads: {
      hasJsonLd: false,
      hasHydrationData: false,
      hydrationType: undefined as string | undefined,
      sampleEntities: [] as any[],
    },
  };

  try {
    const res = await fetchWithTimeout(targetUrl);
    result.serverInfo = {
      status: res.status,
      server: res.headers.get("server") || undefined,
      poweredBy: res.headers.get("x-powered-by") || undefined,
      contentType: res.headers.get("content-type") || undefined,
    };

    if (!res.ok) return result;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Detect Feeds
    $('link[type="application/rss+xml"], link[type="application/atom+xml"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        try {
          result.feeds.push(new URL(href, targetUrl).toString());
        } catch {
          result.feeds.push(href);
        }
      }
    });

    // Detect Frameworks & Hydration State
    if ($("#__NEXT_DATA__").length > 0) {
      result.frameworksDetected.push("Next.js (React)");
      result.samplePayloads.hasHydrationData = true;
      result.samplePayloads.hydrationType = "__NEXT_DATA__";
      try {
        const rawJson = $("#__NEXT_DATA__").html();
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          result.samplePayloads.sampleEntities?.push({
            pagePropsKeys: Object.keys(parsed?.props?.pageProps || {}),
          });
        }
      } catch {}
    }

    if (html.includes("window.__INITIAL_STATE__")) {
      result.frameworksDetected.push("Vue/Nuxt or Redux SSR");
      result.samplePayloads.hasHydrationData = true;
      result.samplePayloads.hydrationType = "window.__INITIAL_STATE__";
    }

    if (html.includes("data-reactroot") || html.includes("__remixContext")) {
      result.frameworksDetected.push("React / Remix");
    }

    if (html.includes("data-astro-cid") || html.includes("astro-island")) {
      result.frameworksDetected.push("Astro");
    }

    // Detect JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $(el).html();
        if (content) {
          const data = JSON.parse(content);
          result.samplePayloads.hasJsonLd = true;
          const entityType = data["@type"] || (Array.isArray(data["@graph"]) ? "Graph" : "Object");
          result.structuredDataTypes.push(String(entityType));
          result.samplePayloads.sampleEntities?.push(data);
        }
      } catch {}
    });

    // Detect OpenGraph / Twitter Cards
    const ogTitle = $('meta[property="og:title"]').attr("content");
    if (ogTitle) {
      result.structuredDataTypes.push("OpenGraph");
    }
  } catch (err) {
    console.error(`Warning: could not probe page ${targetUrl}:`, err);
  }

  return result;
}

export async function runRecon(options: ReconOptions): Promise<ReconReport> {
  const parsedUrl = new URL(options.url);
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

  // 1. Robots.txt
  const robots = await parseRobotsTxt(baseUrl);

  // 2. Sitemaps
  const sitemaps = await discoverSitemaps(baseUrl, robots.sitemaps, options.limit || 500);

  // 3. Probe Target & Homepage
  const pageProbe = await probePage(options.url);

  const report: ReconReport = {
    targetUrl: options.url,
    baseUrl,
    serverInfo: pageProbe.serverInfo,
    frameworksDetected: Array.from(new Set(pageProbe.frameworksDetected)),
    structuredDataTypes: Array.from(new Set(pageProbe.structuredDataTypes)),
    robotsTxt: robots,
    sitemaps: {
      totalUrls: sitemaps.urls.length,
      discoveredUrls: sitemaps.urls.slice(0, 50),
      urlPatterns: sitemaps.urlPatterns,
    },
    feeds: pageProbe.feeds,
    samplePayloads: pageProbe.samplePayloads,
  };

  return report;
}

// CLI Execution
if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      url: { type: "string", short: "u" },
      limit: { type: "string", short: "l", default: "500" },
      json: { type: "boolean", short: "j", default: false },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  const targetUrl = values.url || positionals[0];

  if (values.help || !targetUrl) {
    console.log(`
Site Reconnaissance Tool (site-to-sqlite)
Usage:
  bun run scripts/recon.ts <url> [options]

Options:
  -u, --url <url>      Target URL to inspect
  -l, --limit <num>    Max sitemap URLs to collect (default: 500)
  -j, --json           Output raw JSON
  -o, --output <file>  Save output report to JSON file
  -h, --help           Show help message
`);
    process.exit(0);
  }

  const limit = parseInt(values.limit || "500", 10);
  const report = await runRecon({
    url: targetUrl,
    limit,
    json: values.json,
    output: values.output,
  });

  if (values.json) {
    const jsonStr = JSON.stringify(report, null, 2);
    if (values.output) {
      await Bun.write(values.output, jsonStr);
      console.log(`Saved report to ${values.output}`);
    } else {
      console.log(jsonStr);
    }
  } else {
    console.log("\n=======================================================");
    console.log(`🔍 RECONNAISSANCE REPORT: ${report.targetUrl}`);
    console.log("=======================================================");
    console.log(`Base URL:     ${report.baseUrl}`);
    console.log(`HTTP Status:  ${report.serverInfo?.status || "N/A"}`);
    console.log(`Server:       ${report.serverInfo?.server || "Unknown"}`);
    console.log(`Frameworks:   ${report.frameworksDetected.join(", ") || "Static HTML / Standard"}`);
    console.log(`Metadata:     ${report.structuredDataTypes.join(", ") || "Standard DOM"}`);
    console.log(`Robots.txt:   ${report.robotsTxt.found ? "Found" : "Not Found"} (Crawl-delay: ${report.robotsTxt.crawlDelay || "None"})`);
    console.log(`Sitemaps:     ${report.robotsTxt.sitemaps.length > 0 ? report.robotsTxt.sitemaps.join(", ") : "Default checks"}`);
    console.log(`Discovered:   ${report.sitemaps.totalUrls} URLs from sitemaps`);
    
    if (Object.keys(report.sitemaps.urlPatterns).length > 0) {
      console.log("\n📁 URL Structure Breakdown:");
      for (const [pattern, count] of Object.entries(report.sitemaps.urlPatterns)) {
        console.log(`   ${pattern.padEnd(25)} : ${count} URLs`);
      }
    }

    if (report.samplePayloads.hasJsonLd) {
      console.log("\n⚡ Fast-Path Extraction Available: JSON-LD Structured Data detected!");
    }
    if (report.samplePayloads.hasHydrationData) {
      console.log(`\n⚡ Fast-Path Extraction Available: Hydration state (${report.samplePayloads.hydrationType}) detected!`);
    }

    console.log("=======================================================\n");

    if (values.output) {
      await Bun.write(values.output, JSON.stringify(report, null, 2));
      console.log(`Saved full report JSON to ${values.output}`);
    }
  }
}
