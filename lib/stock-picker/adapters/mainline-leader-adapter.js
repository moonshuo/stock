// Offline replay of the default (no network/core enrichment) production endpoint.
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker, workerData, parentPort } from 'node:worker_threads';
import { buildTradePlan } from '../../trading/action-state-machine.js';

const workerTag = 'stock-picker-asof-mainline-v1';
const dataError = message => Object.assign(new Error(message), {code:'MAINLINE_INPUT_UNAVAILABLE'});
const cacheDir = 'output/stock-picker-eval/mainline-cache';
const cycleMissing = 'production_mainline_does_not_emit_lifecycle';
const caveats = {static_taxonomy_caveat:true, taxonomy_includes_static_name_exclusions:true};
const empty = (date, reason) => ({date,status:'unavailable',reasons:[reason],themes:[],tertiary_themes:[],candidates:[],cycle_stage:null,cycle_status:'unavailable',leading_replay_cycle_stage:null,replay_cycle_window:null,historical_name_coverage:null,...caveats});
const json = async f => JSON.parse(await readFile(f,'utf8'));
const hash = x => createHash('sha256').update(x).digest('hex');
const fingerprints = new WeakMap();
function quoteHash(day) {
  // The market-store contract supplies immutable days/rows. Never memoize a mutable test view.
  const immutable = Object.isFrozen(day) && Object.isFrozen(day.stocks) && day.stocks.every(Object.isFrozen);
  if (immutable && fingerprints.has(day)) return fingerprints.get(day);
  const h=hash(JSON.stringify(day.stocks));
  if(immutable) fingerprints.set(day,h);
  return h;
}

// Capture all auxiliary inputs consulted by production on these exact dates, never a
// latest-data directory. Existing metadata contents, not only directory mtimes, key reuse.
async function inputs(root, days) {
  const h=createHash('sha256'), missingDirs=[];
  for(const file of ['data/stock_sector_map.json','data/mainline_config.json','data/cycle_config.json','data/emergence_config.json','data/trading_config.json','lib/mainline.js','lib/mainline/cycle-metrics.js','lib/mainline/cycle-stage-detector.js','lib/intraday5m.js','lib/backtest-market-metadata.js','app/lib/sectorSystem.js','lib/trading/action-state-machine.js','lib/stock-picker/adapters/mainline-leader-adapter.js']) {
    h.update(file+':'+hash(await readFile(path.join(root,file))));
  }
  for (const day of days) {
    h.update(day.date+':'+quoteHash(day));
    const index=path.join(root,'data','historical_market_cap_index',day.date+'.json');
    try { h.update('index:'+hash(await readFile(index))); } catch(e){if(e.code!=='ENOENT')throw e;h.update('no-index');}
    for(const base of ['capacity_core','historical_market_cap','daily_turnover_rate']) {
      const dir=path.join(root,'data',base,day.date);h.update(base+'\0');
      let files;try{files=await readdir(dir);}catch(e){if(e.code!=='ENOENT')throw e;missingDirs.push(dir);h.update('absent');continue;}
      files=files.filter(n=>n.endsWith('.json')).sort();
      for(let i=0;i<files.length;i+=32){const part=files.slice(i,i+32);const hashes=await Promise.all(part.map(async n=>hash(await readFile(path.join(dir,n)))));part.forEach((n,j)=>h.update(JSON.stringify([n,hashes[j]])));}
    }
  }
  return {id:h.digest('hex'),missingDirs};
}

