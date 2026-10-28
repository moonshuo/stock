import { createRequire } from "node:module";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const require = createRequire(import.meta.url);
const duckdb = require("duckdb");
const root = process.cwd();
const outDir = path.join(root, "data", "limit_up_scans");
const outFile = path.join(outDir, "limit_ups_2025_2026.json");
const db = new duckdb.Database(":memory:");
const readAll = (sql) => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows || [])));
const normalize = (value) => String(value || "").replace(/\D/g, "").padStart(6, "0").slice(-6);

const results = [];
for (const year of ["2025", "2026"]) {
  const parquet = path.join(root, "5分钟数据", year, "*.parquet").replace(/\\/g, "/").replace(/'/g, "''");
  const sql = `
    with daily as (
      select
        regexp_extract(code, '([0-9]{6})', 1) as code,
        date,
        min_by(pre_close, trade_time) as previous_close,
        max_by(close, trade_time) as final_close
      from read_parquet('${parquet}', union_by_name=true)
      where close is not null and pre_close is not null and pre_close > 0
      group by code, date
    )
    select code, date, previous_close, final_close,
      round((final_close / previous_close - 1) * 100, 4) as pct_change
    from daily
    where final_close / previous_close >= 1.095
    order by date, code
  `;
  const rows = await readAll(sql);
  results.push(...rows.map((row) => ({ code: normalize(row.code), date: String(row.date), pct_change: Number(row.pct_change) })));
  console.log(`${year}: ${rows.length} 条收盘涨停候选`);
}
const byCode = new Map();
for (const row of results) {
  const item = byCode.get(row.code) || { code: row.code, limit_up_days: 0, first_date: row.date, last_date: row.date, samples: [] };
  item.limit_up_days += 1;
  if (row.date < item.first_date) item.first_date = row.date;
  if (row.date > item.last_date) item.last_date = row.date;
  if (item.samples.length < 8) item.samples.push({ date: row.date, pct_change: row.pct_change });
  byCode.set(row.code, item);
}
await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify({
  generated_at: new Date().toISOString(),
  scope: "2025全年及2026年本地可用交易日",
  method: "按5分钟行情日末收盘价相对当日首笔昨收价涨幅>=9.5%筛选；不含仅盘中触及涨停后回落的股票",
  total_limit_up_records: results.length,
  unique_stocks: byCode.size,
  stocks: [...byCode.values()].sort((a, b) => b.limit_up_days - a.limit_up_days || a.code.localeCompare(b.code))
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ total_limit_up_records: results.length, unique_stocks: byCode.size, output: path.relative(root, outFile) }, null, 2));
