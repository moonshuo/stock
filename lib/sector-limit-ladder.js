import { stockBoardLabel } from "../app/lib/stockBoard.js";

const rates = { 主板: 10, 创业板: 20, 科创板: 20, 北交所: 30 };
const ratio = (n, d) => d ? n / d : null;
const cents = (value) => Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;

export function observeLimit(date, quote, board, earlierSessions) {
  if (!quote) return { reason: "缺少行情或停牌" };
  if (!(quote.vol > 0)) return { reason: "无成交或停牌" };
  const name = quote.quoteName?.trim();
  const st = name ? /^(?:\*?ST|S\*ST|SST)/i.test(name) : null;
  if (/^(?:[NC](?=[^a-z])|退)|退市|退$/i.test(name || "") || quote.noPriceLimit) {
    return { st, reason: "新股或特殊交易制度" };
  }
  const rate = rates[board];
  const [base, open, high, low, close] = [quote.preClose, quote.open, quote.high, quote.low, quote.price].map(cents);
  if (!rate || !base || !open || !high || !low || !close || low > Math.min(open, close) || high < Math.max(open, close)) {
    return { st, reason: "价格或市场数据不足" };
  }
  const historicalStRule = board === "主板" && date < "2026-07-06";
  const pct = historicalStRule && st ? 5 : rate;
  const limit = (p) => Math.max(base + 1, Math.floor((base * (100 + p) + 50) / 100));
  const floor = (p) => Math.max(1, Math.min(base - 1, Math.floor((base * (100 - p) + 50) / 100)));
  const upper = cents(quote.upperLimit) ?? limit(pct);
  const lower = cents(quote.lowerLimit) ?? floor(pct);
  if (high > upper || low < lower) return { st, reason: "超出标准价格区间，交易制度待核实" };
  if ((!cents(quote.upperLimit) || !cents(quote.lowerLimit)) && earlierSessions < (board === "北交所" ? 1 : 5)) {
    return { st, reason: "上市初期状态无法核实" };
  }
  if (historicalStRule && st == null && ((!cents(quote.upperLimit) && high >= limit(5)) || (!cents(quote.lowerLimit) && low <= floor(5)))) {
    return { st, reason: "缺少历史ST状态及实际限价" };
  }
  const sealed = close === upper;
  return {
    st, sealed, touched: high === upper, down: close === lower,
    highOpenFade: open > base && close < open,
    type: sealed ? low === upper ? "一字板" : open === upper ? "T字板" : "换手板" : null,
    changePct: (close / base - 1) * 100,
    upperLimit: upper / 100,
    amount: Number.isFinite(quote.amount) ? quote.amount : null,
    limitSource: cents(quote.upperLimit) ? "实际限价" : "按标准市场规则计算",
  };
}

function summary(rows, transitions, final, available, previousAvailable) {
  const sealed = rows.filter((row) => row.sealed);
  const touched = rows.filter((row) => row.touched);
  const observed = transitions.filter((row) => row.status === "晋级" || row.status === "断板");
  const promoted = observed.filter((row) => row.status === "晋级").length;
  const knownReturns = observed.map((row) => row.changePct).filter(Number.isFinite);
  const comparable = final && previousAvailable;
  return {
    highest: available ? sealed.reduce((max, row) => Math.max(max, row.height), 0) : null,
    heightIncomplete: sealed.some((row) => !row.heightExact),
    limitUps: available ? sealed.length : null,
    firstBoards: available ? sealed.filter((row) => row.height === 1 && row.heightExact).length : null,
    consecutive: available ? sealed.filter((row) => row.height >= 2).length : null,
    threePlus: available ? sealed.filter((row) => row.height >= 3).length : null,
    twoBoards: available ? sealed.filter((row) => row.height === 2 && row.heightExact).length : null,
    promoted: comparable ? promoted : null,
    broken: comparable ? observed.length - promoted : null,
    observable: comparable ? observed.length : null,
    previous: previousAvailable ? transitions.length : null,
    promotionRate: comparable ? ratio(promoted, observed.length) : null,
    twoToThree: comparable ? ratio(
      observed.filter((row) => row.previousHeightExact && row.previousHeight === 2 && row.status === "晋级").length,
      observed.filter((row) => row.previousHeightExact && row.previousHeight === 2).length,
    ) : null,
    failedSeals: final ? touched.length - sealed.length : null,
    failedSealRate: final ? ratio(touched.length - sealed.length, touched.length) : null,
    previousMeanReturn: ratio(knownReturns.reduce((sum, value) => sum + value, 0), knownReturns.length),
    returnSample: knownReturns.length,
    unobservable: rows.filter((row) => row.reason).length,
  };
}

