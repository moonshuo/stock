import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(
  root,
  ".ths-py312",
  "Lib",
  "site-packages",
  "qstock",
  "data",
  "util.py",
);
const outputPath = resolve(root, "data", "ths_fine_industry_catalog.json");
const source = await readFile(sourcePath, "utf8");
const industries = [];
const pattern = /^\s*["'](884\d{3})["']\s*:\s*["']([^"']+)["']\s*,?\s*$/gm;
for (const match of source.matchAll(pattern)) {
  industries.push({ code: match[1], name: match[2] });
}
if (!industries.length) throw new Error("没有读取到同花顺 884 细分行业");
await mkdir(resolve(root, "data"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  version: "1.0",
  source: "qstock 内置同花顺 884 行业代码表",
  industries,
}, null, 2)}\n`, "utf8");
console.log(`已导出 ${industries.length} 个同花顺细分行业：${outputPath}`);
