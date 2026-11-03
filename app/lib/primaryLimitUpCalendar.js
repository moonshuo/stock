// Secondary themes overlap inside a primary.  Merge their daily limit-up
// lists by code so a primary calendar reports each stock exactly once.
export function buildPrimaryLimitUpCalendar(items = []) {
  const byDate = new Map();
  for (const item of items || []) for (const entry of item?.score_history || []) {
    if (!entry?.date) continue;
    const stocks = byDate.get(entry.date) || new Map();
    for (const stock of entry.metrics?.limit_up_stocks || []) {
      if (!stock?.code) continue;
      stocks.set(String(stock.code), { code: String(stock.code), name: stock.name || String(stock.code), change_pct: Number(stock.change_pct) });
    }
    byDate.set(entry.date, stocks);
  }
  return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, stocks]) => ({
    date,
    limit_up_stocks: [...stocks.values()].sort((left, right) => right.change_pct - left.change_pct || left.code.localeCompare(right.code)),
  }));
}
