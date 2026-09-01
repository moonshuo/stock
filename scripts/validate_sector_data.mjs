import { readFile, readdir } from "fs/promises";
import path from "path";
import { validateSectorData } from "../app/lib/sectorSystem.js";

const cwd = process.cwd();
const dataDir = path.join(cwd, "data");

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function readDailyThemes() {
  const dir = path.join(dataDir, "daily_themes");
  try {
    const files = (await readdir(dir)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
    return Promise.all(files.map((file) => readJson(path.join(dir, file))));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  const [taxonomy, stockMap, dailyThemes] = await Promise.all([
    readJson(path.join(dataDir, "sector_taxonomy.json")),
    readJson(path.join(dataDir, "stock_sector_map.json")),
    readDailyThemes()
  ]);
  const validation = validateSectorData(taxonomy, stockMap, dailyThemes);

  for (const warning of validation.warnings) {
    console.warn(`WARN ${warning}`);
  }
  for (const error of validation.errors) {
    console.error(`ERROR ${error}`);
  }

  if (!validation.ok) {
    console.error(`validation failed: ${validation.errors.length} errors, ${validation.warnings.length} warnings`);
    process.exitCode = 1;
    return;
  }

  console.log(`validation passed: ${stockMap.stocks.length} stocks, ${validation.warnings.length} warnings`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
