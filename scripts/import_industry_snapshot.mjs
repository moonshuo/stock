import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const taxonomyPath = resolve(root, "data", "sector_taxonomy.json");
const stockMapPath = resolve(root, "data", "stock_sector_map.json");
const snapshotPath = resolve(root, "data", "imports", "ths_fine_industry_snapshot.json");
const reportPath = resolve(root, "data", "imports", "industry_import_report.json");

const [taxonomy, stockMap, snapshot] = await Promise.all([
  readFile(taxonomyPath, "utf8").then(JSON.parse),
  readFile(stockMapPath, "utf8").then(JSON.parse),
  readFile(snapshotPath, "utf8").then(JSON.parse),
]);

const secondaryByPath = new Map();
for (const primary of taxonomy.sectors || []) {
  for (const secondary of primary.secondary_sectors || []) {
    secondaryByPath.set(`${primary.name}|${secondary.name}`, { primary, secondary });
  }
}

let createdUnclassifiedDirectories = 0;
let createdStocks = 0;
let addedAssignments = 0;
let existingAssignments = 0;
const resolvedIndustries = [];
const skippedIndustries = [
  ...(snapshot.unresolved_industries || []).map((item) => ({
    code: item.code,
    name: item.name,
    reason: item.reason,
  })),
  ...(snapshot.errors || []).map((item) => ({
    code: item.code,
    name: item.name,
    reason: `抓取失败：${item.error}`,
  })),
];

for (const industry of snapshot.industries || []) {
  const target = industry.target;
  const taxonomyTarget = secondaryByPath.get(`${target.primary}|${target.secondary}`);
  if (!taxonomyTarget) {
    skippedIndustries.push({
      code: industry.code,
      name: industry.name,
      reason: "快照目标在当前目录中不存在",
    });
    continue;
  }

  if (!taxonomyTarget.secondary.tertiary_sectors.includes(target.tertiary)) {
    if (target.tertiary !== "未分类") {
      skippedIndustries.push({
        code: industry.code,
        name: industry.name,
        reason: "明确三级目标在当前目录中不存在",
      });
      continue;
    }
    taxonomyTarget.secondary.tertiary_sectors.push("未分类");
    createdUnclassifiedDirectories += 1;
  }

  resolvedIndustries.push({
    industry_code: industry.code,
    industry_name: industry.name,
    primary: target.primary,
    secondary: target.secondary,
    tertiary: target.tertiary,
    resolution: target.resolution,
    stock_count: industry.constituents.length,
  });

  for (const constituent of industry.constituents || []) {
    let stock = stockMap.stocks.find((item) => item.code === constituent.code);
    if (!stock) {
      stock = {
        code: constituent.code,
        name: constituent.name,
        primary_sector: target.primary,
        classifications: [],
        product_tags: [],
        reason: `${industry.name}行业成分股自动补入，待后续人工复核。`,
      };
      stockMap.stocks.push(stock);
      createdStocks += 1;
    }

    stock.name ||= constituent.name;
    stock.primary_sector ||= target.primary;
    let classification = (stock.classifications || []).find(
      (item) =>
        (item.primary_sector || stock.primary_sector) === target.primary
        && item.secondary_sector === target.secondary,
    );
    if (!classification) {
      classification = {
        primary_sector: target.primary,
        secondary_sector: target.secondary,
        tertiary_sectors: [],
        relevance_score: target.tertiary === "未分类" ? 0.6 : 0.85,
        source_refs: [],
      };
      stock.classifications ||= [];
      stock.classifications.push(classification);
    }

    if (!classification.tertiary_sectors.includes(target.tertiary)) {
      classification.tertiary_sectors.push(target.tertiary);
      addedAssignments += 1;
    } else {
      existingAssignments += 1;
    }
    classification.source_refs = Array.from(new Set([
      ...(classification.source_refs || []),
      `同花顺细分行业：${industry.name}（${industry.code}）`,
    ]));
  }
}

stockMap.stocks.sort((a, b) => a.code.localeCompare(b.code));
const report = {
  mode: dryRun ? "dry-run" : "write",
  imported_at: new Date().toISOString(),
  source: snapshot.source,
  source_snapshot: "data/imports/ths_fine_industry_snapshot.json",
  resolved_industries: resolvedIndustries,
  skipped_industries: skippedIndustries,
  created_unclassified_directories: createdUnclassifiedDirectories,
  created_stocks: createdStocks,
  added_assignments: addedAssignments,
  existing_assignments: existingAssignments,
};

await mkdir(resolve(root, "data", "imports"), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (!dryRun) {
  await Promise.all([
    writeFile(taxonomyPath, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8"),
    writeFile(stockMapPath, `${JSON.stringify(stockMap, null, 2)}\n`, "utf8"),
  ]);
}

console.log(`${dryRun ? "预演" : "写入"}完成：`);
console.log(`安全映射行业 ${resolvedIndustries.length} 个，跳过 ${skippedIndustries.length} 个。`);
console.log(`新增“未分类”目录 ${createdUnclassifiedDirectories} 个。`);
console.log(`新增股票 ${createdStocks} 只，新增分类归属 ${addedAssignments} 条。`);
console.log(reportPath);
