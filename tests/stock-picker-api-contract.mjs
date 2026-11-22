import assert from 'node:assert/strict';
import { reviewStockPicks } from '../lib/stock-picker/ai-review.js';
import { GET } from '../app/api/stock-picker/route.js';
import { POST } from '../app/api/stock-picker/review/route.js';

const date = '2026-11-12';
const stock = { code: '000001', sector_context: { cycle_stage: 'repair' } };
const pickerResult = { date, candidates: [stock] };
let calls = 0;
const item = { code: stock.code, verdict: 'caution', core_logic: '修复', conflict_or_risk: '观察分歧', watch_trigger: '确认持续性' };
const fetchImpl = async (url, init) => {
  calls++;
  const body = JSON.parse(init.body);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  const prompt = JSON.parse(body.messages[1].content);
  assert.equal(prompt.candidates[0].primary_sector, '金融');
  assert.equal(prompt.candidates[0].cycle_stage, 'repair');
  assert.deepEqual(prompt.notes.map(n => n.content), ['prior']);
  const content = JSON.stringify({ market_summary: '修复', items: [{ ...item, verdict: ' CAUTION ', extra: true }] });
  return Response.json({ choices: [{ message: { content } }] });
};
const options = { date, pickerResult, fetchImpl, sectorMap: { stocks: [{ code: stock.code, primary_sector: '金融' }] },
  notes: { notes: [
    { title: '20261112', content: 'prior', updatedAt: '2026-11-12T07:00:00Z' },
    { title: '20261113', content: 'future' },
    { title: '20261111', updatedAt: '2026-11-12T17:00:00Z', content: 'future edit' },
  ] }, llmOptions: { apiKey: 'mock', provider: 'openai' } };
const empty = { date, candidates: [] };
assert.equal((await reviewStockPicks({ ...options, pickerResult: empty })).reason, 'no_candidates');
assert.equal(calls, 0);
assert.deepEqual((await reviewStockPicks(options)).items, [item]);
assert.equal(calls, 1);
const url = 'http://localhost/api/stock-picker';
for (const query of ['date=2026-02-30', 'date=', 'limit=0', 'limit=11', 'board=invalid']) {
  const response = await GET(new Request(url + '?' + query));
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error);
}
const post = (body, origin = url) => POST(new Request(origin, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
const payload = { date, pickerResult: empty };
assert.equal((await post('{')).status, 400);
for (const bad of [{ date }, { ...payload, provider: 'other' }, { ...payload, date: '2026-11-11' }]) {
  assert.equal((await post(JSON.stringify(bad))).status, 400);
}
assert.equal((await post(JSON.stringify(payload), 'https://example.org')).status, 403);
assert.equal((await (await post(JSON.stringify(payload))).json()).skipped, true);
console.log('stock-picker-api-contract PASS');
