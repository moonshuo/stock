export async function collectReportedTotalPages(fetchPage, {
  getKey,
  maxPages = 100,
} = {}) {
  if (typeof fetchPage !== "function") throw new TypeError("fetchPage 必须是函数");
  if (typeof getKey !== "function") throw new TypeError("getKey 必须是函数");
  if (!Number.isInteger(maxPages) || maxPages <= 0) throw new RangeError("maxPages 必须是正整数");

  const items = [];
  const seenKeys = new Set();
  let reportedTotal = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    const pageItems = Array.isArray(result?.items) ? result.items : [];
    const total = Number(result?.total);
    if (Number.isFinite(total) && total > 0) reportedTotal = total;
    if (!pageItems.length) {
      if (reportedTotal && seenKeys.size < reportedTotal) {
        throw new Error(`分页提前结束，仅取得 ${seenKeys.size}/${reportedTotal} 条`);
      }
      break;
    }

    pagesFetched = page;
    let added = 0;
    for (const item of pageItems) {
      const key = String(getKey(item) ?? "").trim();
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      items.push(item);
      added += 1;
    }

    if (reportedTotal && seenKeys.size >= reportedTotal) break;
    if (!added) {
      throw new Error(`分页第 ${page} 页没有新增数据，已停止以避免重复抓取`);
    }
    if (page === maxPages && (!reportedTotal || seenKeys.size < reportedTotal)) {
      throw new Error(`分页达到 ${maxPages} 页上限，但仅取得 ${seenKeys.size}/${reportedTotal || "未知"} 条`);
    }
  }

  return { items, reportedTotal, pagesFetched };
}
