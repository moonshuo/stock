import assert from "node:assert/strict";
import { postSurgeCollapseEvidence } from "../app/lib/leaderCandidateRules.js";

const history = (returns) => returns.map((return_pct) => ({ return_pct }));

const qinAn = postSurgeCollapseEvidence("603758", history([9.97, 10.02, 9.97, 10.02, 10.04, -9.97, 2.89, -9.7, -9.97, -7.7]));
assert.equal(qinAn.collapsed, true, "连续两次跌停且近三日深跌的旧强势股必须退出当日龙头候选池");
assert.equal(qinAn.consecutiveLossDays, 3);
assert.equal(qinAn.recent3ReturnPct, -24.96);

const baoding = postSurgeCollapseEvidence("002552", history([10.01, 10, 5.16, 10, -2.65, 3.39, 2.23, -7.1, -9.98, 10.01]));
assert.equal(baoding.collapsed, false, "当天重新转强的股票不能因此前回撤被误剔除");

const chinext = postSurgeCollapseEvidence("300750", history([8, -8, -10, -11]));
assert.equal(chinext.collapsed, true, "连续三日累计深跌的创业板股票也必须触发退场规则");

console.log("leader candidate collapse contract passed");
