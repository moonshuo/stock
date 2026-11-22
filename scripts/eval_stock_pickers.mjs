import {evalOptions} from '../lib/stock-picker/types.js';

// This CLI never silently substitutes a selector or evaluates a fallback strategy.
if(process.argv.includes('--help')) {
  console.log('node scripts/eval_stock_pickers.mjs --strategy all|mainline-leader|strong-pullback|green-limit-up|uptrend-score|unified --split is|oos [--from YYYY-MM-DD --to YYYY-MM-DD]');
} else {
  const options=evalOptions(process.argv.slice(2));
  const {runEvaluation}=await import('../lib/stock-picker/evaluation-run.js');
  await runEvaluation(options);
}
