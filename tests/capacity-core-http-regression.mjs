import assert from "node:assert/strict";

const baseUrl = process.env.CAPACITY_CORE_BASE_URL || "http://127.0.0.1:3101";
const cases = [
  { date: "2026-11-20", primary: "厄尔尼诺影响", secondary: "能源电力生产" },
  { date: "2026-11-19", primary: "厄尔尼诺影响", secondary: "能源电力生产" },
  { date: "2026-11-18", primary: "厄尔尼诺影响", secondary: "能源电力生产" },
  { date: "2026-11-20", primary: "大金融", secondary: "保险" },
];

for (const input of cases) {
  const url = new URL("/api/capacity-core", baseUrl);
  for (const [key, value] of Object.entries(input)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  const result = await response.json();
  assert.equal(response.status, 200, `${input.date}: ${result.error || "unexpected response"}`);
  assert.equal(result.version, "3.7");
  assert.equal(result.date, input.date);
  assert.equal(result.source, "computed");
  assert.ok(Array.isArray(result.candidates) && result.candidates.length > 0);
  for (const candidate of result.candidates) {
    assert.ok(candidate.daily.every((day) => day.date < input.date), "只能使用目标日前行情");
  }
}

const invalid = await fetch(new URL("/api/capacity-core?date=invalid", baseUrl));
assert.equal(invalid.status, 400);
console.log("capacity-core HTTP regression passed");
