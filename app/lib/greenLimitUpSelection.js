import { isMainBoardStock } from "./stockBoard.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ST_NAME_PATTERN = /^(?:\*?ST|S\*ST|SST)/i;

export function isStStockName(name = "") {
  return ST_NAME_PATTERN.test(String(name).trim());
}

export function upperLimitRatio(name = "") {
  return isStStockName(name) ? 0.05 : 0.1;
}

// A-share main-board prices use a ¥0.01 tick.  Test the close against the
// exchange-rounded upper-limit price instead of treating an arbitrary 9.8%
// gain as a limit-up close.
export function roundedUpperLimitPrice(preClose, name = "") {
  const previous = Number(preClose);
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return Math.round((previous * (1 + upperLimitRatio(name)) + Number.EPSILON) * 100) / 100;
}

export function isLimitUpClose(stock = {}) {
  const close = Number(stock.price);
  const upperLimit = roundedUpperLimitPrice(stock.preClose, stock.name);
  return Number.isFinite(close) && Number.isFinite(upperLimit) && Math.abs(close - upperLimit) < 0.000001;
}

export function isGreenClose(stock = {}) {
  const close = Number(stock.price);
  const preClose = Number(stock.preClose);
  return Number.isFinite(close) && Number.isFinite(preClose) && close < preClose;
}

export function selectGreenMainBoardRecentLimitUps({ todayStocks = [], historicalStocksByDate = new Map() } = {}) {
  const limitUpDatesByCode = new Map();
  for (const [date, stocks] of historicalStocksByDate.entries()) {
    if (!DATE_PATTERN.test(date)) throw new Error(`无效交易日：${date}`);
    for (const stock of stocks || []) {
      if (!isMainBoardStock(stock.code) || !isLimitUpClose(stock)) continue;
      const code = String(stock.code);
      const dates = limitUpDatesByCode.get(code) || [];
      dates.push(date);
      limitUpDatesByCode.set(code, dates);
    }
  }

  return (todayStocks || [])
    .filter((stock) => isMainBoardStock(stock.code) && !isStStockName(stock.name) && isGreenClose(stock))
    .map((stock) => {
      const limitUpDates = limitUpDatesByCode.get(String(stock.code)) || [];
      return {
        code: String(stock.code),
        name: String(stock.name || ""),
        price: Number(stock.price),
        preClose: Number(stock.preClose),
        changePct: Number.isFinite(Number(stock.changePct)) ? Number(stock.changePct) : (Number(stock.price) / Number(stock.preClose) - 1) * 100,
        limit_up_dates: limitUpDates,
        limit_up_count: limitUpDates.length,
      };
    })
    .sort((left, right) => right.limit_up_count - left.limit_up_count || left.changePct - right.changePct || left.code.localeCompare(right.code));
}
