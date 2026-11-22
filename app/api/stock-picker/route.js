import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { selectUnified } from '../../../lib/stock-picker/unified-picker.js';
import { createMarketStore } from '../../../lib/stock-picker/market-loader.js';
import { mainlineAt } from '../../../lib/stock-picker/adapters/mainline-leader-adapter.js';
import { validDate } from '../../../lib/stock-picker/ai-review.js';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const requested = q.get('date'), board = q.get('board') ?? 'main_board', limit = q.get('limit') ?? '10';
  if ((requested !== null && !validDate(requested)) || !['main_board', 'all'].includes(board) || !/^(?:[1-9]|10)$/.test(limit)) {
    return Response.json({ error: 'Invalid date, board or limit' }, { status: 400 });
  }
  try {
    const load = async file => JSON.parse(await readFile(file, 'utf8'));
    const [config, manifest] = await Promise.all([load('data/stock_picker_config.json'), load('output/stock-picker-eval/data_manifest.json')]);
    const date = requested ?? manifest.market.file_dates.filter(d => manifest.market.days[d]?.usable).sort().at(-1);
    if (!manifest.market.days[date]?.usable) return Response.json({ error: 'No market data for date' }, { status: 404 });
    config.universe = { ...config.universe, main_board: true, chinext: board === 'all', star: board === 'all' };
    config.max_candidates = Math.min(config.max_candidates, Number(limit));
    const helper = path.join(process.cwd(), 'lib/stock-picker/parquet_daily.py');
    const view = (await createMarketStore({ helper })).asOf(date);
    const ctx = { root: process.cwd(), config, manifest };
    let replay;
    const result = await selectUnified(view, { ...ctx, mainlineAt: v => replay ??= mainlineAt(v, ctx) });
    return Response.json({ ...result, as_of_date: date, cash_hint: result.candidates.length ? null : '当日无候选股，保持空仓。' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