// Every element represents one exchange session, including missing sessions.
export function buildSectorLimitLadder({ sessions, members, period, includeSt = true }) {
  const universe = [...new Map(members.map((stock) => [stock.code, stock])).values()];
  const states = new Map();
  const history = [];
  let current;
  for (const [index, session] of sessions.entries()) {
    const latest = index === sessions.length - 1;
    const final = Boolean(session.available && session.final);
    const quotes = new Map((session.quotes || []).map((quote) => [quote.code, quote]));
    const rows = [];
    const transitions = [];
    for (const stock of universe) {
      const previous = states.get(stock.code);
      const quote = quotes.get(stock.code);
      const board = stockBoardLabel(stock.code);
      const state = observeLimit(session.date, quote, board, previous?.tradedSessions ?? 0);
      const selected = includeSt || state.st !== true;
      const eligible = selected && (includeSt || state.st === false);
      const sealed = state.sealed === true;
      const height = sealed ? (previous?.height ?? 0) + 1 : 0;
      const heightExact = sealed ? previous?.heightExact === true : state.sealed === false;
      const rolling = [...(previous?.rolling || []), final ? state.sealed : undefined].slice(-13);
      const rollingCount = rolling.length === 13 && rolling.every((value) => value !== undefined)
        ? rolling.filter(Boolean).length : null;
      const row = {
        ...stock, ...state, board, height, heightExact, rollingCount,
        rebound: sealed && previous?.rolling.at(-1) === false && previous.rolling.at(-2) === true,
        provisional: !final,
      };
      if (eligible) rows.push(row);
      else if (selected) rows.push({ ...stock, board, reason: "缺少当日ST状态" });
      if (previous?.finalSeal && previous.eligible) {
        const status = !eligible || state.reason ? "不可观察"
          : final ? sealed ? "晋级" : "断板"
            : sealed ? "暂时晋级" : "盘中未封板";
        transitions.push({
          ...row, status, previousHeight: previous.height, previousHeightExact: previous.heightExact,
          reason: !eligible ? selected ? "缺少当日ST状态" : "当日ST被筛除" : state.reason,
        });
      }
      states.set(stock.code, {
        height: final ? height : 0,
        heightExact: final && heightExact,
        rolling, eligible, finalSeal: final && sealed,
        tradedSessions: (previous?.tradedSessions ?? 0) + Number(quote?.vol > 0),
      });
    }
    const previousAvailable = Boolean(sessions[index - 1]?.final && sessions[index - 1]?.available);
    const metrics = summary(rows, transitions, final, session.available, previousAvailable);
    history.push({
      date: session.date, available: session.available, final, source: session.source,
      issue: session.issue, previousAvailable, ...metrics,
    });
    if (latest) {
      const ladder = rows.filter((row) => row.sealed).sort((a, b) => b.height - a.height || a.code.localeCompare(b.code));
      const groups = [...new Set(universe.flatMap((stock) => stock.directions))];
      current = {
        ladder, transitions,
        unavailableMembers: rows.filter((row) => row.reason).map(({ code, name, reason }) => ({ code, name, reason })),
        failedSeals: final ? rows.filter((row) => row.touched && !row.sealed) : [],
        directions: groups.map((direction) => ({
          direction, ...summary(rows.filter((row) => row.directions.includes(direction)),
            transitions.filter((row) => row.directions.includes(direction)), final, session.available, previousAvailable),
        })).sort((a, b) => b.highest - a.highest || b.limitUps - a.limitUps),
        leaders: ladder.filter((row) => row.height === metrics.highest && row.heightExact),
        highElasticity: ladder.filter((row) => ["创业板", "科创板"].includes(row.board)),
        highCoexistence: ladder.filter((row) => row.height >= 3),
      };
    }
  }
  return { ...current, current: history.at(-1), history: history.slice(-period) };
}
