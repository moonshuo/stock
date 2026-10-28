import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('data', 'stock_sector_map.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const byCode = new Map(data.stocks.map((stock) => [stock.code, stock]));

function replaceWith(stock, classification, tags, reason) {
  stock.primary_sector = classification.primary_sector;
  stock.classifications = [classification];
  stock.product_tags = tags;
  stock.reason = reason;
}

const sfd = byCode.get('300179');
if (sfd) replaceWith(sfd, {
  primary_sector: '新材料', secondary_sector: '前沿新材料', tertiary_sectors: ['先进结构材料'], relevance_score: 0.8,
  source_refs: ['同花顺F10主营业务核验']
}, ['超硬材料', 'CVD金刚石', '复合超硬材料'], '主营为超硬材料及相关制品；CVD金刚石属于材料产品，不是半导体薄膜沉积设备。');

const hg = byCode.get('301662');
if (hg) replaceWith(hg, {
  primary_sector: '锂电产业链', secondary_sector: '锂电设备', tertiary_sectors: ['前段设备'], relevance_score: 0.85,
  source_refs: ['同花顺F10主营业务核验']
}, ['锂电池产线设备', '制浆设备', '粉体处理设备'], '主营为散装物料自动化处理产线及设备，核心产品包括锂电池制浆及前段产线设备；CVD流化床不构成半导体设备业务。');

// 恒盛能源主营热电联产与固废资源综合利用，现有目录没有与其匹配的长期主线；不强行保留。
data.stocks = data.stocks.filter((stock) => stock.code !== '605580');

fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({ corrected: ['300179', '301662'], removed: ['605580'], totalStocks: data.stocks.length }, null, 2));
