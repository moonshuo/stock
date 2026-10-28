import { isThirdBoardStockCode, normalizeCode } from "./sectorSystem.js";

export function marketResearchBatchId(batch = []) {
  return `market-v1:${batch.map((stock) => String(stock?.code || "")).sort().join(",")}`;
}

export function isUsableMarketResearchBatch(batch = []) {
  return Array.isArray(batch)
    && batch.every((stock) => /^\d{6}$/.test(normalizeCode(stock?.code)) && !isThirdBoardStockCode(stock.code));
}

export function pendingMarketResearchBatch(activeBatch = [], generatedBatch = []) {
  return activeBatch.length ? activeBatch : generatedBatch;
}

export function pendingMarketResearchCount(stockUniverse = [], completed = {}) {
  const pendingCodes = new Set();
  for (const stock of stockUniverse || []) {
    const code = normalizeCode(stock?.code);
    if (/^\d{6}$/.test(code) && !isThirdBoardStockCode(code) && !completed?.[code]) {
      pendingCodes.add(code);
    }
  }
  return pendingCodes.size;
}

export function mergeMarketResearchUniverse(current = [], incoming = []) {
  const stocksByCode = new Map();
  for (const stock of [...(current || []), ...(incoming || [])]) {
    const code = normalizeCode(stock?.code);
    if (/^\d{6}$/.test(code) && !isThirdBoardStockCode(code)) {
      stocksByCode.set(code, { ...stock, code });
    }
  }
  return [...stocksByCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}
