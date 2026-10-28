import { readFile, readdir, rename, writeFile } from "fs/promises";
import path from "path";
import { validateSectorData } from "../app/lib/sectorSystem.js";

const root = process.cwd();
const data = path.join(root, "data");
const readJson = async (name) => JSON.parse(await readFile(path.join(data, name), "utf8"));
const readDailyThemes = async () => {
  const directory = path.join(data, "daily_themes");
  const files = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name));
  return Promise.all(files.map((name) => readJson(path.join("daily_themes", name))));
};

async function writeJson(name, value) {
  const target = path.join(data, name);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

const [taxonomy, stockMap, dailyThemes] = await Promise.all([
  readJson("taxonomy_after.json"),
  readJson("stocks_after.json"),
  readDailyThemes(),
]);
const validation = validateSectorData(taxonomy, stockMap, dailyThemes);
if (!validation.ok) throw new Error(`拒绝发布：${validation.errors.join("；")}`);
await Promise.all([
  writeJson("sector_taxonomy.json", taxonomy),
  writeJson("stock_sector_map.json", stockMap),
]);
console.log(`已发布目录升级：${taxonomy.sectors.length} 个一级主线，${stockMap.stocks.length} 只股票。`);
