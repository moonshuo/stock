// Unified market-data access boundary.  Consumers ask for a data *kind*;
// this module owns cache validation, source fallback and provenance.  The
// specialised loaders remain the source adapters while callers migrate to
// this stable interface.
import {
  ensureDailyTurnover,
  ensureDailyTurnoverRate,
  ensureIntraday5m,
  readCachedDailyTurnoverRate,
} from "./intraday5m.js";
import { auditHistoricalDailyQuote } from "./historical-daily-reconciliation.js";
import { readFile } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const MAX_REMOTE_CONCURRENCY = 6;
const remoteRequestsInFlight = new Map();
let activeRemoteRequests = 0;
const remoteRequestQueue = [];
const registeredMarketDataTypes = new Map();

export const MARKET_DATA_KINDS = Object.freeze([
  "intraday_5m",
  "daily_turnover",
  "daily_turnover_rate",
  "daily_quote",
]);

// Provider order is deliberately documented here, while the parsers remain
// with their data-type adapters.  A source is only accepted after the
// adapter's schema validation; failures are retained in fallback_failures.
export const MARKET_DATA_SOURCES = Object.freeze({
  intraday_5m: ["tencent_proxy", "sina", "eastmoney"],
  daily_turnover: ["tonghuashun", "sohu", "tencent", "sina"],
  daily_turnover_rate: ["tonghuashun", "eastmoney", "sohu"],
  daily_quote: ["eastmoney", "tencent", "sina"],
});

function normalizeCode(code) {
  return String(code || "").replace(/\D/g, "").padStart(6, "0").slice(-6);
}

function assertRequest({ kind, date, code }) {
  if (!MARKET_DATA_KINDS.includes(kind)) throw new Error(`Unsupported market data kind: ${kind}`);
  const digits = String(code || "").replace(/\D/g, "");
  if (!digits || digits.length > 6 || normalizeCode(code) === "000000") throw new Error("market data code must be a valid A-share code");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("market data date must be YYYY-MM-DD");
}

const defaultAdapters = Object.freeze({
  intraday_5m: ({ date, code, name, refresh }) => ensureIntraday5m({ date, code, name, refresh }),
  daily_turnover: ({ date, code, refresh }) => ensureDailyTurnover({ date, code, refresh }),
  daily_turnover_rate: ({ date, code, refresh }) => ensureDailyTurnoverRate({ date, code, refresh }),
  daily_quote: async ({ date, code, refresh }) => verifiedDailyQuote(await auditHistoricalDailyQuote({ date, code, refresh })),
});

function verifiedDailyQuote(audit) {
  // Do not silently treat a single provider as verified historical data.
  if (!audit.consensus) throw new Error(`daily_quote: ${audit.consensus_status}; ${(audit.failures || []).join(" | ")}`);
  return { ...audit.consensus, source: audit.consensus.source, verification: audit.consensus_status, source_quotes: audit.quotes, fallback_failures: audit.failures || [], cached: audit.cached };
}

async function readJsonRecord(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function runRemoteRequest(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeRemoteRequests += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        activeRemoteRequests -= 1;
        remoteRequestQueue.shift()?.();
      });
    };
    if (activeRemoteRequests < MAX_REMOTE_CONCURRENCY) start();
    else remoteRequestQueue.push(start);
  });
}

// For market datasets whose schema is owned by an API route (full-market
// snapshots, quote batches, stock universe), use the same local-first,
// deduplicated and rate-limited transport without weakening that route's
// domain-specific validation.
export async function getLocalFirstMarketData({ key, readLocal, fetchAndCache, localOnly = false } = {}) {
  if (!key || typeof readLocal !== "function" || typeof fetchAndCache !== "function") throw new Error("key, readLocal and fetchAndCache are required");
  try {
    const cached = await readLocal();
    if (cached !== null && cached !== undefined) return { ...cached, cache_status: "hit" };
  } catch { /* A corrupt/missing record is a cache miss, never usable data. */ }
  if (localOnly) throw new Error(`local cache unavailable: ${key}`);
  if (!remoteRequestsInFlight.has(key)) {
    const pending = runRemoteRequest(fetchAndCache);
    remoteRequestsInFlight.set(key, pending);
    pending.finally(() => remoteRequestsInFlight.delete(key)).catch(() => {});
  }
  return { ...(await remoteRequestsInFlight.get(key)), cache_status: "miss" };
}

// Register each dataset's *domain logic* here: local validation, provider
// parsing/fallback and persistence.  The transport decision itself remains
// centralised in getLocalFirstMarketData.
export function registerMarketDataType(kind, { readLocal, fetchAndCache } = {}) {
  if (!/^[a-z0-9_]+$/.test(String(kind || ""))) throw new Error("market data kind must be snake_case");
  if (typeof readLocal !== "function" || typeof fetchAndCache !== "function") throw new Error("market data type requires readLocal and fetchAndCache functions");
  if (registeredMarketDataTypes.has(kind)) throw new Error(`market data type already registered: ${kind}`);
  registeredMarketDataTypes.set(kind, { readLocal, fetchAndCache });
}

