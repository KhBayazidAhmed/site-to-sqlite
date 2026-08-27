#!/usr/bin/env bun
import * as cheerio from "cheerio";
import { parseArgs } from "util";
import type { ExtractorConfig, FieldExtractor } from "./scrape";

export interface DiscoveredField {
  name: string;
  selector?: string;
  attribute?: string;
  inferredType: "text" | "number" | "url" | "image" | "date" | "array" | "json";
  confidence: number; // 0.0 - 1.0
  sampleValues: any[];
  isArray?: boolean;
}

export interface DiscoveredCandidate {
  id: string;
  title: string;
  entityType: "repeater_cards" | "html_table" | "json_ld" | "hydration_state" | "single_document";
  suggestedTableName: string;
  itemSelector?: string;
  itemCountOnPage: number;
  confidence: "high" | "medium" | "low";
  fields: Record<string, DiscoveredField>;
  sampleRecords: Record<string, any>[];
  pagination?: {
    type: "next_link" | "query_param" | "path_param" | "none";
    nextPageSelector?: string;
    urlPattern?: string;
    sampleNextUrl?: string;
  };
  generatedConfig: ExtractorConfig;
}

export interface DiscoveryReport {
  targetUrl: string;
  baseUrl: string;
  pageTitle: string;
  metaDescription?: string;
  frameworksDetected: string[];
  totalCandidatesFound: number;
  candidates: DiscoveredCandidate[];
  summaryMessage: string;
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 (Antigravity-Discovery/1.0)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchHtml(url: string, timeoutMs = 15000): Promise<{ html: string; status: number; ok: boolean }> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: controller.signal, redirect: "follow" });
    clearTimeout(id);
    const html = await res.text();
    return { html, status: res.status, ok: res.ok };
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function sanitizeIdentifier(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return clean || "items";
}

function resolveUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute, baseUrl).toString();
  } catch {
    return relativeOrAbsolute;
  }
}

// 1. Discover Pagination
function detectPagination($: cheerio.CheerioAPI, currentUrl: string): DiscoveredCandidate["pagination"] {
  const nextSelectors = [
    'a[rel="next"]',
    'li.next > a',
    'li.next a',
    '.pagination .next a',
    '.pagination a.next',
    'a.next-page',
    'a.next',
    'a:contains("Next")',
    'a:contains("next")',
    'a:contains("›")',
    'a:contains("»")',
    'a:contains("Older Posts")',
    'a:contains("Next Page")',
  ];

  for (const selector of nextSelectors) {
    try {
      const el = $(selector).first();
      if (el.length > 0) {
        const href = el.attr("href");
        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
          const sampleNextUrl = resolveUrl(href, currentUrl);
          return {
            type: "next_link",
            nextPageSelector: selector,
            sampleNextUrl,
          };
        }
      }
    } catch {}
  }

  // Check URL pattern (e.g. ?page=1 or /page/1)
  try {
    const parsed = new URL(currentUrl);
    if (parsed.searchParams.has("page") || parsed.searchParams.has("p")) {
      const pageKey = parsed.searchParams.has("page") ? "page" : "p";
      const cloned = new URL(currentUrl);
      cloned.searchParams.set(pageKey, "{{page}}");
      return {
        type: "query_param",
        urlPattern: cloned.toString(),
      };
    }
  } catch {}

  return { type: "none" };
}

