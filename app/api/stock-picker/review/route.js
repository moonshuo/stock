import { assertLocalAgentRequest } from '../../../../lib/agent-request.js';
import { reviewStockPicks, validateReview } from '../../../../lib/stock-picker/ai-review.js';

export async function POST(request) {
  try {
    assertLocalAgentRequest(request, { json: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
    validateReview(body.date, body.pickerResult);
    if (body.provider !== undefined && !['openai', 'chatgpt_oauth'].includes(body.provider)) throw Error('Invalid provider');
    if (body.model !== undefined && (typeof body.model !== 'string' || !body.model.trim())) throw Error('Invalid model');
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  const { date, pickerResult, model, provider } = body;
  try {
    return Response.json(await reviewStockPicks({ date, pickerResult, llmOptions: { model, provider } }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