export async function ensureMarketData({ kind, key, localOnly = false, ...request } = {}) {
  const type = registeredMarketDataTypes.get(kind);
  if (!type) throw new Error(`market data type is not registered: ${kind}`);
  return getLocalFirstMarketData({
    key: key || `${kind}|${JSON.stringify(request)}`,
    localOnly,
    readLocal: () => type.readLocal(request),
    fetchAndCache: () => type.fetchAndCache(request),
  });
}

// Use this only for a cheap existence/validity probe. Consumers that need the
// actual record must call ensureMarketData/getMarketData instead.
export async function hasLocalMarketData({ kind, ...request } = {}) {
  const type = registeredMarketDataTypes.get(kind);
  if (type) {
    try { return (await type.readLocal(request)) !== null; } catch { return false; }
  }
  if (!MARKET_DATA_KINDS.includes(kind)) return false;
  try { return (await cacheReaders[kind]({ ...request, code: normalizeCode(request.code) })) !== null; } catch { return false; }
}

const cacheReaders = Object.freeze({
  intraday_5m: async ({ date, code }) => {
    const record = await readJsonRecord(path.join(ROOT, "data", "intraday_5m", date, `${code}.json`));
    if (record?.date !== date || record?.code !== code || record?.interval !== "5m" || !Array.isArray(record.bars) || record.bars.length < 30) throw new Error("invalid intraday cache");
    return { bars: record.bars, source: record.source || "cache", fallback_failures: record.fallback_failures || [], cached: true };
  },
  daily_turnover: async ({ date, code }) => {
    const record = await readJsonRecord(path.join(ROOT, "data", "daily_turnover", date, `${code}.json`));
    if (record?.date !== date || record?.code !== code || record?.amount_type !== "reported" || !(Number.isFinite(record.amount) && record.amount > 0)) throw new Error("invalid daily turnover cache");
    return { ...record, cached: true };
  },
  daily_turnover_rate: ({ date, code }) => readCachedDailyTurnoverRate({ date, code }),
  daily_quote: async ({ date, code }) => {
    const record = await readJsonRecord(path.join(ROOT, "data", "historical_quote_audits", date, `${code}.json`));
    if (record?.date !== date || record?.code !== code || record?.version !== "2.0"
      || record?.agreement_fields?.join(",") !== "open,high,low,close,pre_close") throw new Error("invalid daily quote cache");
    return verifiedDailyQuote({ ...record, cached: true });
  },
});

/**
 * Get one date-specific A-share market record.
 *
 * `kind` defines the record schema; `date` is always the observation date,
 * never a fetch date.  `refresh` bypasses only the local record for exactly
 * that code/date. `localOnly` is useful to backtests and guarantees no HTTP
 * request or later-date substitution.  `adapters` exists for deterministic
 * tests and for adding a provider without changing business callers.
 */
export async function getMarketData({ kind, date, code, name = "", close, refresh = false, localOnly = false, adapters = defaultAdapters } = {}) {
  assertRequest({ kind, date, code, close });
  const request = { kind, date: String(date), code: normalizeCode(code), name, close: Number(close), refresh };
  if (!refresh && cacheReaders[kind]) {
    try { return { ...(await cacheReaders[kind](request)), cache_status: "hit" }; }
    catch (error) {
      if (localOnly) throw new Error(`${kind}: local cache unavailable for ${request.date}/${request.code}`);
    }
  }
  const adapter = adapters?.[kind];
  if (typeof adapter !== "function") throw new Error(`${kind}: no source adapter is registered`);
  // A stock can belong to several directions.  Coalesce their simultaneous
  // cache misses, otherwise every direction would independently hit Tencent
  // and then the fallback sources for the identical record.
  const inFlightKey = `${kind}|${request.date}|${request.code}|${request.close}`;
  if (!remoteRequestsInFlight.has(inFlightKey)) {
    const pending = runRemoteRequest(() => adapter(request));
    remoteRequestsInFlight.set(inFlightKey, pending);
    pending.finally(() => remoteRequestsInFlight.delete(inFlightKey)).catch(() => {});
  }
  const result = await remoteRequestsInFlight.get(inFlightKey);
  return { ...result, code: result.code || request.code, date: result.date || request.date, cache_status: result.cached ? "hit" : "miss" };
}

export async function getMarketDataBatch({ kind, date, members = [], concurrency = 4, ...options } = {}) {
  const results = new Map();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), members.length) }, async () => {
    while (cursor < members.length) {
      const member = members[cursor++];
      try { results.set(normalizeCode(member.code), await getMarketData({ kind, date, ...options, ...member })); }
      catch (error) { results.set(normalizeCode(member.code), { code: normalizeCode(member.code), date, error: error.message }); }
    }
  }));
  return results;
}