// 2. Discover JSON-LD Entities
function discoverJsonLdCandidates($: cheerio.CheerioAPI, targetUrl: string): DiscoveredCandidate[] {
  const candidates: DiscoveredCandidate[] = [];
  const scripts = $('script[type="application/ld+json"]');

  scripts.each((idx, el) => {
    try {
      const text = $(el).html();
      if (!text) return;
      const data = JSON.parse(text);

      const items = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const type = item["@type"];
        if (!type || typeof type !== "string") continue;

        if (type === "BreadcrumbList" && items.length > 1) continue;

        const candidateFields: Record<string, DiscoveredField> = {};
        const sampleRecord: Record<string, any> = {};

        for (const [key, val] of Object.entries(item)) {
          if (key.startsWith("@")) continue;
          const cleanKey = sanitizeIdentifier(key);
          const valPreview = typeof val === "object" ? (Array.isArray(val) ? val.slice(0, 3) : val?.name || val?.title || JSON.stringify(val).slice(0, 80)) : val;

          sampleRecord[cleanKey] = valPreview;
          candidateFields[cleanKey] = {
            name: cleanKey,
            selector: `json:${key}`,
            inferredType: Array.isArray(val) ? "array" : typeof val === "number" ? "number" : "text",
            confidence: 0.95,
            sampleValues: [valPreview],
            isArray: Array.isArray(val),
          };
        }

        const tableName = sanitizeIdentifier(type.toLowerCase() + "_jsonld");
        const configFields: Record<string, any> = {};
        for (const [k, f] of Object.entries(candidateFields)) {
          configFields[k] = {
            selector: `script[type="application/ld+json"]`,
            transform: "json",
          };
        }

        candidates.push({
          id: `jsonld_${idx}_${type.toLowerCase()}`,
          title: `Schema.org JSON-LD [${type}]`,
          entityType: "json_ld",
          suggestedTableName: tableName,
          itemCountOnPage: 1,
          confidence: "high",
          fields: candidateFields,
          sampleRecords: [sampleRecord],
          generatedConfig: {
            name: `JSON-LD ${type} Scraper`,
            tableName,
            startUrls: [targetUrl],
            fields: configFields,
            options: { concurrency: 2, delayMs: 200 },
          },
        });
      }
    } catch {}
  });

  return candidates;
}

// 3. Discover HTML Tables
function discoverTableCandidates($: cheerio.CheerioAPI, targetUrl: string): DiscoveredCandidate[] {
  const candidates: DiscoveredCandidate[] = [];

  $("table").each((idx, tableEl) => {
    const $table = $(tableEl);
    const rows = $table.find("tbody tr, tr").filter((_, r) => $(r).find("td").length > 0);
    if (rows.length < 2) return;

    const headers: string[] = [];
    $table.find("thead th, tr:first-child th, tr:first-child td").each((hIdx, th) => {
      const hText = $(th).text().trim() || `column_${hIdx + 1}`;
      headers.push(sanitizeIdentifier(hText));
    });

    if (headers.length === 0) {
      const firstRowCells = rows.first().find("td");
      firstRowCells.each((cIdx) => headers.push(`column_${cIdx + 1}`));
    }

    const candidateFields: Record<string, DiscoveredField> = {};
    const sampleRecords: Record<string, any>[] = [];

    rows.slice(0, 3).each((_, rowEl) => {
      const record: Record<string, any> = {};
      const cells = $(rowEl).find("td");

      cells.each((cIdx, td) => {
        const colName = headers[cIdx] || `column_${cIdx + 1}`;
        const text = $(td).text().trim();
        record[colName] = text;

        if (!candidateFields[colName]) {
          const isNum = !isNaN(Number(text.replace(/[^0-9.-]/g, ""))) && text.length > 0;
          candidateFields[colName] = {
            name: colName,
            selector: `td:nth-child(${cIdx + 1})`,
            inferredType: isNum ? "number" : "text",
            confidence: 0.85,
            sampleValues: [text],
          };
        } else if (candidateFields[colName].sampleValues.length < 3) {
          candidateFields[colName].sampleValues.push(text);
        }
      });
      sampleRecords.push(record);
    });

    const tableSelector = $table.attr("id") ? `#${$table.attr("id")} tr` : $table.attr("class") ? `table.${$table.attr("class")?.split(" ")[0]} tr` : `table:nth-of-type(${idx + 1}) tr`;
    const tableName = `table_${idx + 1}_data`;

    const configFields: Record<string, any> = {};
    for (const [colName, f] of Object.entries(candidateFields)) {
      configFields[colName] = {
        selector: f.selector,
        attribute: "text",
        ...(f.inferredType === "number" ? { transform: "number" } : {}),
      };
    }

    candidates.push({
      id: `table_${idx + 1}`,
      title: `HTML Data Table (${headers.length} columns, ${rows.length} rows)`,
      entityType: "html_table",
      suggestedTableName: tableName,
      itemSelector: tableSelector,
      itemCountOnPage: rows.length,
      confidence: "high",
      fields: candidateFields,
      sampleRecords,
      generatedConfig: {
        name: `Table Scraper - ${tableName}`,
        tableName,
        startUrls: [targetUrl],
        itemSelector: tableSelector,
        fields: configFields,
        options: { concurrency: 2, delayMs: 200 },
      },
    });
  });

  return candidates;
}

