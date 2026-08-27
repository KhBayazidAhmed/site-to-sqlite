# Extraction Patterns & Config Specification

The `site-to-sqlite` scraping engine uses declarative JSON configurations to parse web pages into structured SQLite tables.

---

## Configuration Schema

```typescript
interface ExtractorConfig {
  name?: string;               // Descriptive name of the job
  tableName: string;           // Target SQLite table name (e.g. "products", "articles")
  startUrls: string[];         // Seed URLs or list of pages to crawl
  itemSelector?: string;       // Repeater / Card selector (e.g. ".product-card", "article.post")
  fields: Record<string, FieldExtractor | string>;
  pagination?: {
    nextPageSelector?: string; // CSS selector for next page link (e.g. "a.next-page")
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

Each field can be a simple CSS selector string (extracts trimmed text) or a detailed `FieldExtractor` object:

```json
{
  "price": {
    "selector": ".price-tag",
    "attribute": "text",
    "transform": "number"
  },
  "product_url": {
    "selector": "h2 a",
    "attribute": "href"
  },
  "thumbnail": {
    "selector": "img.card-img",
    "attribute": "src"
  },
  "rating": {
    "selector": "p.star-rating",
    "attribute": "class",
    "regex": "star-rating (\\w+)",
    "regexGroup": 1
  }
}
```

### Supported Attributes
- `"text"`: Cleans and extracts inner text content (default).
- `"html"`: Raw inner HTML.
- Any HTML attribute: `"href"`, `"src"`, `"data-id"`, `"title"`, `"content"`, `"class"`, etc. (Relative URLs in `href`/`src` are automatically resolved to absolute URLs).

### Supported Transformations
- `"trim"`: Trims surrounding whitespace.
- `"lowercase"`: Converts text to lowercase.
- `"number"`: Strips currency symbols and extracts numeric float/integer.
- `"json"`: Parses JSON string into a structured object (serialized in SQLite).

---

## Example Recipes

### 1. Paginated Card Catalog (e.g. E-Commerce / Blog)
```json
{
  "tableName": "books",
  "startUrls": ["https://books.toscrape.com/catalogue/page-1.html"],
  "itemSelector": "article.product_pod",
  "fields": {
    "title": "h3 a@title",
    "price": {
      "selector": ".price_color",
      "transform": "number"
    },
    "availability": ".availability",
    "detail_url": {
      "selector": "h3 a",
      "attribute": "href"
    },
    "thumbnail": {
      "selector": ".image_container img",
      "attribute": "src"
    }
  },
  "pagination": {
    "nextPageSelector": "li.next > a"
  },
  "options": {
    "concurrency": 3,
    "delayMs": 200,
    "maxPagesTotal": 50
  }
}
```

### 2. Parameterized Range Scraping
```json
{
  "tableName": "forum_threads",
  "startUrls": [],
  "itemSelector": ".thread-row",
  "fields": {
    "title": ".thread-title",
    "author": ".author-name",
    "replies": { "selector": ".reply-count", "transform": "number" }
  },
  "pagination": {
    "urlPattern": "https://forum.example.com/section/general?page={{page}}",
    "startPage": 1,
    "endPage": 10
  }
}
```
