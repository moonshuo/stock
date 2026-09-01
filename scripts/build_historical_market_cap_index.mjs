import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";

const root = process.cwd();
const sourceRoot = path.join(root, "data", "historical_market_cap");
const outputRoot = path.join(root, "data", "historical_market_cap_index");
const dates = process.argv.slice(2).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));

if (!dates.length) {
  console.error("Usage: node scripts/build_historical_market_cap_index.mjs YYYY-MM-DD [YYYY-MM-DD ...]");
  process.exitCode = 1;
} else {
  await mkdir(outputRoot, { recursive: true });
  for (const date of dates) {
    const directory = path.join(sourceRoot, date);
    const files = (await readdir(directory)).filter((file) => /^\d{6}\.json$/.test(file));
    const values = {};
    let cursor = 0;
    const workers = Array.from({ length: Math.min(32, files.length) }, async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        try {
          const payload = JSON.parse(await readFile(path.join(directory, file), "utf8"));
          const value = Number(payload?.free_float_market_cap);
          if (Number.isFinite(value) && value > 0) values[file.slice(0, 6)] = value;
        } catch { /* Invalid source cache stays absent and uses the runtime fallback. */ }
      }
    });
    await Promise.all(workers);
    await writeFile(path.join(outputRoot, `${date}.json`), `${JSON.stringify({ version: 1, date, source: "historical_market_cap/free_float_market_cap", values })}\n`, "utf8");
    console.log(`${date}: ${Object.keys(values).length}/${files.length}`);
  }
}
