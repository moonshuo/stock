import { readdir, rm, unlink } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { clearDailyMarketMemoryCache } from "../daily-market/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OUTPUT_DIR = path.join(process.cwd(), "output");

export async function POST() {
  try {
    let removed = 0;
    try {
      const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
      const targets = entries
        .filter((entry) => entry.isFile() && /^mainline_response_.*\.json$/i.test(entry.name))
        .map((entry) => path.join(OUTPUT_DIR, entry.name));
      await Promise.all(targets.map(async (filePath) => { await unlink(filePath); removed += 1; }));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await Promise.all([
      rm(path.join(process.cwd(), "data", "capacity_core"), { recursive: true, force: true }),
      rm(path.join(process.cwd(), "data", "leader"), { recursive: true, force: true }),
      rm(path.join(process.cwd(), "data", "leader-v5"), { recursive: true, force: true }),
      unlink(path.join(OUTPUT_DIR, "cycle_state_checkpoints.json")).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      }),
    ]);
    clearDailyMarketMemoryCache();
    return NextResponse.json({ cleared: true, removed_response_cache_files: removed });
  } catch (error) {
    return NextResponse.json({ error: `清除分析缓存失败：${error.message}` }, { status: 500 });
  }
}
