#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    db: { type: "string", short: "d" },
    table: { type: "string", short: "t" },
    limit: { type: "string", short: "l", default: "5" },
    exportJson: { type: "string", short: "j" },
    exportCsv: { type: "string", short: "c" },
    query: { type: "string", short: "q" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
SQLite Database Inspector & Exporter (site-to-sqlite)
Usage:
  bun run scripts/inspect-db.ts [dbPath] [options]
  bun run scripts/inspect-db.ts -d <dbPath> [options]

Options:
  -d, --db <file>          Path to SQLite database (default: data.sqlite)
  -t, --table <name>       Inspect specific table or export it
  -l, --limit <num>        Number of sample rows to print (default: 5)
  -j, --exportJson <file>  Export table rows to JSON file
  -c, --exportCsv <file>   Export table rows to CSV file
  -q, --query <sql>        Execute arbitrary SQL SELECT query
  -h, --help               Show help message
`);
  process.exit(0);
}

const dbPath = values.db || positionals[0] || "data.sqlite";
const file = Bun.file(dbPath);
if (!(await file.exists())) {
  console.error(`❌ SQLite database file not found at: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

if (values.query) {
  try {
    const rows = db.prepare(values.query).all();
    console.log(`\nQuery: ${values.query}`);
    console.log(`Results: ${rows.length} rows\n`);
    console.table(rows.slice(0, parseInt(values.limit || "20", 10)));
  } catch (err: any) {
    console.error("SQL Error:", err.message);
  }
  db.close();
  process.exit(0);
}

// Get all tables
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
  .all() as { name: string }[];

console.log("\n=======================================================");
console.log(`📊 SQLITE DATABASE SUMMARY: ${dbPath}`);
console.log("=======================================================");

for (const { name } of tables) {
  const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${name}";`).get() as { count: number };
  const cols = db.prepare(`PRAGMA table_info("${name}");`).all() as { name: string; type: string }[];
  
  console.log(`\n📁 Table: [${name}] — Total Rows: ${countRow.count}`);
  console.log(`   Columns: ${cols.map((c) => `${c.name} (${c.type})`).join(", ")}`);

  const sampleLimit = parseInt(values.limit || "5", 10);
  if (countRow.count > 0 && sampleLimit > 0) {
    const samples = db.prepare(`SELECT * FROM "${name}" LIMIT ?;`).all(sampleLimit);
    console.log(`   Sample Rows (top ${samples.length}):`);
    console.dir(samples, { depth: 3, colors: true });
  }

  // Handle exports
  if (values.table === name || (!values.table && name !== "crawled_urls")) {
    if (values.exportJson) {
      const allRows = db.prepare(`SELECT * FROM "${name}";`).all();
      await Bun.write(values.exportJson, JSON.stringify(allRows, null, 2));
      console.log(`\n💾 Exported ${allRows.length} rows from [${name}] to JSON: ${values.exportJson}`);
    }

    if (values.exportCsv) {
      const allRows = db.prepare(`SELECT * FROM "${name}";`).all() as Record<string, any>[];
      if (allRows.length > 0) {
        const headers = Object.keys(allRows[0]);
        const csvRows = [headers.join(",")];
        for (const r of allRows) {
          const vals = headers.map((h) => {
            const v = r[h];
            if (v === null || v === undefined) return '""';
            return `"${String(v).replace(/"/g, '""')}"`;
          });
          csvRows.push(vals.join(","));
        }
        await Bun.write(values.exportCsv, csvRows.join("\n"));
        console.log(`\n💾 Exported ${allRows.length} rows from [${name}] to CSV: ${values.exportCsv}`);
      }
    }
  }
}

console.log("\n=======================================================\n");
db.close();
