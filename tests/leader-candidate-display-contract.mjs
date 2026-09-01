import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageSource = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
const leaderResult = pageSource.match(/function LeaderResult\(\{ result \}\) \{([\s\S]*?)\n\}\n\nfunction MainlineHistoryModal/)?.[1] || "";

assert.ok(leaderResult, "LeaderResult component must exist");
assert.match(leaderResult, /const \[showAll, setShowAll\] = useState\(false\)/, "leader modal must track expanded state");
assert.match(leaderResult, /const allRows = result\.candidates \|\| \[\]/, "leader modal must retain the complete candidate list");
assert.match(leaderResult, /showAll \? allRows : allRows\.slice\(0, 5\)/, "collapsed leader modal should show the top five candidates");
assert.match(leaderResult, /查看全部 \$\{allRows\.length\} 只股票/, "leader modal must expose every returned candidate");
assert.match(leaderResult, /收起列表/, "expanded leader modal must be collapsible");

console.log("leader candidate display contract passed");
