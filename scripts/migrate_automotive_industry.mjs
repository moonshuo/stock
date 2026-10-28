import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (...parts) => path.join(root, 'data', ...parts);
const read = (name) => JSON.parse(fs.readFileSync(data(name), 'utf8'));
const write = (name, value) => fs.writeFileSync(data(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const automotiveTaxonomy = {
  name: '汽车产业链',
  secondary_sectors: [
    ['整车制造', ['乘用车', '商用车', '新能源汽车']],
    ['动力与传动', ['发动机与传统动力部件', '变速器与传动系统', '电驱动系统', '混合动力系统', '汽车尾气后处理部件']],
    ['底盘与车身', ['汽车转向系统', '汽车制动系统', '汽车底盘与减震部件', '汽车车身结构件', '汽车轻量化零部件']],
    ['汽车电子与智能化', ['汽车电子控制部件', '车载传感器', '车载通信模组', '汽车连接器', '智能座舱与车载显示', 'ADAS与自动驾驶', '汽车照明系统']],
    ['热管理', ['新能源汽车热管理部件', '汽车空调与热管理系统']],
    ['安全与内饰', ['汽车安全系统部件', '汽车内饰材料']],
    ['轮胎与橡胶部件', ['汽车轮胎', '汽车橡胶密封件']],
    ['汽车后市场与补能', ['汽车销售与后市场', '新能源汽车充换电']]
  ].map(([name, tertiary_sectors]) => ({ name, tertiary_sectors, tertiary_descriptions: {} }))
};

const manualRemove = new Set(['002501', '002547', '002674', '002686', '002988', '002993', '003033', '300828', '300968', '600219', '601677', '601702', '603271', '603725', '603917', '600841']);
const keepPrimary = new Set(['000901', '001266', '002213', '002519', '002824', '002993', '300968']);
const cockpit = new Set(['002766', '002813', '002920']);
const adas = new Set(['002920']);
const lighting = new Set(['601799', '603303']);
const powerTargets = new Map([
  ['002196', ['电驱动系统']], ['002283', ['发动机与传统动力部件', '汽车底盘与减震部件']],
  ['002448', ['发动机与传统动力部件']], ['002664', ['电驱动系统']], ['002708', ['变速器与传动系统', '汽车底盘与减震部件']],
  ['600178', ['发动机与传统动力部件', '变速器与传动系统', '混合动力系统']], ['600303', ['变速器与传动系统', '汽车底盘与减震部件']],
  ['600698', ['发动机与传统动力部件']], ['603040', ['发动机与传统动力部件']], ['603121', ['发动机与传统动力部件']],
  ['603161', ['发动机与传统动力部件']], ['603178', ['变速器与传动系统']], ['603331', ['变速器与传动系统']],
  ['603758', ['发动机与传统动力部件', '变速器与传动系统', '电驱动系统', '混合动力系统']], ['603926', ['变速器与传动系统']],
  ['603950', ['发动机与传统动力部件']], ['605100', ['发动机与传统动力部件']], ['688667', ['电驱动系统', '混合动力系统']]
]);

function targetFor(code, tertiary) {
  if (tertiary === '汽车动力与传动部件') return powerTargets.get(code) ?? [];
  const mapping = {
    '新能源汽车热管理部件': ['热管理', '新能源汽车热管理部件'],
    '汽车轻量化零部件': ['底盘与车身', '汽车轻量化零部件'],
    '汽车转向系统': ['底盘与车身', '汽车转向系统'],
    '汽车车身结构件': ['底盘与车身', '汽车车身结构件'],
    '汽车内饰材料': ['安全与内饰', '汽车内饰材料'],
    '汽车安全系统部件': ['安全与内饰', '汽车安全系统部件'],
    '汽车底盘与减震部件': ['底盘与车身', '汽车底盘与减震部件'],
    '汽车尾气后处理部件': ['动力与传动', '汽车尾气后处理部件'],
    '汽车照明系统': ['汽车电子与智能化', '汽车照明系统'],
    '汽车轮胎': ['轮胎与橡胶部件', '汽车轮胎'],
    '增压器与动力机械部件': ['动力与传动', '发动机与传统动力部件']
  };
  if (tertiary === '汽车电子控制部件') {
    if (lighting.has(code)) return ['汽车电子与智能化', '汽车照明系统'];
    if (cockpit.has(code)) return ['汽车电子与智能化', '智能座舱与车载显示'];
    return ['汽车电子与智能化', '汽车电子控制部件'];
  }
  return mapping[tertiary] ?? [];
}

function addClassification(stock, template, secondary_sector, tertiary_sectors) {
  if (!tertiary_sectors.length) return;
  const existing = stock.classifications.find((c) => c.primary_sector === '汽车产业链' && c.secondary_sector === secondary_sector);
  if (existing) {
    existing.tertiary_sectors = [...new Set([...existing.tertiary_sectors, ...tertiary_sectors])];
    return;
  }
  stock.classifications.push({ ...template, primary_sector: '汽车产业链', secondary_sector, tertiary_sectors: [...new Set(tertiary_sectors)] });
}

const taxonomy = read('sector_taxonomy.json');
taxonomy.sectors = taxonomy.sectors.filter((s) => s.name !== '汽车产业链');
taxonomy.sectors.push(automotiveTaxonomy);
write('sector_taxonomy.json', taxonomy);

const collections = read('sector_collections.json');
const consumer = collections.collections.find((c) => c.name === '消费与健康');
if (!consumer.primary_sectors.includes('汽车产业链')) consumer.primary_sectors.push('汽车产业链');
write('sector_collections.json', collections);

const stockMap = read('stock_sector_map.json');
for (const stock of stockMap.stocks) {
  const obsolete = stock.classifications.filter((c) =>
    (c.primary_sector === '电子元器件' && c.secondary_sector === '汽车零部件') ||
    (c.primary_sector === '消费' && c.secondary_sector === '汽车整车与出行' && c.tertiary_sectors.some((t) => t !== '城市交通运营'))
  );
  if (!obsolete.length) continue;
  stock.classifications = stock.classifications.filter((c) => !obsolete.includes(c));
  if (!manualRemove.has(stock.code)) {
    for (const old of obsolete) {
      const bySecondary = new Map();
      for (const tertiary of old.tertiary_sectors) {
        if (old.secondary_sector === '汽车整车与出行') {
          const vehicle = tertiary === '乘用车与商用车'
            ? (stock.code === '600418' ? ['乘用车', '商用车'] : ['商用车'])
            : [tertiary];
          const secondary = ['汽车销售与后市场', '新能源汽车充换电'].includes(tertiary) ? '汽车后市场与补能' : '整车制造';
          bySecondary.set(secondary, [...(bySecondary.get(secondary) ?? []), ...vehicle]);
          continue;
        }
        if (tertiary === '汽车动力与传动部件') {
          for (const target of targetFor(stock.code, tertiary)) {
            const secondary = ['汽车底盘与减震部件'].includes(target) ? '底盘与车身' : '动力与传动';
            bySecondary.set(secondary, [...(bySecondary.get(secondary) ?? []), target]);
          }
          continue;
        }
        const target = targetFor(stock.code, tertiary);
        if (target.length) bySecondary.set(target[0], [...(bySecondary.get(target[0]) ?? []), target[1]]);
      }
      for (const [secondary, tertiaries] of bySecondary) addClassification(stock, old, secondary, tertiaries);
    }
    if (stock.code === '603655') addClassification(stock, obsolete[0], '轮胎与橡胶部件', ['汽车橡胶密封件']);
    if (adas.has(stock.code)) addClassification(stock, obsolete[0], '汽车电子与智能化', ['ADAS与自动驾驶']);
    if (stock.code === '300643') addClassification(stock, obsolete[0], '安全与内饰', ['汽车安全系统部件']);
    if (stock.code === '002355') addClassification(stock, obsolete[0], '底盘与车身', ['汽车轻量化零部件']);
  }
  const hasAuto = stock.classifications.some((c) => c.primary_sector === '汽车产业链');
  if (hasAuto && !keepPrimary.has(stock.code) && ['电子元器件', '消费'].includes(stock.primary_sector)) stock.primary_sector = '汽车产业链';
}
write('stock_sector_map.json', stockMap);

console.log(JSON.stringify({ migrated: true, stock_count: stockMap.stocks.length }, null, 2));
