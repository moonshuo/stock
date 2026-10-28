import assert from "node:assert/strict";
import { collectReportedTotalPages } from "../lib/reported-total-pagination.js";

// Eastmoney can accept pz=500 while returning only 100 records per page.  The
// old fixed 20-page loop stopped at exactly 2,000 rows even though `total`
// still reported the full listed universe.
const universe = Array.from({ length: 5559 }, (_, index) => ({ code: String(index + 1).padStart(6, "0") }));
const requestedPageSize = 500;
const providerPageSize = 100;
let calls = 0;
const complete = await collectReportedTotalPages(async (page) => {
  calls += 1;
  const start = (page - 1) * providerPageSize;
  return {
    items: universe.slice(start, start + Math.min(requestedPageSize, providerPageSize)),
    total: universe.length,
  };
}, {
  getKey: (item) => item.code,
  maxPages: 100,
});

assert.equal(complete.items.length, universe.length, "分页必须以接口报告的总数为准，不能在20页/2000条处截断");
assert.equal(complete.reportedTotal, universe.length);
assert.equal(complete.pagesFetched, 56);
assert.equal(calls, 56);

await assert.rejects(
  () => collectReportedTotalPages(async (page) => {
    const start = (page - 1) * providerPageSize;
    return { items: universe.slice(start, start + providerPageSize), total: universe.length };
  }, { getKey: (item) => item.code, maxPages: 20 }),
  /20 页上限.*2000\/5559/,
  "旧的20页上限必须被回归测试识别为不完整抓取",
);

let repeatedCalls = 0;
await assert.rejects(
  () => collectReportedTotalPages(async () => {
    repeatedCalls += 1;
    return { items: universe.slice(0, 100), total: universe.length };
  }, { getKey: (item) => item.code, maxPages: 100 }),
  /没有新增数据/,
  "接口重复返回同一页时必须停止，不能无限抓取",
);
assert.equal(repeatedCalls, 2);

await assert.rejects(
  () => collectReportedTotalPages(async (page) => ({
    items: page === 1 ? universe.slice(0, 100) : [],
    total: universe.length,
  }), { getKey: (item) => item.code }),
  /提前结束.*100\/5559/,
  "接口在报告总数之前返回空页时不能把部分行情当成完整结果",
);

const empty = await collectReportedTotalPages(async () => ({ items: [], total: 0 }), {
  getKey: (item) => item.code,
});
assert.deepEqual(empty, { items: [], reportedTotal: 0, pagesFetched: 0 });

console.log("reported total pagination contract passed");
