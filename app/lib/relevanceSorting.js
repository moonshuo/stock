import { relevanceWeightForScope } from "../../lib/relevance-adjusted-return.js";

function finiteChange(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : -Infinity;
}

// A tertiary list must use the relevance of the matching directory path,
// rather than a stock's unrelated classification in another sector.
export function sortStocksByScopeRelevance(stocks = [], scope = {}, getChange = () => null) {
  return stocks
    .map((stock, index) => ({ stock, index, relevance: relevanceWeightForScope(stock, scope), change: finiteChange(getChange(stock)) }))
    .sort((left, right) => right.relevance - left.relevance || right.change - left.change || left.index - right.index)
    .map(({ stock }) => stock);
}