// Replay only the scoring window. This is NOT a recovered live episode or a production
// trade-plan input. Match applyCycleStages' initial state and transition order exactly.
function replayCycle(history, dates, config, cycleScores, detectCycleStage) {
  if (!history?.length) return null;
  if (history.length!==dates.length || history.some((row,i)=>row.date!==dates[i]||row.metrics?.date!==dates[i])) throw Error('Misaligned cycle replay metrics');
  const metrics=[];let state={cycle_stage:'unstarted',stage_confidence:0.35,episode_sequence:0};
  for(const obs of history){metrics.push(obs.metrics);state=detectCycleStage(metrics,cycleScores(metrics,config),config,state);}
  return state.cycle_stage??null;
}
function compact(result, config, quotes, replay) {
  const plan=buildTradePlan(result,config), actions=new Map(plan.themes.map(a=>[a.theme_key,a]));
  const byCode=new Map(quotes.map(q=>[q.code,q])), candidates=new Map();
  const kept=new Set(['entry_candidate','probe_candidate','add_candidate']);
  const board=t=>({key:t.key,primary:t.primary,secondary:t.secondary,name:t.name,status:t.status,
    score:t.score??null,rank:t.rank??null,mainline_rank_score:t.mainline_rank_score??null,mainline_rank:t.mainline_rank??null,
    daily_strength_score:t.daily_strength_score??null,confirmed_mainline:t.is_confirmed_mainline===true,cycle_stage:t.cycle_stage?.cycle_stage??null});
  const themes=result.themes.map(t=>{
    const a=actions.get(t.key), b=board(t);
    // Only the stock-level action is tradable. A theme entry does not override a weak stock.
    if(a && b.cycle_stage && t.core_structure_evidence?.cache_ready && kept.has(a.theme_action)) {
      for(const stock of a.eligible_stocks.filter(s=>kept.has(s.stock_action)&&['leader','capacity_core'].includes(s.role))) {
        const q=byCode.get(stock.code);if(!q)continue;
        const score=a.scores.entry_quality;const existing=candidates.get(stock.code);
        if(!existing || score>existing.score) candidates.set(stock.code,{code:stock.code,name:q.name??null,score,
          historical_name_status:q.name?'available':'unavailable',st_eligibility:q.name?'requires_asof_name_check':'unverified_missing_asof_name',
          sector_context:{key:b.key,primary:b.primary,secondary:b.secondary,role:stock.role,cycle_stage:b.cycle_stage,theme_action:a.theme_action,stock_action:stock.stock_action,mainline_rank:b.mainline_rank},
          invalidation_rules:stock.invalidation_conditions,risk_warnings:q.name?[]:['historical_name_and_st_status_unverified']});
      }
    }
    return {...b,replay_cycle_stage:replay(t.score_history),theme_action:a?.theme_action??null,core_evidence_ready:t.core_structure_evidence?.cache_ready===true,
      action_missing:a?.missing_data??[],qualification_gaps:a?.qualification_gaps??[]};
  });
  const hasCycle=themes.some(t=>t.cycle_stage), top=themes[0];
  const reasons=[...(!result.mainline_eligible?['incomplete_market_cross_section']:[]),...(!themes.length?['no_scored_themes']:[])];
  return {date:result.date,status:reasons.length?'unavailable':'ok',reasons,source:'analyzeMainlines+buildTradePlan',...caveats,
    history_dates:result.market_summary?.history_dates||[],mainline_eligible:result.mainline_eligible,
    leading_replay_cycle_stage:top?.replay_cycle_stage??null,
    replay_cycle_window:{source:'score_history.metrics -> cycleScores -> detectCycleStage',start:result.history_start_date,end:result.history_end_date,trading_days:result.history_trading_days,initial_stage:'unstarted',warmup:'window_only_no_pre_window_state',applied_to_production_actions:false},
    historical_name_coverage:{named:quotes.filter(q=>q.name).length,total:quotes.length,missing_name_st_eligibility:'unverified'},
    cycle_stage:top?.cycle_stage??null,cycle_status:hasCycle?'available':'unavailable',cycle_reason:hasCycle?null:cycleMissing,
    themes,tertiary_themes:(result.tertiary_themes||[]).map(board),
    candidates:[...candidates.values()].sort((a,b)=>b.score-a.score||a.code.localeCompare(b.code))};
}

