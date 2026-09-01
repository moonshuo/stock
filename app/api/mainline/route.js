import { NextResponse } from "next/server";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { loadDailyMarket, runDailyMarketTask } from "../daily-market/route";
import { GET as getCapacityCore } from "../capacity-core/route";
import { GET as getLeader } from "../leader/route";
import { analyzeMainlines } from "../../../lib/mainline";
import { compactMainlineResult } from "../../../lib/mainline-response";
import { createMainlineDiskSnapshot, decodeMainlineResponseCache, encodeMainlineResponseCache } from "../../../lib/mainline-persistence";
import { selectRankedCoreModuleTargets } from "../../../lib/mainline/core-module-selection";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const OUTPUT_DIR = path.join(process.cwd(), "output");
const TAXONOMY_PATH = path.join(process.cwd(), "data", "sector_taxonomy.json");
const STOCK_MAP_PATH = path.join(process.cwd(), "data", "stock_sector_map.json");
// A historical response is reusable only while the classification and every
// scoring rule that produced it are unchanged.  Bump this when a new rule is
// introduced; source/config mtimes cover ordinary strategy edits automatically.
const RESPONSE_CACHE_VERSION = 16;
const STRATEGY_DEPENDENCIES = [
  TAXONOMY_PATH,
  STOCK_MAP_PATH,
  path.join(process.cwd(), "data", "mainline_config.json"),
  path.join(process.cwd(), "data", "leader_config.json"),
  path.join(process.cwd(), "lib", "mainline.js"),
  path.join(process.cwd(), "lib", "mainline-response.js"),
  path.join(process.cwd(), "lib", "mainline-persistence.js"),
  path.join(process.cwd(), "lib", "mainline", "cycle-metrics.js"),
  path.join(process.cwd(), "lib", "mainline", "core-module-selection.js"),
  path.join(process.cwd(), "app", "api", "capacity-core", "route.js"),
  path.join(process.cwd(), "app", "api", "leader", "route.js"),
  path.join(process.cwd(), "app", "api", "daily-market", "route.js"),
  path.join(process.cwd(), "lib", "market-snapshot.js"),
];
// Keep every materially resonant direction in the same request so replay
// windows cannot change whether a theme receives core-response evidence.
const AUTOMATIC_CONCURRENCY = 4;

function marketBenchmark(payload) {
  const returns = (payload?.stocks || []).map((stock) => Number(stock.changePct)).filter(Number.isFinite).sort((left, right) => left - right);
  if (!returns.length) return null;
  const middle = Math.floor(returns.length / 2);
  return {
    median_return_pct: +(returns.length % 2 ? returns[middle] : (returns[middle - 1] + returns[middle]) / 2).toFixed(2),
    up_ratio: +(returns.filter((value) => value > 0).length / returns.length).toFixed(3),
  };
}

function chinaToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Intraday files can be replaced by the confirmed 15:00 snapshot after the
// market closes.  Never let a persisted response pin today's calculation to
// an earlier quote snapshot; historical days remain reproducible and cached.
function isHistoricalDate(date) {
  return date < chinaToday();
}

async function persistedSnapshotVersion(date) {
  const compact = String(date || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(compact)) return "";
  try {
    const info = await stat(path.join(process.cwd(), "5分钟数据", compact.slice(0, 4), `${compact}.parquet`));
    return `${info.size}:${info.mtimeMs}`;
  } catch {
    return "";
  }
}

async function analysisFingerprint(snapshotVersion = "") {
  const entries = await Promise.all(STRATEGY_DEPENDENCIES.map(async (filePath) => {
    const info = await stat(filePath);
    return `${path.relative(process.cwd(), filePath)}:${info.size}:${info.mtimeMs}`;
  }));
  return `${RESPONSE_CACHE_VERSION}|snapshot:${snapshotVersion}|${entries.join("|")}`;
}

function responseCachePath(date, cycleStartDate = "", includeCoreModules = false) {
  const scope = includeCoreModules ? "_with_core_modules" : "_base";
  return path.join(OUTPUT_DIR, `mainline_response_${date}${cycleStartDate ? `_from_${cycleStartDate}` : ""}${scope}.json.gz`);
}

