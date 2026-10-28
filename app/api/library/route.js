import { mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { sanitizeStockMap, validateSectorData } from "../../lib/sectorSystem";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const TAXONOMY_PATH = path.join(DATA_DIR, "sector_taxonomy.json");
const STOCK_MAP_PATH = path.join(DATA_DIR, "stock_sector_map.json");
const STOCK_NAME_MAP_PATH = path.join(DATA_DIR, "stock_name_map.json");
const COLLECTIONS_PATH = path.join(DATA_DIR, "sector_collections.json");
const DAILY_THEMES_DIR = path.join(DATA_DIR, "daily_themes");

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function writeDailyThemes(dailyThemes) {
  await mkdir(DAILY_THEMES_DIR, { recursive: true });
  await Promise.all((dailyThemes || []).map((daily) => {
    if (!daily?.date) return Promise.resolve();
    return writeJson(path.join(DAILY_THEMES_DIR, `${daily.date}.json`), daily);
  }));
}

async function readDailyThemes() {
  try {
    const files = (await readdir(DAILY_THEMES_DIR)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
    const themes = await Promise.all(files.map(async (file) => readJson(path.join(DAILY_THEMES_DIR, file))));
    return themes.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function removeEmptyTertiaries(taxonomy, stockMap) {
  const usedPaths = new Set();
  for (const stock of stockMap.stocks || []) {
    for (const classification of stock.classifications || []) {
      const primary = classification.primary_sector || stock.primary_sector;
      for (const tertiary of classification.tertiary_sectors || []) {
        usedPaths.add(`${primary}|${classification.secondary_sector}|${tertiary}`);
      }
    }
  }

  return {
    ...taxonomy,
    sectors: (taxonomy?.sectors || []).map((primary) => ({
      ...primary,
      secondary_sectors: (primary.secondary_sectors || []).map((secondary) => {
        const tertiary_sectors = (secondary.tertiary_sectors || []).filter((tertiary) =>
          usedPaths.has(`${primary.name}|${secondary.name}|${tertiary}`),
        );
        const tertiarySet = new Set(tertiary_sectors);
        return {
          ...secondary,
          tertiary_sectors,
          tertiary_descriptions: Object.fromEntries(
            Object.entries(secondary.tertiary_descriptions || {}).filter(([name]) => tertiarySet.has(name)),
          ),
        };
      }),
    })),
  };
}

function pruneOrphanedThemePaths(dailyThemes, taxonomy) {
  const validPaths = new Set(
    (taxonomy?.sectors || []).flatMap((primary) =>
      (primary.secondary_sectors || []).flatMap((secondary) =>
        (secondary.tertiary_sectors || []).map((tertiary) => `${primary.name}|${secondary.name}|${tertiary}`),
      ),
    ),
  );
  return (dailyThemes || []).map((daily) => ({
    ...daily,
    themes: (daily.themes || []).map((theme) => ({
      ...theme,
      related_tertiary_sectors: (theme.related_tertiary_sectors || []).filter((tertiary) =>
        validPaths.has(`${theme.primary_sector}|${theme.secondary_sector}|${tertiary}`),
      ),
    })),
  }));
}

export async function GET() {
  try {
    const [taxonomy, stockMap, stockNames, collections, dailyThemes] = await Promise.all([
      readJson(TAXONOMY_PATH),
      readJson(STOCK_MAP_PATH, { version: "1.0", stocks: [] }),
      readJson(STOCK_NAME_MAP_PATH, { version: "1.0", names: {} }),
      readJson(COLLECTIONS_PATH, { version: "1.0", collections: [] }),
      readDailyThemes()
    ]);
    const validation = validateSectorData(taxonomy, stockMap, dailyThemes);

    if (!validation.ok) {
      console.error("[sector-data] 校验失败", validation.errors);
    }
    if (validation.warnings.length) {
      console.warn("[sector-data] 校验警告", validation.warnings);
    }

    return NextResponse.json({
      taxonomy,
      stockMap,
      stockNames,
      collections,
      dailyThemes,
      validation,
      paths: {
        taxonomy: "data/sector_taxonomy.json",
        stockMap: "data/stock_sector_map.json",
        collections: "data/sector_collections.json",
        dailyThemes: "data/daily_themes/YYYY-MM-DD.json"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: `读取产业分类 JSON 失败：${error.message}` },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const persistedTaxonomy = await readJson(TAXONOMY_PATH);
    if (payload?.taxonomy?.version && persistedTaxonomy?.version && payload.taxonomy.version !== persistedTaxonomy.version) {
      return NextResponse.json(
        { error: "产业分类库已在其他位置更新，请刷新页面后再保存" },
        { status: 409 },
      );
    }
    const taxonomy = removeEmptyTertiaries(payload.taxonomy, sanitizeStockMap(payload.stockMap || payload));
    const stockMap = sanitizeStockMap(payload.stockMap || payload);
    const collections = payload.collections || await readJson(COLLECTIONS_PATH, { version: "1.0", collections: [] });
    const dailyThemes = pruneOrphanedThemePaths(
      Array.isArray(payload.dailyThemes) ? payload.dailyThemes : await readDailyThemes(),
      taxonomy,
    );
    const validation = validateSectorData(taxonomy, stockMap, dailyThemes);

    if (!validation.ok) {
      return NextResponse.json(
        { error: "数据校验失败", validation },
        { status: 400 }
      );
    }

    await Promise.all([
      writeJson(TAXONOMY_PATH, taxonomy),
      writeJson(STOCK_MAP_PATH, stockMap),
      writeJson(COLLECTIONS_PATH, collections),
      ...(Array.isArray(payload.dailyThemes) ? [writeDailyThemes(dailyThemes)] : [])
    ]);

    return NextResponse.json({
      ok: true,
      validation,
      taxonomy,
      dailyThemes,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      { error: `保存产业分类 JSON 失败：${error.message}` },
      { status: 400 }
    );
  }
}
