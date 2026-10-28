import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { ensureIntraday5m } from "./intraday5m.js";

const root = process.cwd();
const running = new Map();

export function enqueueFullMarketIntradayArchive({ date, members }) {
  if (running.has(date)) return running.get(date);
  const task = (async () => {
    const dir = path.join(root, "data", "intraday_5m", "_archive_jobs");
    const file = path.join(dir, `${date}.json`);
    await mkdir(dir, { recursive: true });
    try {
      const old = JSON.parse(await readFile(file, "utf8"));
      if (old.status === "completed") return old;
    } catch { /* first archive */ }
    const unique = [...new Map((members || []).filter((x) => /^\d{6}$/.test(String(x.code || ""))).map((x) => [x.code, x])).values()];
    const state = { date, status: "running", total: unique.length, completed: 0, saved: 0, failed: 0, started_at: new Date().toISOString() };
    const persist = () => writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
    await persist();
    let cursor = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < unique.length) {
        const member = unique[cursor++];
        try { await ensureIntraday5m({ date, code: member.code, name: member.name || "" }); state.saved += 1; }
        catch { state.failed += 1; }
        state.completed += 1;
        if (state.completed % 25 === 0 || state.completed === state.total) await persist();
      }
    }));
    state.status = "completed"; state.finished_at = new Date().toISOString(); await persist(); return state;
  })().finally(() => running.delete(date));
  running.set(date, task); return task;
}
