import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.argv[2] || "https://q.10jqka.com.cn/thshy/";
let token = "";
try {
  const source = await readFile(resolve(import.meta.dirname, "..", ".ths-py312", "Lib", "site-packages", "qstock", "data", "ths.js"), "utf8");
  token = Function(`${source}; return v();`)();
} catch {}
const response = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    Referer: "https://q.10jqka.com.cn/thshy/",
    ...(token ? { Cookie: `v=${token}`, "hexin-v": token } : {}),
  },
});
const html = new TextDecoder("gbk").decode(await response.arrayBuffer());
console.log("status", response.status, "length", html.length, "url", response.url);
if (process.argv.includes("--raw")) {
  console.log(html);
  process.exit(0);
}
console.log("scripts", Array.from(html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi), (match) => match[1]));
for (const pattern of process.argv.slice(3)) {
  const index = html.indexOf(pattern);
  console.log("pattern", pattern, "index", index, index >= 0 ? html.slice(Math.max(0, index - 500), index + 800) : "");
}
const links = [];
for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
  const href = match[1];
  const text = match[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  if (/thshy\/detail\/code\/\d+/i.test(href)) links.push({ href, text });
}
console.log(JSON.stringify(links, null, 2));
