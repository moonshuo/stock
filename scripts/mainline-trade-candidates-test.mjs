import assert from "node:assert/strict";
import { buildMainlineTradeCandidates } from "../lib/mainline-trade-candidates.js";

const theme = {
  primary: "电子元器件", name: "PCB", members: [{ code: "002636" }, { code: "000001" }],
  cycle_stage: {
    episode_id: "episode_1", episode_start_date: "2026-08-04",
    timeline: [
      { date: "2026-08-03", confirmed_stage: "strong_divergence", episode_id: "old_episode" },
      { date: "2026-08-05", confirmed_stage: "strong_divergence", episode_id: "episode_1" },
      { date: "2026-08-06", confirmed_stage: "normal_divergence", episode_id: "episode_1" },
    ],
  },
};
const day = (date, golden, sample) => ({ date, stocks: [
  { code: "002636", name: "金安国纪", changePct: golden, amount: 10, vol: 10 },
  { code: "000001", name: "样本股", changePct: sample, amount: 10, vol: 10 },
] });
const result = buildMainlineTradeCandidates({
  confirmed_mainlines: [theme], stocks: [{ code: "002636", name: "金安国纪" }, { code: "000001", name: "样本股" }],
  daily_history: [day("2026-08-03", -7.18, -1), day("2026-08-04", 7.92, 1), day("2026-08-05", 10.01, -2), day("2026-08-06", 5.61, -1)],
});
const golden = Object.values(result.mainline_trade_candidates).flat().find((item) => item.code === "002636");
assert.equal(golden.divergence_score, 15);
assert.deepEqual(golden.divergence_evidence.map((item) => item.date), ["2026-08-05", "2026-08-06"]);
console.log("mainline-trade-candidates-test: current-episode divergence scoring passed");
