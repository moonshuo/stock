import fs from 'node:fs';
import path from 'node:path';

const mapPath = path.resolve('data', 'stock_sector_map.json');
const auditPath = path.resolve('data', 'limit_up_scans', 'limit_up_business_audit_2025_2026.json');
const library = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

// classify_limitup_candidates_2025_2026.mjs 只对当时库中不存在的代码新增；
// 审计中 status=classified 是这次扫描的完整新增清单，不能按当前标签反推，避免漏掉后来被改路径的股票。
const addedCodes = new Set(audit.audits.filter((item) => item.status === 'classified').map((item) => item.code));
const before = library.stocks.length;
library.stocks = library.stocks.filter((stock) => !addedCodes.has(stock.code));
fs.writeFileSync(mapPath, `${JSON.stringify(library, null, 2)}\n`);
console.log(JSON.stringify({ scanAdditionsRecorded: addedCodes.size, removedNow: before - library.stocks.length, remainingStocks: library.stocks.length }, null, 2));
