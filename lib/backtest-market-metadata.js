import { mkdir, writeFile } from "fs/promises";
import path from "path";

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function mainBoardCode(code) {
  return /^(600|601|603|605|000|001|002|003)/.test(String(code || ""));
}

export function metadataFromHistoricalTurnover({ turnoverRate, historicalQuote } = {}) {
  // 换手率、成交量和收盘价必须来自同一条历史日线。禁止以本地5分钟
  // 聚合量或当前流通股本替代，否则单位和复权口径可能不一致。
  const close = finite(historicalQuote?.close);
  const volume = finite(historicalQuote?.volume);
  const rate = finite(turnoverRate);
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  const freeFloatShares = volume / (rate / 100);
  if (!Number.isFinite(freeFloatShares) || freeFloatShares <= 0) return null;
  return {
    free_float_shares: freeFloatShares,
    free_float_market_cap: freeFloatShares * close,
    source: "historical_daily_turnover_rate",
    turnover_rate: rate,
    ...(historicalQuote ? { historical_quote_source: "provider_daily_kline" } : {}),
    estimated: false,
  };
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]);
  }));
}

// 仅持久化可追溯的目标日历史日线结果。
export async function persistBacktestMarketMetadata({ date, entries = {}, root = process.cwd() } = {}) {
  const rows = Object.entries(entries).filter(([, metadata]) => Number.isFinite(finite(metadata?.free_float_market_cap)) && finite(metadata.free_float_market_cap) > 0);
  if (!rows.length) return 0;
  const directory = path.join(root, "data", "historical_market_cap", date);
  await mkdir(directory, { recursive: true });
  await mapLimit(rows, 32, async ([code, metadata]) => {
    const record = {
      version: "1.0", date, code: String(code).padStart(6, "0"),
      free_float_market_cap: finite(metadata.free_float_market_cap),
      free_float_shares: finite(metadata.free_float_shares),
      market_cap_type: "historical_daily_turnover_rate",
      source: metadata.source || "historical_daily_turnover_rate",
      turnover_rate: finite(metadata.turnover_rate),
      estimated: false,
      fetched_at: new Date().toISOString(),
    };
    await writeFile(path.join(directory, `${record.code}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  });
  return rows.length;
}

// 仅接受目标交易日真实日线的换手率、成交量和收盘价；缺失的数据不参与
// 候选评分，绝不以当前市值、当前流通股本或本地聚合成交量进行估算。
export async function loadBacktestMarketMetadata({ date, stocks = [], market = {}, loadTurnoverRate, concurrency = 32 } = {}) {
  const quotes = new Map((market.stocks || []).map((quote) => [String(quote.code), quote]));
  const codes = [...new Set(stocks.map((stock) => String(stock.code)).filter(mainBoardCode))];
  const entries = {};
  const summary = { requested: codes.length, historical_turnover_rate: 0, missing: 0 };
  await mapLimit(codes, concurrency, async (code) => {
    const quote = quotes.get(code);
    if (!quote) { summary.missing += 1; return; }
    if (loadTurnoverRate) {
      try {
        const turnover = await loadTurnoverRate({ date, code });
        const metadata = metadataFromHistoricalTurnover({ turnoverRate: turnover?.turnover_rate, historicalQuote: turnover?.historical_quote });
        if (metadata) {
          entries[code] = metadata;
          summary.historical_turnover_rate += 1;
          return;
        }
      } catch { /* 真实历史日线不可用时，该股票不进入候选池。 */ }
    }
    summary.missing += 1;
  });
  return { entries, summary };
}
