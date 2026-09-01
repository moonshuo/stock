import assert from "node:assert/strict";
import {
  createMainlineDiskSnapshot,
  decodeMainlineResponseCache,
  encodeMainlineResponseCache,
} from "../lib/mainline-persistence.js";

const history = Array.from({ length: 20 }, (_, index) => ({
  date: `2026-08-${String(index + 1).padStart(2, "0")}`,
  score: { mainline_rank_score: 60 + index },
  daily_strength_score: 50 + index,
  metrics: { member_count: 10, theme_amount: 1_000_000_000 + index },
}));
const theme = {
  key: "电子__半导体",
  primary: "电子",
  name: "半导体",
  rank: 1,
  score_history: history,
};
const automaticModules = {
  requested: 1,
  capacity: { "2026-09-01|电子|半导体": { candidates: Array.from({ length: 100 }, (_, index) => ({ code: String(index), score: index })) } },
  leader: { "2026-09-01|电子|半导体": { candidates: Array.from({ length: 100 }, (_, index) => ({ code: String(index), score: index })) } },
  failures: [],
  selection: "ranked_themes_with_sufficient_data",
};
const response = {
  version: "test",
  date: "2026-09-01",
  themes: [theme],
  all_themes: [theme],
  requested_theme: theme,
  mainline: { ranked: [theme] },
  automatic_modules: automaticModules,
};

const snapshot = createMainlineDiskSnapshot(response);
assert.equal(snapshot.storage_schema_version, 1);
assert.equal(snapshot.themes.length, 1, "disk snapshot must persist one canonical theme collection");
assert.equal("all_themes" in snapshot, false, "disk snapshot must not duplicate the theme collection");
assert.deepEqual(snapshot.mainline.ranked_theme_keys, [theme.key]);
assert.equal("score_history" in snapshot.themes[0], false, "disk snapshot must not persist the full historical timeline");
assert.equal(snapshot.themes[0].score_history_summary.points, history.length);
assert.equal(snapshot.themes[0].score_history_summary.latest.date, history.at(-1).date);
assert.equal(snapshot.automatic_modules.completed_capacity, 1);
assert.equal(snapshot.automatic_modules.completed_leader, 1);
assert.equal("capacity" in snapshot.automatic_modules, false, "disk snapshot must not embed full capacity payloads");
assert.equal("leader" in snapshot.automatic_modules, false, "disk snapshot must not embed full leader payloads");
assert.ok(JSON.stringify(snapshot).length < JSON.stringify(response).length / 4, "disk snapshot should be materially smaller than the API response");

const cacheDocument = { cache_fingerprint: "fingerprint", cached_at: "2026-09-01T00:00:00.000Z", result: response };
const encoded = await encodeMainlineResponseCache(cacheDocument);
const decoded = await decodeMainlineResponseCache(encoded);
assert.deepEqual(decoded, cacheDocument, "compressed historical cache must round-trip without changing algorithm output");
assert.ok(encoded.length < Buffer.byteLength(JSON.stringify(cacheDocument)) / 2, "historical cache should be compressed on disk");

console.log("mainline persistence contract passed");