// 4. Discover Repeating Card / Grid / List Elements
function discoverRepeaterCandidates($: cheerio.CheerioAPI, targetUrl: string, pagination?: DiscoveredCandidate["pagination"]): DiscoveredCandidate[] {
  const candidates: DiscoveredCandidate[] = [];

  const candidateSelectors = [
    "article.product_pod",
    ".quote",
    ".product-card",
    ".card",
    ".post-item",
    ".article-item",
    "article",
    ".post",
    ".product",
    ".item",
    ".listing-item",
    ".result-item",
    ".book-item",
    ".row-item",
    '[class*="card"]',
    '[class*="product"]',
    '[class*="item"]',
    '[class*="article"]',
    '[class*="post"]',
    '[class*="listing"]',
    "ul.products > li",
    "div.grid > div",
    "div.row > div.col",
    "div.row > div[class*='col-']",
    "ol.row > li",
    "ul.row > li",
    "main ul > li",
    "main ol > li",
  ];

  const testedSelectors = new Set<string>();

  for (const rawSel of candidateSelectors) {
    if (testedSelectors.has(rawSel)) continue;
    testedSelectors.add(rawSel);

    try {
      const matched = $(rawSel);
      if (matched.length < 2) continue;

      // Filter out matches if matched elements are nested inside each other
      const firstEl = matched.first();
      if (firstEl.find(rawSel).length > 0) continue;

      const candidateFields: Record<string, DiscoveredField> = {};
      const sampleRecords: Record<string, any>[] = [];

      const sampleItems = matched.slice(0, 3);

      sampleItems.each((_, el) => {
        const $el = $(el);
        const record: Record<string, any> = {};

        // A. Title / Heading
        const titleEl = $el.find("h1, h2, h3, h4, .title, [class*='title'], [class*='name'], strong").first();
        if (titleEl.length > 0) {
          const fullTitle = titleEl.find("a").attr("title") || titleEl.text().trim();
          const titleText = fullTitle || titleEl.text().trim();
          const titleTag = titleEl.prop("tagName")?.toLowerCase() || "h2";
          const titleClass = titleEl.attr("class") ? `.${titleEl.attr("class")?.trim().split(/\s+/)[0]}` : "";
          const hasTitleAttr = !!titleEl.find("a").attr("title");
          const titleSelector = hasTitleAttr
            ? (titleClass ? `${titleTag}${titleClass} a` : `${titleTag} a`)
            : (titleClass ? `${titleTag}${titleClass}` : titleTag);

          if (titleText && titleText.length < 300) {
            record["title"] = titleText;
            if (!candidateFields["title"]) {
              candidateFields["title"] = {
                name: "title",
                selector: titleSelector,
                attribute: hasTitleAttr ? "title" : "text",
                inferredType: "text",
                confidence: 0.95,
                sampleValues: [titleText],
              };
            } else if (candidateFields["title"].sampleValues.length < 3) {
              candidateFields["title"].sampleValues.push(titleText);
            }
          }
        }

        // B. Primary Link / Detail URL
        const linkEl = $el.find("a[href]").first();
        if (linkEl.length > 0) {
          const href = linkEl.attr("href");
          if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
            const absUrl = resolveUrl(href, targetUrl);
            record["url"] = absUrl;

            const linkSelector = titleEl.find("a").length > 0 ? `${titleEl.prop("tagName")?.toLowerCase() || "h3"} a` : "a";
            if (!candidateFields["url"]) {
              candidateFields["url"] = {
                name: "url",
                selector: linkSelector,
                attribute: "href",
                inferredType: "url",
                confidence: 0.9,
                sampleValues: [absUrl],
              };
            } else if (candidateFields["url"].sampleValues.length < 3) {
              candidateFields["url"].sampleValues.push(absUrl);
            }
          }
        }

        // C. Price / Numeric Cost
        let priceTarget = $el.find('.price_color, .price, [class*="price_color"], [class*="current-price"], p.price, span.price, .amount, .cost, span:contains("£"), span:contains("$"), span:contains("€"), span:contains("৳"), p:contains("£"), p:contains("$"), [class*="price"]').first();
        if (priceTarget.length > 0) {
          if (priceTarget.is("div, section, ul, li") && priceTarget.find("p, span, b, strong").length > 0) {
            const inner = priceTarget.find('.price_color, p[class*="price"], span[class*="price"], p:contains("£"), p:contains("$"), span:contains("£"), span:contains("$")').first();
            if (inner.length > 0) priceTarget = inner;
          }

          const rawPrice = priceTarget.text().trim();
          if (rawPrice && rawPrice.length < 50) {
            record["price"] = rawPrice;
            const priceClass = priceTarget.attr("class") ? `.${priceTarget.attr("class")?.trim().split(/\s+/)[0]}` : priceTarget.prop("tagName")?.toLowerCase() || ".price";
            if (!candidateFields["price"]) {
              candidateFields["price"] = {
                name: "price",
                selector: priceClass,
                attribute: "text",
                inferredType: "number",
                confidence: 0.95,
                sampleValues: [rawPrice],
              };
            } else if (candidateFields["price"].sampleValues.length < 3) {
              candidateFields["price"].sampleValues.push(rawPrice);
            }
          }
        }

        // D. Image / Thumbnail
        const imgEl = $el.find("img[src], img[data-src], source[srcset]").first();
        if (imgEl.length > 0) {
          const src = imgEl.attr("src") || imgEl.attr("data-src") || imgEl.attr("srcset");
          if (src) {
            const absImg = resolveUrl(src, targetUrl);
            record["image"] = absImg;
            if (!candidateFields["image"]) {
              candidateFields["image"] = {
                name: "image",
                selector: "img",
                attribute: imgEl.attr("src") ? "src" : "data-src",
                inferredType: "image",
                confidence: 0.85,
                sampleValues: [absImg],
              };
            } else if (candidateFields["image"].sampleValues.length < 3) {
              candidateFields["image"].sampleValues.push(absImg);
            }
          }
        }

        // E. Author / Creator / Byline
        const authorEl = $el.find('.author, [class*="author"], [rel="author"], .byline, .user, .creator').first();
        if (authorEl.length > 0) {
          const authorText = authorEl.text().trim();
          if (authorText && authorText.length < 100) {
            record["author"] = authorText;
            const authorClass = authorEl.attr("class") ? `.${authorEl.attr("class")?.trim().split(/\s+/)[0]}` : ".author";
            if (!candidateFields["author"]) {
              candidateFields["author"] = {
                name: "author",
                selector: authorClass,
                attribute: "text",
                inferredType: "text",
                confidence: 0.85,
                sampleValues: [authorText],
              };
            } else if (candidateFields["author"].sampleValues.length < 3) {
              candidateFields["author"].sampleValues.push(authorText);
            }
          }
        }

        // F. Date / Published Time
        const dateEl = $el.find('time, [class*="date"], [class*="time"], [datetime], .published').first();
        if (dateEl.length > 0) {
          const dateText = dateEl.attr("datetime") || dateEl.text().trim();
          if (dateText) {
            record["published_date"] = dateText;
            if (!candidateFields["published_date"]) {
              candidateFields["published_date"] = {
                name: "published_date",
                selector: dateEl.is("time") ? "time" : dateEl.attr("class") ? `.${dateEl.attr("class")?.split(/\s+/)[0]}` : "time",
                attribute: dateEl.attr("datetime") ? "datetime" : "text",
                inferredType: "date",
                confidence: 0.9,
                sampleValues: [dateText],
              };
            } else if (candidateFields["published_date"].sampleValues.length < 3) {
              candidateFields["published_date"].sampleValues.push(dateText);
            }
          }
        }

        // G. Rating / Star count
        const ratingEl = $el.find('.star-rating, [class*="rating"], [class*="star"], [aria-label*="star"], [aria-label*="rating"]').first();
        if (ratingEl.length > 0) {
          const ratingVal = ratingEl.attr("aria-label") || ratingEl.attr("class") || ratingEl.text().trim();
          if (ratingVal) {
            record["rating"] = ratingVal;
            const ratingSel = ratingEl.attr("class") ? `.${ratingEl.attr("class")?.split(/\s+/)[0]}` : ".rating";
            if (!candidateFields["rating"]) {
              candidateFields["rating"] = {
                name: "rating",
                selector: ratingSel,
                attribute: ratingEl.attr("aria-label") ? "aria-label" : "class",
                inferredType: "text",
                confidence: 0.8,
                sampleValues: [ratingVal],
              };
            } else if (candidateFields["rating"].sampleValues.length < 3) {
              candidateFields["rating"].sampleValues.push(ratingVal);
            }
          }
        }

        // H. Tags / Badges / Categories (Array candidates)
        const tagsEl = $el.find('.tags a, a.tag, .tag, [class*="tag"] a, .badge, [class*="badge"], [class*="category"]');
        if (tagsEl.length > 0) {
          const tagValues: string[] = [];
          tagsEl.each((_, t) => {
            const txt = $(t).text().trim();
            if (txt && txt.length < 40 && !txt.toLowerCase().startsWith("tags:")) tagValues.push(txt);
          });

          if (tagValues.length > 0) {
            record["tags"] = tagValues;
            const firstTag = tagsEl.first();
            const tagSel = firstTag.hasClass("tag")
              ? (firstTag.is("a") ? "a.tag" : ".tag")
              : firstTag.attr("class")
              ? `.${firstTag.attr("class")?.split(/\s+/)[0]}`
              : ".tags a";

            if (!candidateFields["tags"]) {
              candidateFields["tags"] = {
                name: "tags",
                selector: tagSel,
                attribute: "text",
                inferredType: "array",
                isArray: true,
                confidence: 0.85,
                sampleValues: [tagValues],
              };
            } else if (candidateFields["tags"].sampleValues.length < 3) {
              candidateFields["tags"].sampleValues.push(tagValues);
            }
          }
        }

        // I. Summary / Snippet / Description
        const descEl = $el.find('p:not(.author):not(.price):not([class*="price"]):not([class*="rating"]):not([class*="star"]):not([class*="stock"]):not([class*="avail"]):not(.tags), .text, .description, .summary, .excerpt, [class*="desc"]').first();
        if (descEl.length > 0) {
          const descText = descEl.text().trim();
          if (descText && descText.length > 5 && descText.length < 1000 && !descText.startsWith("£") && !descText.startsWith("$")) {
            const fieldName = descEl.hasClass("text") ? "text" : "description";
            record[fieldName] = descText;
            const descSel = descEl.attr("class") ? `.${descEl.attr("class")?.split(/\s+/)[0]}` : "p";
            if (!candidateFields[fieldName]) {
              candidateFields[fieldName] = {
                name: fieldName,
                selector: descSel,
                attribute: "text",
                inferredType: "text",
                confidence: 0.85,
                sampleValues: [descText],
              };
            } else if (candidateFields[fieldName].sampleValues.length < 3) {
              candidateFields[fieldName].sampleValues.push(descText);
            }
          }
        }

        // J. Availability / Stock
        const stockEl = $el.find('.availability, .stock, [class*="availability"], [class*="stock"]').first();
        if (stockEl.length > 0) {
          const stockText = stockEl.text().trim();
          if (stockText) {
            record["availability"] = stockText;
            const stockSel = stockEl.attr("class") ? `.${stockEl.attr("class")?.split(/\s+/)[0]}` : ".availability";
            if (!candidateFields["availability"]) {
              candidateFields["availability"] = {
                name: "availability",
                selector: stockSel,
                attribute: "text",
                inferredType: "text",
                confidence: 0.85,
                sampleValues: [stockText],
              };
            } else if (candidateFields["availability"].sampleValues.length < 3) {
              candidateFields["availability"].sampleValues.push(stockText);
            }
          }
        }

        sampleRecords.push(record);
      });

      const fieldCount = Object.keys(candidateFields).length;
      if (fieldCount < 2) continue;

      const confidence: DiscoveredCandidate["confidence"] = fieldCount >= 3 ? "high" : "medium";

      let tableName = "items";
      if (rawSel.includes("quote")) tableName = "quotes";
      else if (rawSel.includes("product") || rawSel.includes("book")) tableName = "products";
      else if (rawSel.includes("post") || rawSel.includes("article")) tableName = "articles";
      else if (rawSel.includes("card")) tableName = "cards";

      const configFields: Record<string, FieldExtractor | string> = {};
      for (const [k, f] of Object.entries(candidateFields)) {
        if (f.isArray) {
          configFields[k] = {
            selector: f.selector,
            attribute: f.attribute || "text",
            array: true,
          };
        } else if (f.inferredType === "number") {
          configFields[k] = {
            selector: f.selector,
            attribute: f.attribute || "text",
            transform: "number",
          };
        } else if (f.attribute && f.attribute !== "text") {
          configFields[k] = {
            selector: f.selector,
            attribute: f.attribute,
          };
        } else {
          configFields[k] = f.selector || "";
        }
      }

      const generatedConfig: ExtractorConfig = {
        name: `${tableName} Scraper`,
        tableName,
        startUrls: [targetUrl],
        itemSelector: rawSel,
        fields: configFields,
        ...(pagination && pagination.type === "next_link"
          ? { pagination: { nextPageSelector: pagination.nextPageSelector } }
          : pagination && pagination.type === "query_param"
          ? { pagination: { urlPattern: pagination.urlPattern, startPage: 1, endPage: 5 } }
          : {}),
        options: {
          concurrency: 3,
          delayMs: 200,
          maxPagesTotal: 10,
        },
      };

      candidates.push({
        id: `repeater_${candidates.length + 1}_${sanitizeIdentifier(rawSel)}`,
        title: `Repeater Collection [${rawSel}] (${matched.length} items on page)`,
        entityType: "repeater_cards",
        suggestedTableName: tableName,
        itemSelector: rawSel,
        itemCountOnPage: matched.length,
        confidence,
        fields: candidateFields,
        sampleRecords,
        pagination,
        generatedConfig,
      });
    } catch {}
  }

  candidates.sort((a, b) => {
    const isLayoutA = a.itemSelector?.includes("col") || a.itemSelector?.includes("row") || a.itemSelector?.includes("grid");
    const isLayoutB = b.itemSelector?.includes("col") || b.itemSelector?.includes("row") || b.itemSelector?.includes("grid");

    const scoreA = (isLayoutA ? -25 : 0) + Object.keys(a.fields).length * 15 + Math.min(a.itemCountOnPage, 50);
    const scoreB = (isLayoutB ? -25 : 0) + Object.keys(b.fields).length * 15 + Math.min(b.itemCountOnPage, 50);
    return scoreB - scoreA;
  });

  return candidates;
}

