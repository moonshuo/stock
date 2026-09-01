import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeStockMap, validateSectorData } from "../app/lib/sectorSystem.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = (...parts) => path.join(root, "data", ...parts);
const read = (name) => JSON.parse(fs.readFileSync(data(name), "utf8"));
const write = (name, value) => fs.writeFileSync(data(name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const copy = (from, to) => fs.copyFileSync(data(from), data(to));
const dailyThemesDir = data("daily_themes");

const oldSecondaries = new Set(["城市交通与出行服务", "物流与供应链服务", "航运与港口物流", "航空运输"]);
const addedSecondaries = ["公路运输", "铁路与轨道运输"];
const addedTertiaries = ["高速公路运营", "道路客货运输", "集装箱航运", "机场运营", "铁路运输", "城市轨道交通运营"];
const transportDirectory = [
  ["公路运输", ["高速公路运营", "道路客货运输"]],
  ["城市交通与出行服务", ["城市交通运营"]],
  ["物流与供应链服务", ["综合物流与供应链管理", "跨境供应链服务", "产业供应链服务"]],
  ["航运与港口物流", ["干散货航运", "集装箱航运", "港口装卸与综合物流"]],
  ["航空运输", ["航空客运", "机场运营"]],
  ["铁路与轨道运输", ["铁路运输", "城市轨道交通运营"]],
];
const candidateTerms = ["高速", "收费公路", "机场", "铁路运输", "铁路客运", "地铁", "轨道交通运营", "集装箱", "道路客运", "道路货运", "公交", "出租车", "航运"];

const taxonomy = read("sector_taxonomy.json");
const stockMap = read("stock_sector_map.json");
const beforeTaxonomy = structuredClone(taxonomy);
const beforeStocks = structuredClone(stockMap);
const dailyThemeFiles = fs.readdirSync(dailyThemesDir).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
const dailyThemes = dailyThemeFiles.map((file) => JSON.parse(fs.readFileSync(path.join(dailyThemesDir, file), "utf8")));
copy("sector_taxonomy.json", "taxonomy_before.json");
copy("stock_sector_map.json", "stocks_before.json");

const consumer = taxonomy.sectors.find((sector) => sector.name === "消费");
if (!consumer) throw new Error("找不到一级主线：消费");
const oldSecondaryByName = new Map((consumer.secondary_sectors || []).filter((secondary) => oldSecondaries.has(secondary.name)).map((secondary) => [secondary.name, secondary]));
if (oldSecondaryByName.size !== oldSecondaries.size) {
  throw new Error(`消费下待迁移二级目录不完整：${[...oldSecondaries].filter((name) => !oldSecondaryByName.has(name)).join("、")}`);
}

const descriptions = new Map();
for (const secondary of oldSecondaryByName.values()) {
  for (const [tertiary, description] of Object.entries(secondary.tertiary_descriptions || {})) {
    descriptions.set(`${secondary.name}|${tertiary}`, description);
  }
}
const transportSector = {
  name: "交通运输",
  secondary_sectors: transportDirectory.map(([name, tertiary_sectors]) => ({
    name,
    tertiary_sectors,
    tertiary_descriptions: Object.fromEntries(tertiary_sectors
      .map((tertiary) => [tertiary, descriptions.get(`${name}|${tertiary}`)])
      .filter(([, description]) => description)),
  })),
};
const existingTransportIndex = taxonomy.sectors.findIndex((sector) => sector.name === "交通运输");
if (existingTransportIndex >= 0) taxonomy.sectors.splice(existingTransportIndex, 1, transportSector);
else taxonomy.sectors.push(transportSector);
taxonomy.version = `${String(taxonomy.version || "1.0").replace(/(?:-transport-migration)?$/, "")}-transport-migration`;

const moved = [];
for (const stock of stockMap.stocks) {
  stock.classifications = (stock.classifications || []).map((classification) => {
    const primary = classification.primary_sector || stock.primary_sector;
    if (primary !== "消费" || !oldSecondaries.has(classification.secondary_sector)) return classification;
    const after = { ...classification, primary_sector: "交通运输" };
    moved.push({
      code: stock.code,
      name: stock.name,
      from: { primary_sector: "消费", secondary_sector: classification.secondary_sector, tertiary_sectors: [...(classification.tertiary_sectors || [])] },
      to: { primary_sector: "交通运输", secondary_sector: classification.secondary_sector, tertiary_sectors: [...(classification.tertiary_sectors || [])] },
      relevance_score: classification.relevance_score,
    });
    return after;
  });
}

const remainingOldReferences = stockMap.stocks.flatMap((stock) => (stock.classifications || [])
  .filter((classification) => (classification.primary_sector || stock.primary_sector) === "消费" && oldSecondaries.has(classification.secondary_sector))
  .map((classification) => `${stock.code}|${classification.secondary_sector}`));
if (remainingOldReferences.length) throw new Error(`旧消费目录仍被引用：${remainingOldReferences.slice(0, 5).join("、")}`);
consumer.secondary_sectors = consumer.secondary_sectors.filter((secondary) => !oldSecondaries.has(secondary.name));

const movedDailyThemes = [];
for (const daily of dailyThemes) {
  for (const theme of daily.themes || []) {
    if (theme.primary_sector !== "消费" || !oldSecondaries.has(theme.secondary_sector)) continue;
    movedDailyThemes.push({ date: daily.date, name: theme.name, secondary_sector: theme.secondary_sector });
    theme.primary_sector = "交通运输";
  }
}

const movedCodes = new Set(moved.map((item) => item.code));
const candidates = stockMap.stocks.flatMap((stock) => {
  const text = [stock.name, ...(stock.product_tags || []), stock.reason, ...(stock.classifications || []).flatMap((classification) => [classification.secondary_sector, ...(classification.tertiary_sectors || [])])].join(" ");
  const matched_terms = candidateTerms.filter((term) => text.includes(term));
  if (!matched_terms.length || movedCodes.has(stock.code)) return [];
  return [{
    code: stock.code,
    name: stock.name,
    matched_terms,
    current_classifications: stock.classifications || [],
    status: "unresolved",
    note: "仅按交通关键词筛出，未在本次目录迁移中自动改变分类；需人工确认是否属于运输运营而非装备制造或制造企业自有物流。",
  }];
});
const stockNameMap = read("stock_name_map.json");
if (!stockMap.stocks.some((stock) => stock.code === "000429")) {
  candidates.unshift({
    code: "000429",
    name: stockNameMap.names?.["000429"] || "粤高速A",
    matched_terms: ["收费公路", "高速公路运营"],
    current_classifications: [],
    recommended_classification: {
      primary_sector: "交通运输",
      secondary_sector: "公路运输",
      tertiary_sectors: ["高速公路运营"],
      relevance_score: 1.0,
    },
    status: "unresolved",
    note: "当前不在 stock_sector_map.json。为保持本次迁移前后股票总数一致，未新增股票记录；该路径已创建，可在该股票进入分类库时直接采用。",
  });
}

const validation = validateSectorData(taxonomy, sanitizeStockMap(stockMap), dailyThemes);
const duplicateClassifications = [];
for (const stock of stockMap.stocks) {
  const seen = new Set();
  for (const classification of stock.classifications || []) {
    for (const tertiary of classification.tertiary_sectors || []) {
      const key = `${classification.primary_sector || stock.primary_sector}|${classification.secondary_sector}|${tertiary}`;
      if (seen.has(key)) duplicateClassifications.push(`${stock.code}|${key}`);
      seen.add(key);
    }
  }
}
const beforeByCode = new Map(beforeStocks.stocks.map((stock) => [stock.code, stock]));
const unrelatedChanges = stockMap.stocks.filter((stock) => {
  const before = beforeByCode.get(stock.code);
  if (!before) return true;
  const expected = structuredClone(before);
  expected.classifications = expected.classifications.map((classification) =>
    (classification.primary_sector || expected.primary_sector) === "消费" && oldSecondaries.has(classification.secondary_sector)
      ? { ...classification, primary_sector: "交通运输" }
      : classification);
  return JSON.stringify(expected) !== JSON.stringify(stock);
}).map((stock) => stock.code);
const validationErrors = [
  ...validation.errors,
  ...(stockMap.stocks.length === beforeStocks.stocks.length ? [] : [`股票总数变化：${beforeStocks.stocks.length} → ${stockMap.stocks.length}`]),
  ...duplicateClassifications.map((item) => `重复 classification：${item}`),
  ...unrelatedChanges.map((code) => `无关股票发生变化：${code}`),
];

const report = {
  new_primary_sector: "交通运输",
  moved_stock_count: new Set(moved.map((item) => item.code)).size,
  moved_classification_count: moved.length,
  moved_dynamic_theme_count: movedDailyThemes.length,
  newly_classified_stock_count: 0,
  added_secondary_sectors: addedSecondaries,
  added_tertiary_sectors: addedTertiaries,
  removed_old_secondary_sectors: [...oldSecondaries],
  stock_count_before: beforeStocks.stocks.length,
  stock_count_after: stockMap.stocks.length,
  unresolved_candidate_count: candidates.filter((candidate) => candidate.status === "unresolved").length,
  validation_errors: validationErrors,
};
const diff = {
  taxonomy: {
    transport_primary_previously_present: existingTransportIndex >= 0,
    added_or_rebuilt_primary: "交通运输",
    removed_from_consumer: [...oldSecondaries],
  },
  moved_classifications: moved,
  moved_dynamic_themes: movedDailyThemes,
  newly_classified_stocks: [],
  unresolved_candidates: candidates.filter((candidate) => candidate.status === "unresolved").map((candidate) => ({ code: candidate.code, name: candidate.name, matched_terms: candidate.matched_terms })),
  invariant_checks: {
    stock_count_unchanged: stockMap.stocks.length === beforeStocks.stocks.length,
    product_tags_unchanged: unrelatedChanges.length === 0,
    relevance_preserved_for_moves: moved.every((item) => {
      const stock = stockMap.stocks.find((candidate) => candidate.code === item.code);
      return stock?.classifications.some((classification) => classification.primary_sector === "交通运输" && classification.secondary_sector === item.to.secondary_sector && classification.relevance_score === item.relevance_score);
    }),
    old_consumer_references_remaining: remainingOldReferences.length,
    duplicate_classification_count: duplicateClassifications.length,
  },
};

if (validationErrors.length) throw new Error(`迁移校验失败：${validationErrors.slice(0, 10).join("；")}`);
write("sector_taxonomy.json", taxonomy);
write("stock_sector_map.json", stockMap);
const collections = read("sector_collections.json");
const informationTechnology = collections.collections?.find((collection) => collection.name === "信息科技产业链");
if (informationTechnology && !informationTechnology.primary_sectors.includes("交通运输")) {
  informationTechnology.primary_sectors.push("交通运输");
}
write("sector_collections.json", collections);
for (let index = 0; index < dailyThemeFiles.length; index += 1) {
  fs.writeFileSync(path.join(dailyThemesDir, dailyThemeFiles[index]), `${JSON.stringify(dailyThemes[index], null, 2)}\n`, "utf8");
}
write("taxonomy_after.json", taxonomy);
write("stocks_after.json", stockMap);
write("transport_candidates.json", { generated_at: new Date().toISOString(), candidates });
write("transport_migration_report.json", report);
write("transport_migration_diff.json", diff);
console.log(JSON.stringify(report, null, 2));