function legacyResponseCachePath(date, cycleStartDate = "", includeCoreModules = false) {
  return responseCachePath(date, cycleStartDate, includeCoreModules).replace(/\.gz$/, "");
}

async function readHistoricalResponseCache(date, fingerprint, cycleStartDate = "", includeCoreModules = false) {
  try {
    const payload = await decodeMainlineResponseCache(await readFile(responseCachePath(date, cycleStartDate, includeCoreModules)));
    if (payload?.cache_fingerprint !== fingerprint || !payload?.result) return null;
    return payload.result;
  } catch {
    try {
      const payload = JSON.parse(await readFile(legacyResponseCachePath(date, cycleStartDate, includeCoreModules), "utf8"));
      if (payload?.cache_fingerprint !== fingerprint || !payload?.result) return null;
      return payload.result;
    } catch {
      return null;
    }
  }
}

async function runAutomaticCoreModules(result, date) {
  // Ranking completes before this function runs. Every ranked direction with
  // a sufficient observed sample then receives both core modules, in rank
  // order, so no manual click is needed for an otherwise valid direction.
  const minimumMembers = Number(result.daily_core_module_eligibility?.minimum_valid_members) || 3;
  const targets = selectRankedCoreModuleTargets(result.all_themes || result.themes || [], minimumMembers);
  const capacity = {};
  const leader = {};
  const failures = [];
  const queue = [...targets];
  const worker = async () => {
    while (queue.length) {
      const theme = queue.shift();
      if (!theme) return;
      const params = new URLSearchParams({ date, primary: theme.primary, secondary: theme.name });
      const key = `${date}|${theme.primary}|${theme.name}`;
      try {
        const [capacityResponse, leaderResponse] = await Promise.all([
          getCapacityCore(new Request(`http://localhost/api/capacity-core?${params}`)),
          getLeader(new Request(`http://localhost/api/leader?${params}`)),
        ]);
        const [capacityPayload, leaderPayload] = await Promise.all([capacityResponse.json(), leaderResponse.json()]);
        if (capacityResponse.ok) capacity[key] = capacityPayload;
        else failures.push({ module: "capacity", theme: `${theme.primary} / ${theme.name}`, error: capacityPayload.error || `HTTP ${capacityResponse.status}` });
        // /api/leader returns a transport wrapper.  Keeping that wrapper here
        // made the UI see an empty candidate list, then a manual re-run (which
        // unwraps it) appeared to "find" a leader.  Persist the actual result.
        if (leaderResponse.ok) leader[key] = leaderPayload.leader_analysis;
        else failures.push({ module: "leader", theme: `${theme.primary} / ${theme.name}`, error: leaderPayload.error || `HTTP ${leaderResponse.status}` });
      } catch (error) {
        failures.push({ module: "core", theme: `${theme.primary} / ${theme.name}`, error: error.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AUTOMATIC_CONCURRENCY, targets.length) }, worker));
  return { requested: targets.length, capacity, leader, failures, concurrency: Math.min(AUTOMATIC_CONCURRENCY, targets.length), selection: "ranked_themes_with_sufficient_data", minimum_valid_members: minimumMembers };
}
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date") || "";
  const requestedPrimary = params.get("primary") || "";
  const requestedSecondary = params.get("secondary") || "";
  const historyStartDate = params.get("cycle_start_date") || "";
  const expectedSnapshotId = params.get("snapshot_id") || "";
  // A dashboard response must be bounded to the local market snapshot and
  // mainline calculation.  Capacity and leader modules can trigger hundreds
  // of historical quote/cache operations across active directions, so they
  // are opt-in rather than allowed to turn a read-only page load into an
  // unbounded batch job.  Individual module endpoints remain available.
  const includeCoreModules = params.get("include_core_modules") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error:"date 必须为 YYYY-MM-DD" },{status:400});
  if (historyStartDate && (!/^\d{4}-\d{2}-\d{2}$/.test(historyStartDate) || historyStartDate > date)) {
    return NextResponse.json({ error:"周期起始日期必须是早于或等于截止日期的 YYYY-MM-DD" },{status:400});
  }
  return runDailyMarketTask(async () => {
  try {
    const initialPersistedSnapshotVersion = await persistedSnapshotVersion(date);
    const fingerprint = await analysisFingerprint(initialPersistedSnapshotVersion);
    const cached = isHistoricalDate(date)
      ? await readHistoricalResponseCache(date, fingerprint, historyStartDate, includeCoreModules)
      : null;
    if (cached) {
      const requestedTheme = requestedPrimary && requestedSecondary
        ? (cached.all_themes || cached.themes || []).find((theme) => theme.primary === requestedPrimary && theme.name === requestedSecondary) || null
        : null;
      return NextResponse.json({ ...cached, requested_theme: requestedTheme });
    }
    const market = await loadDailyMarket(date);
    if (market?.error) return NextResponse.json({ error: market.error, snapshot: market.snapshot || null }, { status: market.status || 409 });
    if (expectedSnapshotId && market.snapshot_id !== expectedSnapshotId) {
      return NextResponse.json({ error: "本地主行情快照已更新，请重新读取当日涨幅后再计算主线。", expected_snapshot_id: expectedSnapshotId, current_snapshot_id: market.snapshot_id }, { status: 409 });
    }
    const startingSnapshotVersion = await persistedSnapshotVersion(date);
    const requestedTheme = requestedPrimary && requestedSecondary ? { primary: requestedPrimary, secondary: requestedSecondary } : undefined;
    let result = await analyzeMainlines(date, loadDailyMarket, { requested_theme: requestedTheme, history_start_date: historyStartDate });
    const benchmark = marketBenchmark(market);
    if (benchmark) result.market_summary = { ...result.market_summary, benchmark, quote_snapshot: market.snapshot, quote_source: market.source };
    if (includeCoreModules) {
      const automaticModules = await runAutomaticCoreModules(result, date);
      if (automaticModules.requested) result = await analyzeMainlines(date, loadDailyMarket, {
        core_evidence: automaticModules,
        requested_theme: requestedTheme,
        history_start_date: historyStartDate,
      });
      result.automatic_modules = automaticModules;
    } else {
      result.automatic_modules = {
        requested: 0,
        capacity: {},
        leader: {},
        failures: [],
        selection: "on_demand",
        message: "容量中军与题材龙头按需加载，不阻塞主线首日结果。",
      };
    }
    const endingSnapshotVersion = await persistedSnapshotVersion(date);
    if (startingSnapshotVersion && endingSnapshotVersion !== startingSnapshotVersion) {
      return NextResponse.json({ error: "主线计算期间本地行情快照已更新；旧结果已丢弃，请基于新快照重新计算。", snapshot_id: market.snapshot_id }, { status: 409 });
    }
    result.market_snapshot_id = market.snapshot_id;
    result.market_snapshot_version = startingSnapshotVersion;
    const responseResult = compactMainlineResult(result);
    await mkdir(OUTPUT_DIR,{recursive:true});
    if (isHistoricalDate(date)) {
      const cacheDocument = { cache_fingerprint: fingerprint, cached_at: new Date().toISOString(), result: responseResult };
      await writeFile(responseCachePath(date, historyStartDate, includeCoreModules), await encodeMainlineResponseCache(cacheDocument));
    }
    await writeFile(path.join(OUTPUT_DIR,`mainline_${date}.json`),`${JSON.stringify(createMainlineDiskSnapshot(responseResult))}\n`,`utf8`);
    const debug = (responseResult.themes || []).map((item) => ({
      theme: `${item.primary || ""} / ${item.name || ""}`, status:item.status, score:item.score, rank:item.rank,
      leaders:item.hierarchy?.emotion_leader || [], breadth:item.breadth, hierarchy:item.hierarchy,
      next_day_profit_effect:item.profit_effect?.status || "unavailable", divergence:item.divergence_analysis?.divergence_status,
      cycle:item.continuity?.state, downgrade_reasons:item.negative_signals || [], missing_data:item.missing_data || []
    }));
    await writeFile(path.join(OUTPUT_DIR,`mainline_debug_${date}.json`),`${JSON.stringify({ date, data_scope:responseResult.data_scope, themes:debug })}\n`,`utf8`);
    return NextResponse.json(responseResult);
  }
  catch (error) { return NextResponse.json({error:`主线识别失败：${error.message}`},{status:500}); }
  });
}