// 5. Single Article / Document Candidate
function discoverSingleDocumentCandidate($: cheerio.CheerioAPI, targetUrl: string): DiscoveredCandidate | null {
  const title = $("h1, title").first().text().trim();
  const desc = $('meta[name="description"]').attr("content") || $("p").first().text().trim();
  const bodyText = $("article, main, body").first().text().trim();

  if (!title && !bodyText) return null;

  const candidateFields: Record<string, DiscoveredField> = {
    title: {
      name: "title",
      selector: "h1, title",
      attribute: "text",
      inferredType: "text",
      confidence: 0.9,
      sampleValues: [title],
    },
    description: {
      name: "description",
      selector: 'meta[name="description"]@content, p',
      attribute: "text",
      inferredType: "text",
      confidence: 0.8,
      sampleValues: [desc.slice(0, 120)],
    },
    body_text: {
      name: "body_text",
      selector: "article, main",
      attribute: "text",
      inferredType: "text",
      confidence: 0.75,
      sampleValues: [bodyText.slice(0, 150) + "..."],
    },
  };

  const sampleRecord = {
    title,
    description: desc.slice(0, 120),
    body_text: bodyText.slice(0, 150) + "...",
  };

  return {
    id: "single_doc_1",
    title: `Single Page / Article Document`,
    entityType: "single_document",
    suggestedTableName: "page_details",
    itemCountOnPage: 1,
    confidence: "medium",
    fields: candidateFields,
    sampleRecords: [sampleRecord],
    generatedConfig: {
      name: "Page Details Scraper",
      tableName: "page_details",
      startUrls: [targetUrl],
      fields: {
        title: "h1, title",
        description: 'meta[name="description"]@content',
        body_text: "article, main",
      },
      options: { concurrency: 2, delayMs: 200 },
    },
  };
}

