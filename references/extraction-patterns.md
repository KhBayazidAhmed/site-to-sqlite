# Extraction Patterns & Config Specification

The `site-to-sqlite` scraping engine uses declarative JSON configurations to parse web pages into structured SQLite tables.

---

## Configuration Schema

```typescript
interface ExtractorConfig {
  name?: string;               // Descriptive name of the job
  tableName: string;           // Target SQLite table name (e.g. "products", "quotes", "articles")
  startUrls: string[];         // Seed URLs or list of pages to crawl
  itemSelector?: string;       // Repeater / Card selector (e.g. ".quote", ".product-card", "article")
  fields: Record<string, FieldExtractor | string>;
  detailPage?: {               // Optional 2nd tier detail page crawl & merge
    linkField?: string;        // Record property containing URL (default: "url")
    fields: Record<string, FieldExtractor | string>;
  };
  pagination?: {
    nextPageSelector?: string; // CSS selector for next page link (e.g. "li.next > a")
    urlPattern?: string;       // Parameterized pattern, e.g. "https://example.com/items?p={{page}}"
    startPage?: number;        // e.g. 1
    endPage?: number;          // e.g. 20
  };
  linkDiscovery?: {
    selector: string;          // CSS selector for detail page links
    urlRegex?: string;         // Regex filter for allowed URLs
    maxDepth?: number;
  };
  options?: {
    concurrency?: number;      // Default: 3, Max: 10
    delayMs?: number;          // Base delay in ms (default: 200)
    maxRetries?: number;       // Default: 3
    timeoutMs?: number;        // Default: 15000
    maxPagesTotal?: number;    // Hard cap on pages crawled
    headers?: Record<string, string>;
  };
}
```

---

## Field Extractor Options

Each field can be a shorthand string or a detailed `FieldExtractor` object:

### 1. Shorthand String Syntax
- `"title": "h3.title"` $\rightarrow$ extracts inner text.
- `"link": "h3 a@href"` $\rightarrow$ extracts `href` attribute and normalizes to absolute URL.
- `"datetime": "time@datetime"` $\rightarrow$ extracts `datetime` attribute.
- `"image": "img@src"` $\rightarrow$ extracts `src` or `data-src` attribute.

### 2. Full Object Syntax
```json
{
  "price": {
    "selector": [".price_color", ".price", ".current-price"],
    "attribute": "text",
    "transform": "number"
  },
  "tags": {
    "selector": "a.tag",
    "attribute": "text",
    "array": true
  },
  "rating": {
    "selector": ".star-rating",
    "attribute": "class",
    "regex": "star-rating (\\w+)",
    "regexGroup": 1
  }
}
```

### Supported Attributes & Auto-Inference
If `attribute` is omitted:
- `<img>` / `<source>` $\rightarrow$ automatically extracts `src` / `data-src` / `srcset`.
- `<a>` $\rightarrow$ automatically extracts `href`.
- `<time>` $\rightarrow$ automatically extracts `datetime` (or inner text if not present).
- `<meta>` $\rightarrow$ automatically extracts `content`.

### Supported Transformations
- `"trim"`: Trims whitespace (default).
- `"number"`: Strips currency/symbols and parses float/integer.
- `"lowercase"` / `"uppercase"`: Changes case.
- `"stripHtml"`: Removes HTML tags.
- `"json"`: Parses JSON string into a structured object/array.
- `"date"`: Validates and cleans timestamp strings.

---

## Multi-Tier Scraping (Listing + Detail Page)

```json
{
  "tableName": "books",
  "startUrls": ["https://books.toscrape.com/catalogue/page-1.html"],
  "itemSelector": "article.product_pod",
  "fields": {
    "title": "h3 a@title",
    "price": { "selector": ".price_color", "transform": "number" },
    "url": "h3 a@href"
  },
  "detailPage": {
    "linkField": "url",
    "fields": {
      "upc": "table.table-striped tr:nth-child(1) td",
      "stock_count": { "selector": "table.table-striped tr:nth-child(6) td", "transform": "number" },
      "full_description": "#product_description + p"
    }
  },
  "pagination": {
    "nextPageSelector": "li.next > a"
  },
  "options": {
    "concurrency": 3,
    "delayMs": 200,
    "maxPagesTotal": 2
  }
}
```
