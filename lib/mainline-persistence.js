import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function themeKey(theme = {}) {
  return theme.key || `${theme.primary || ""}__${theme.name || ""}`;
}

function compactThemeForDisk(theme = {}) {
  const { score_history: scoreHistory, ...compact } = theme;
  const history = Array.isArray(scoreHistory) ? scoreHistory : [];
  return {
    ...compact,
    score_history_summary: {
      points: history.length,
      first_date: history[0]?.date || null,
      last_date: history.at(-1)?.date || null,
      latest: history.at(-1) || null,
    },
  };
}

function compactAutomaticModules(modules = {}) {
  const capacity = modules.capacity && typeof modules.capacity === "object" ? modules.capacity : {};
  const leader = modules.leader && typeof modules.leader === "object" ? modules.leader : {};
  return {
    requested: Number(modules.requested) || 0,
    completed_capacity: Object.keys(capacity).length,
    completed_leader: Object.keys(leader).length,
    failures: Array.isArray(modules.failures) ? modules.failures : [],
    concurrency: Number(modules.concurrency) || 0,
    selection: modules.selection || null,
    minimum_valid_members: Number(modules.minimum_valid_members) || null,
    message: modules.message || null,
  };
}

export function createMainlineDiskSnapshot(result = {}) {
  const {
    themes,
    all_themes: allThemes,
    requested_theme: requestedTheme,
    mainline,
    automatic_modules: automaticModules,
    ...metadata
  } = result;
  const canonicalThemes = Array.isArray(allThemes) ? allThemes : (Array.isArray(themes) ? themes : []);
  const mainlineKeys = Object.fromEntries(Object.entries(mainline || {}).map(([status, values]) => [
    `${status}_theme_keys`,
    Array.isArray(values) ? values.map(themeKey) : values,
  ]));
  return {
    storage_schema_version: 1,
    ...metadata,
    themes: canonicalThemes.map(compactThemeForDisk),
    requested_theme_key: requestedTheme ? themeKey(requestedTheme) : null,
    mainline: mainlineKeys,
    automatic_modules: compactAutomaticModules(automaticModules),
  };
}

export async function encodeMainlineResponseCache(document) {
  return gzipAsync(Buffer.from(JSON.stringify(document), "utf8"), { level: 6 });
}

export async function decodeMainlineResponseCache(buffer) {
  const decoded = await gunzipAsync(buffer);
  return JSON.parse(decoded.toString("utf8"));
}