export async function runDiscovery(targetUrl: string, htmlContent?: string): Promise<DiscoveryReport> {
  const parsedUrl = new URL(targetUrl);
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

  let html = htmlContent;
  if (!html) {
    const fetchRes = await fetchHtml(targetUrl);
    html = fetchRes.html;
  }

  const $ = cheerio.load(html);
  const pageTitle = $("title").first().text().trim() || $("h1").first().text().trim() || "Untitled Page";
  const metaDescription = $('meta[name="description"]').attr("content") || undefined;

  const frameworksDetected: string[] = [];
  if ($("#__NEXT_DATA__").length > 0) frameworksDetected.push("Next.js (React)");
  if (html.includes("window.__INITIAL_STATE__")) frameworksDetected.push("Vue/Nuxt or Redux SSR");
  if (html.includes("data-reactroot") || html.includes("__remixContext")) frameworksDetected.push("React / Remix");
  if (html.includes("data-astro-cid")) frameworksDetected.push("Astro");

  const pagination = detectPagination($, targetUrl);
  const jsonLdCandidates = discoverJsonLdCandidates($, targetUrl);
  const tableCandidates = discoverTableCandidates($, targetUrl);
  const repeaterCandidates = discoverRepeaterCandidates($, targetUrl, pagination);

  const allCandidates: DiscoveredCandidate[] = [...repeaterCandidates, ...jsonLdCandidates, ...tableCandidates];

  if (allCandidates.length === 0) {
    const singleDoc = discoverSingleDocumentCandidate($, targetUrl);
    if (singleDoc) allCandidates.push(singleDoc);
  }

  const topCandidate = allCandidates[0];
  const summaryMessage = topCandidate
    ? `Discovered ${allCandidates.length} extractable entity candidates. Best match: "${topCandidate.title}" with ${Object.keys(topCandidate.fields).length} fields and ${topCandidate.itemCountOnPage} items detected on the initial page.`
    : "No repeating structured entities detected. Generated standard single document fallback.";

  return {
    targetUrl,
    baseUrl,
    pageTitle,
    metaDescription,
    frameworksDetected,
    totalCandidatesFound: allCandidates.length,
    candidates: allCandidates,
    summaryMessage,
  };
}

