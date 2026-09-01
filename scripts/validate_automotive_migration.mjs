import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.name.endsWith('.json')) { try { read(full); } catch (e) { errors.push(`JSON parse failure: ${full}: ${e.message}`); } }
  }
}
if (!process.argv.includes('--skip-json-tree')) walk(dataDir);
const taxonomy = read(path.join(dataDir, 'sector_taxonomy.json'));
const stockMap = read(path.join(dataDir, 'stock_sector_map.json'));
const primary = new Map(taxonomy.sectors.map((s) => [s.name, new Map(s.secondary_sectors.map((x) => [x.name, new Set(x.tertiary_sectors)]))]));
const required = ['整车制造', '动力与传动', '底盘与车身', '汽车电子与智能化', '热管理', '安全与内饰', '轮胎与橡胶部件', '汽车后市场与补能'];
const auto = primary.get('汽车产业链');
if (!auto) errors.push('Missing 汽车产业链 primary sector');
else for (const name of required) if (!auto.has(name)) errors.push(`Missing automotive secondary sector: ${name}`);
const forbidden = new Set(['汽车零部件']);
const manualShouldNotAuto = new Set(['002501', '002547', '002674', '002686', '002988', '002993', '003033', '300828', '300968', '600219', '601677', '601702', '603271', '603725', '603917', '600841']);
const upstreamPairs = [
  ...['002815', '300814', '301132', '301282', '603175', '603459', '603920', '605258'].map((x) => [x, 'PCB']),
  ...['300507', '300552', '300643', '603121', '603286', '688665'].map((x) => [x, '传感器']),
  ...['603286', '603328', '603376', '603633', '605333', '688800'].map((x) => [x, '连接器']),
  ...['002355', '002766', '002813', '002869', '002881', '002920', '002970', '300552', '300638', '603023', '603236'].map((x) => [x, '通信模组']),
  ...['002074', '002245', '002324', '002594', '300438', '300530', '300750', '301121', '600152', '600869', '603031', '688063'].map((x) => [x, '动力电池'])
];
const upstreamPaths = new Map();
for (const [code, secondary] of upstreamPairs) upstreamPaths.set(code, [...(upstreamPaths.get(code) ?? []), secondary]);
for (const stock of stockMap.stocks) {
  if (!/^\d{6}$/.test(stock.code)) errors.push(`Invalid stock code: ${stock.code}`);
  for (const c of stock.classifications) {
    if (!c.primary_sector || !c.secondary_sector || !Array.isArray(c.tertiary_sectors) || !c.tertiary_sectors.length || c.tertiary_sectors.some((x) => !x)) errors.push(`Empty classification field: ${stock.code}`);
    const secondary = primary.get(c.primary_sector)?.get(c.secondary_sector);
    if (!secondary) errors.push(`Invalid primary/secondary: ${stock.code} ${c.primary_sector}|${c.secondary_sector}`);
    else for (const t of c.tertiary_sectors) if (!secondary.has(t)) errors.push(`Invalid tertiary: ${stock.code} ${c.primary_sector}|${c.secondary_sector}|${t}`);
    if (forbidden.has(c.secondary_sector)) errors.push(`Legacy automotive-parts path remains: ${stock.code}`);
    if (c.secondary_sector === '汽车整车与出行' && !c.tertiary_sectors.every((x) => x === '城市交通运营')) errors.push(`Unexpected legacy vehicle-and-mobility path: ${stock.code}`);
  }
  if (manualShouldNotAuto.has(stock.code) && stock.classifications.some((c) => c.primary_sector === '汽车产业链')) errors.push(`Manual-review upstream stock received automotive classification: ${stock.code}`);
  for (const requiredSecondary of upstreamPaths.get(stock.code) ?? []) {
    if (!stock.classifications.some((c) => c.secondary_sector === requiredSecondary)) errors.push(`Upstream classification lost: ${stock.code}|${requiredSecondary}`);
  }
}
if (stockMap.stocks.length !== 2322) errors.push(`Stock count changed: ${stockMap.stocks.length}`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(JSON.stringify({ valid: true, stock_count: stockMap.stocks.length, checked_json_tree: dataDir }, null, 2));