// Negative-directory indexing is confined to a disposable Worker and to the three
// production modules below. For an absent date directory every child lookup would
// throw ENOENT; do not synthesize empty pools, scores, turnover or cap values.
const missing=new Set(workerData?.tag===workerTag?workerData.missingDirs:[]);
const noFile=Object.assign(new Error('No such file in indexed historical date directory'),{code:'ENOENT'});
export function indexedReadFileSync(file,...args){if(typeof file==='string'&&missing.has(path.dirname(file)))throw noFile;return readFileSync(file,...args);}
export async function indexedReadFile(file,...args){if(typeof file==='string'&&missing.has(path.dirname(file)))throw noFile;return readFile(file,...args);}
async function computeWorker() {
  if(missing.size){
    const {registerHooks}=await import('node:module');
    const scoped=new Set(['../../mainline.js','../../intraday5m.js','../../mainline/cycle-metrics.js'].map(p=>new URL(p,import.meta.url).href));
    const wrappers=new Map([['fs','readFileSync'],['fs/promises','readFile']].map(([id,fn])=>[id,'data:text/javascript,'+encodeURIComponent(`export * from 'node:${id}'; export { indexed${fn[0].toUpperCase()+fn.slice(1)} as ${fn} } from ${JSON.stringify(import.meta.url)};`)]));
    registerHooks({resolve(id,context,next){return scoped.has(context.parentURL)&&wrappers.has(id)?{url:wrappers.get(id),shortCircuit:true}:next(id,context);}});
  }
  const {date,days,closed,config}=workerData, byDate=new Map(days.map(d=>[d.date,{date:d.date,stocks:d.stocks,totalStocks:d.stocks.length}]));
  const {analyzeMainlines}=await import('../../mainline.js');
  const result=await analyzeMainlines(date,async d=>{
    if(d>date)throw Error('Production requested future date '+d);
    if(byDate.has(d))return byDate.get(d);
    if(closed.includes(d))return {error:'verified_calendar_closure',status:404,source:'non-trading-day'};
    throw Error('Production requested date outside verified replay window '+d);
  });
  const [{cycleScores},{detectCycleStage},cycle,emergence]=await Promise.all([
    import('../../mainline/cycle-metrics.js'),import('../../mainline/cycle-stage-detector.js'),
    json(path.join(process.cwd(),'data/cycle_config.json')),json(path.join(process.cwd(),'data/emergence_config.json'))]);
  const cycleConfig={...cycle,emergence};
  parentPort.postMessage(compact(result,config,byDate.get(date).stocks,history=>replayCycle(history,days.map(d=>d.date),cycleConfig,cycleScores,detectCycleStage)));
}
// Do not await at module top level: scoped fs wrappers import our read-only helpers.
if(workerData?.tag===workerTag)void computeWorker().catch(e=>{parentPort.postMessage({worker_error:e.stack||String(e)});});
function calculate(data) {
  return new Promise((resolve,reject)=>{
    const w=new Worker(fileURLToPath(import.meta.url),{workerData:{tag:workerTag,...data},execArgv:[]});
    let received=false;
    w.once('error',reject);w.once('message',msg=>{received=true;msg.worker_error?reject(Error(msg.worker_error)):resolve(msg);});
    w.once('exit',code=>{if(code!==0||!received)reject(Error(`Mainline worker exited ${code} before completion`));});
  });
}
const pending=new Map();
export async function mainlineAt(view,ctx={}) {
  const date=view.asOfDate,root=path.resolve(ctx.root||process.cwd());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Invalid asOfDate');
  if(root!==path.resolve(process.cwd()))throw Error('Production mainline resolves its data from process.cwd(); refusing different ctx.root');
  if(!view.dates.includes(date))return empty(date,'asof_target_not_in_market_calendar');
  const {loadMainlineHistory}=await import('../../mainline.js');
  const config=await json(path.join(root,'data/mainline_config.json'));
  const closed=[];let history;
  try{history=await loadMainlineHistory(date,async d=>{
    if(d>date)throw Error('Future market request '+d);
    if(ctx.manifest?.calendars?.[d.slice(0,4)]?.recorded_closed_dates?.includes(d)&&!ctx.manifest.market?.days?.[d]){
      closed.push(d);return {error:'verified_calendar_closure',status:404,source:'non-trading-day'};
    }
    if(!view.dates.includes(d))throw dataError('unverified_or_missing_session:'+d);
    const day=await view.day(d);
    if(day.date!==d)throw Error('Replay date mismatch: '+d);
    if(day.status!=='ok'||!day.stocks?.length)throw dataError('unavailable_session:'+d+':'+(day.reason||'no_usable_close'));
    return day;
  },config);}catch(e){if(e.code==='MAINLINE_INPUT_UNAVAILABLE')return empty(date,e.message);throw e;}
  const days=history.days;
  if(days.length!==config.window_days||days.at(-1)?.date!==date)return empty(date,'incomplete_exact_date_window');
  const {id,missingDirs}=await inputs(root,days), dir=path.join(root,cacheDir),file=path.join(dir,`${date}-${id}.json`);
  const run=async()=>{
    try{const cached=await json(file);if(cached.cache_input_sha256!==id||cached.date!==date)throw Error('Research cache identity mismatch');return cached;}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const result=await calculate({date,days:days.map(d=>({date:d.date,stocks:d.stocks})),closed,missingDirs,config:await json(path.join(root,'data/trading_config.json'))});
    const out={...result,cache_input_sha256:id};
    await mkdir(dir,{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(out));await rename(tmp,file);return out;
  };
  if(!pending.has(file))pending.set(file,run().finally(()=>pending.delete(file)));
  return pending.get(file);
}
export async function selectMainlineLeader(view,ctx) {
  const {date,status,candidates,reasons,themes,cycle_status,leading_replay_cycle_stage,replay_cycle_window,historical_name_coverage}=await mainlineAt(view,ctx);
  const actionableData=themes.some(t=>t.core_evidence_ready&&t.cycle_stage);
  return {date,status:status==='ok'&&actionableData?'ok':'unavailable',candidates,
    reasons:[...reasons,...(cycle_status==='unavailable'?[cycleMissing]:[]),...(themes.length&&!themes.some(t=>t.core_evidence_ready)?['leader_or_capacity_analysis_pending_offline']:[])],
    action_source:'buildTradePlan',score_source:'entry_quality',leading_replay_cycle_stage,replay_cycle_window,historical_name_coverage,...caveats};
}