// CLI Execution
if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      url: { type: "string", short: "u" },
      json: { type: "boolean", short: "j", default: false },
      output: { type: "string", short: "o" },
      select: { type: "string", short: "s", default: "1" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  const targetUrl = values.url || positionals[0];

  if (values.help || !targetUrl) {
    console.log(`
Site Inspection & Data Pattern Discovery Tool (site-to-sqlite)
==============================================================
Discovers extractable repeating items, data tables, JSON-LD schemas,
and field selectors with live preview samples.

Usage:
  bun run scripts/discover.ts <url> [options]

Options:
  -u, --url <url>        Target URL to inspect
  -j, --json             Output raw JSON report
  -o, --output <file>    Save generated extraction config JSON to file
  -s, --select <index>   Select candidate index to export (default: 1)
  -h, --help             Show help message

Example:
  bun run scripts/discover.ts "https://quotes.toscrape.com" -o config.json
`);
    process.exit(0);
  }

  console.log(`\n[Step 1: Inspecting Website] Probing ${targetUrl}...`);
  const report = await runDiscovery(targetUrl);

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    if (values.output) {
      const selectedIdx = parseInt(values.select || "1", 10) - 1;
      const chosen = report.candidates[selectedIdx] || report.candidates[0];
      if (chosen) {
        await Bun.write(values.output, JSON.stringify(chosen.generatedConfig, null, 2));
        console.error(`Saved candidate #${selectedIdx + 1} config to ${values.output}`);
      }
    }
    process.exit(0);
  }

  // Visual Terminal Output
  console.log("\n================================================================================");
  console.log(`🔍 DISCOVERY REPORT: ${report.pageTitle}`);
  console.log(`   Target URL:   ${report.targetUrl}`);
  console.log(`   Frameworks:   ${report.frameworksDetected.join(", ") || "Standard HTML / SSR"}`);
  console.log(`   Found:        ${report.totalCandidatesFound} Candidate Scraping Targets`);
  console.log("================================================================================\n");

  report.candidates.forEach((cand, idx) => {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`Candidate #${idx + 1}: ${cand.title}`);
    console.log(`  Type:           ${cand.entityType} | Confidence: ${cand.confidence.toUpperCase()}`);
    console.log(`  Suggested Table: "${cand.suggestedTableName}" | Items on Page: ~${cand.itemCountOnPage}`);
    if (cand.itemSelector) console.log(`  Item Selector:  ${cand.itemSelector}`);
    if (cand.pagination?.type !== "none") {
      console.log(`  Pagination:     ${cand.pagination?.type} (${cand.pagination?.nextPageSelector || cand.pagination?.urlPattern})`);
    }

    console.log(`\n  Fields Detected (${Object.keys(cand.fields).length} total):`);
    console.table(
      Object.values(cand.fields).map((f) => ({
        "Field Name": f.name,
        "CSS Selector / Path": f.selector || "(self)",
        Attribute: f.attribute || "text",
        Type: f.inferredType,
        "Confidence": `${Math.round(f.confidence * 100)}%`,
        "Live Sample": Array.isArray(f.sampleValues[0]) ? `[${f.sampleValues[0].join(", ")}]` : String(f.sampleValues[0] || "").slice(0, 45),
      }))
    );

    if (cand.sampleRecords.length > 0) {
      console.log(`\n  Live Sample Record Preview (Item 1):`);
      console.dir(cand.sampleRecords[0], { depth: 3, colors: true });
    }
  });

  console.log("\n================================================================================");
  console.log(`💡 Step 1 Complete (Data Discovery & Proposal)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`1. Review the fields and candidate list with the user for confirmation.`);
  console.log(`2. Export the chosen config: bun run bin/site-to-sqlite.ts discover "${targetUrl}" -o config.json`);
  console.log(`3. Proceed to Step 2:        bun run bin/site-to-sqlite.ts scrape --config config.json --db data.sqlite`);
  console.log("================================================================================\n");

  if (values.output) {
    const selectedIdx = parseInt(values.select || "1", 10) - 1;
    const chosen = report.candidates[selectedIdx] || report.candidates[0];
    if (chosen) {
      await Bun.write(values.output, JSON.stringify(chosen.generatedConfig, null, 2));
      console.log(`[Config Saved] Successfully wrote ready-to-run configuration to: ${values.output}\n`);
    }
  }
}
