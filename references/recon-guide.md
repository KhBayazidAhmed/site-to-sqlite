# Website Reconnaissance & Fast-Path Discovery Guide

Before scraping large amounts of HTML, always perform lightweight reconnaissance to find fast-paths that avoid heavy DOM parsing and reduce token consumption.

---

## 1. Fast-Path Hierarchy

Always prefer the highest-tier method available:

| Priority | Method | Speed & Efficiency | Best For |
|---|---|---|---|
| **Tier 1** | **Internal JSON API / GraphQL** | ⚡ Ultra-fast, pure structured data | SPAs, search endpoints, pagination APIs |
| **Tier 2** | **`__NEXT_DATA__` / Hydration State** | ⚡ Instant single-request full page state | Next.js, Nuxt, Remix, Astro websites |
| **Tier 3** | **JSON-LD (`application/ld+json`)** | ⚡ High accuracy schema.org data | Articles, products, recipes, event pages |
| **Tier 4** | **Sitemap + CSS Card Extractor** | 🚀 High speed with `cheerio` + Bun | Static SSR sites, blogs, catalogs |
| **Tier 5** | **Headless Browser / DevTools MCP** | 🐢 Heavy resource fallback | Dynamic JS rendering with bot verification |

---

## 2. Reconnaissance Checklist

1. **Robots.txt & Sitemap Inspection**:
   - Check `robots.txt` for `Crawl-delay` and declared `Sitemap:` URLs.
   - Run `bun run scripts/recon.ts <url>` to automatically parse sitemaps, sitemap indices, and gzip-compressed archives.

2. **Framework & Hydration Payload Detection**:
   - Look for `<script id="__NEXT_DATA__" type="application/json">`.
     - Key path: `parsed.props.pageProps` contains pre-rendered props (product details, lists, author data).
   - Look for `window.__INITIAL_STATE__` (common in Vue/Nuxt and Redux SSR).

3. **Schema.org Structured Data**:
   - Check `<script type="application/ld+json">`.
   - Often contains complete entities (`Product`, `Article`, `BlogPosting`, `BreadcrumbList`) with clean prices, authors, ratings, and published dates.

4. **Internal Network / API Discovery**:
   - Inspect network calls on paginated sites.
   - Look for predictable patterns like `GET /api/items?page=1&limit=50` or GraphQL POST endpoints with query payloads.

---

## 3. Pagination Patterns

- **Query Param**: `?page=2`, `?p=2`, `?offset=20&limit=20`
- **Path Param**: `/page/2/`, `/p/2/`, `/page-2`
- **Cursor-based**: `?after=cursor_token` (extract cursor from API response or next button `href`)
- **Next Link Selector**: `a[rel="next"]`, `li.next > a`, `.pagination .next`
