import assert from "node:assert/strict";
import { applyNoteMutation } from "../app/lib/noteStore.js";

const original = [
  { id: "old-1", title: "旧笔记一", content: "内容一", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
  { id: "old-2", title: "旧笔记二", content: "内容二", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" },
];
const now = "2026-10-12T13:00:00.000Z";

const created = applyNoteMutation(original, { action: "create", note: { id: "new", title: "新笔记", content: "" } }, now);
assert.equal(created.length, 3, "新建笔记必须保留服务端已有笔记，不能以客户端空列表整表覆盖");
assert.deepEqual(new Set(created.map((note) => note.id)), new Set(["old-1", "old-2", "new"]));

const updated = applyNoteMutation(created, { action: "update", id: "old-1", values: { title: "已更新", content: "新内容" } }, "2026-10-12T13:01:00.000Z");
assert.equal(updated.find((note) => note.id === "old-1")?.content, "新内容");
assert.equal(updated.find((note) => note.id === "old-2")?.content, "内容二", "更新一篇笔记不得改写其他笔记");

const deleted = applyNoteMutation(updated, { action: "delete", id: "new" }, "2026-10-12T13:02:00.000Z");
assert.deepEqual(new Set(deleted.map((note) => note.id)), new Set(["old-1", "old-2"]));

assert.throws(() => applyNoteMutation(original, { action: "update", id: "missing", values: {} }, now), /没有找到/);
assert.throws(() => applyNoteMutation(original, { notes: [] }, now), /没有找到|不支持/, "旧的整表替换载荷必须被拒绝");

console.log("note store contract passed");
