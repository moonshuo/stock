import assert from "node:assert/strict";
import { taxonomyForPersistence } from "../app/lib/libraryPersistence.js";

const emptyTertiary = "__空成分三级目录回归测试__";
const taxonomy = {
  version: "1.0",
  sectors: [{
    name: "AI应用",
    secondary_sectors: [{
      name: "AIGC",
      tertiary_sectors: [emptyTertiary],
      tertiary_descriptions: { [emptyTertiary]: "尚未完成成分股核验的预留目录" },
    }],
  }],
};
const saved = taxonomyForPersistence(taxonomy);
const savedAigc = saved.sectors[0].secondary_sectors[0];
assert.ok(savedAigc.tertiary_sectors.includes(emptyTertiary), "空成分三级标题必须在保存后保留，不能被静默删除");
assert.deepEqual(savedAigc.tertiary_descriptions, taxonomy.sectors[0].secondary_sectors[0].tertiary_descriptions);
assert.notEqual(saved, taxonomy, "保存前必须深拷贝，避免请求对象后续修改污染持久化数据");

console.log("library empty tertiary persistence contract passed");
