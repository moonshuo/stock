import assert from "node:assert/strict";
import { marketResearchBatchId, pendingMarketResearchBatch, pendingMarketResearchCount, mergeMarketResearchUniverse } from "../app/lib/marketResearchBatch.js";

const copiedBatch = [{ code: "000002" }, { code: "000001" }];
const refreshedBatch = [{ code: "000003" }, { code: "000004" }];

assert.deepEqual(
  pendingMarketResearchBatch(copiedBatch, refreshedBatch),
  copiedBatch,
  "已复制的批次在成功导入前必须保持不变",
);
assert.deepEqual(
  pendingMarketResearchBatch([], refreshedBatch),
  refreshedBatch,
  "成功导入清除锁定后才能计算下一批",
);
assert.equal(
  marketResearchBatchId(copiedBatch),
  "market-v1:000001,000002",
  "批次 ID 必须与导入校验使用的代码排序一致",
);

assert.deepEqual(
  mergeMarketResearchUniverse(
    [{ code: "000001", name: "本地名称" }, { code: "600409", name: "本地待核验" }],
    [{ code: "000001", name: "在线新名称" }, { code: "000002", name: "在线新增" }],
  ),
  [
    { code: "000001", name: "在线新名称" },
    { code: "000002", name: "在线新增" },
    { code: "600409", name: "本地待核验" },
  ],
  "在线股票池只能补充或更新本地股票池，不能覆盖并丢失本地待核验股票",
);

assert.equal(
  pendingMarketResearchCount(
    [{ code: "000001" }, { code: "000002" }, { code: "000002" }, { code: "430001" }],
    { "000001": { completed_at: "2026-08-17T00:00:00.000Z" }, "300001": { completed_at: "2026-08-17T00:00:00.000Z" } },
  ),
  1,
  "待处理数必须仅统计当前股票池中尚未完成的股票，不能用全局完成记录总数相减",
);

console.log("market research batch lock contract passed");
