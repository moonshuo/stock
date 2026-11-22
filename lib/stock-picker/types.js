/** Point-in-time contracts. A selector receives this restricted view, never the label store.
 * @typedef {{asOfDate:string, dates:readonly string[], day:(date:string)=>Promise<object>}} SignalView
 * @typedef {{code:string,name?:string,score:number,sector_context?:object,risk_warnings?:string[]}} Candidate
 * @typedef {{date:string,status:'ok'|'unavailable',market_regime?:string,candidates:Candidate[],reasons?:string[]}} Selection
 * Dates are exchange-local YYYY-MM-DD; cost is a fraction, never a percentage point.
 */
export const WINDOWS = Object.freeze({is:['2025-01-02','2026-06-30'], oos:['2026-07-01','2026-11-12']});
export const HORIZONS = Object.freeze([1,3,5,10]);
export function evalOptions(argv) {
  const args={strategy:'all', split:'is'}; const supported=new Set(['strategy','split','from','to']);
  for(let i=0;i<argv.length;i+=2){const key=argv[i]?.slice(2); if(!argv[i]?.startsWith('--') || !supported.has(key)|| !argv[i+1] || argv[i+1].startsWith('--')) throw Error(`Invalid evaluation argument ${argv[i]}`);args[key]=argv[i+1];}
  const range=WINDOWS[args.split];if(!range) throw Error('split must be is or oos');
  const known=['all','unified','mainline-leader','strong-pullback','green-limit-up','uptrend-score']; if(!known.includes(args.strategy))throw Error(`Unknown strategy: ${args.strategy}`);
  args.from??=range[0];args.to??=range[1];
  for(const d of [args.from,args.to])if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('Invalid date');
  if(args.from<range[0] || args.to>range[1] || args.from>args.to)throw Error('Requested signal range outside selected split');
  if(args.split==='oos' && (args.strategy!=='unified'||args.from!==range[0]||args.to!==range[1]))throw Error('OOS limited to one full-window frozen unified evaluation');
  return Object.freeze(args);
}
