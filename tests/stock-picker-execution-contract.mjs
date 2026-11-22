import assert from 'node:assert/strict';
import {evaluateSignal,evaluateBenchmark,summarizeEvaluations} from '../lib/stock-picker/evaluator.js';
const dates=['2025-03-03','2025-03-04','2025-03-05','2025-03-06','2025-03-07','2025-03-10','2025-03-11','2025-03-12','2025-03-13','2025-03-14','2025-03-17'];
const date=dates[0],code='000001',endDate=dates.at(-1);
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-10,`${a} != ${b}`);
const row={code,name:'平安银行',open:10,high:11,low:9.5,close:10,preClose:10,amount:1e8,volume:1e6};
function run(edits={},opts={}){return evaluateSignal({date,code,dates,endDate,readDay:d=>{const i=dates.indexOf(d),r=edits[i];return r===false?{date:d,status:'unavailable',stocks:[]}:{date:d,status:'ok',stocks:r===null?[]:[{...row,...r}]};},...opts});}
const filled=await run({1:{close:10.2},2:{preClose:10.2},3:{high:11.2,low:9.1,close:10.8},4:{preClose:10.8}});
assert.equal(filled.entry_date,dates[1]);assert.equal(filled.entry_open,10);assert.equal(filled.status,'filled');
assert.equal(filled.horizons[1].status,'mark_only');assert.equal(filled.horizons[1].exit_date,null);assert.equal(filled.horizons[1].net_return,null);near(filled.horizons[1].gross_return,.02);
assert.equal(filled.horizons[3].exit_date,dates[3]);near(filled.horizons[3].net_return,.0775);near(filled.horizons[3].gross_return,.08);near(filled.horizons[3].mfe,.12);near(filled.horizons[3].mae,-.09);assert.equal(filled.horizons[10].exit_date,endDate);
near((await run({},{cost:.01})).horizons[5].net_return,-.01);
const flat=p=>({open:p,high:p,low:p,close:p});
for(const r of [null,false,{amount:0},{volume:0},flat(11)]){const x=await run({1:r});assert.equal(x.status,'unfillable');assert.equal(x.horizons[10].net_return,null);}
assert.equal((await run({1:{...flat(10.5),name:'*ST 测试'}})).reason,'one_price_limit_up');
assert.equal((await run({1:{...flat(10.5),name:null}})).status,'unavailable');
assert.equal((await run({1:{open:11,high:11,low:10.8,close:10.9}})).status,'filled');
assert.equal((await run({1:{...flat(12),noPriceLimit:true}})).status,'filled');
assert.equal((await run({1:{...flat(10.33),upperLimit:10.33}})).reason,'one_price_limit_up');
const floor=await run({3:flat(9),4:{preClose:9}});assert.equal(floor.horizons[3].status,'unfillable');assert.equal(floor.horizons[3].net_return,null);assert.equal(floor.horizons[5].status,'ok');
assert.equal((await run({3:{amount:0}})).horizons[3].status,'unfillable');
for(const absent of [false,null]){const x=await run({2:absent});assert.equal(x.horizons[1].status,'mark_only');for(const h of [3,5,10])assert.equal(x.horizons[h].status,'unavailable');}
assert.equal((await run({2:{preClose:8}})).horizons[3].reason,'reference_price_reset');
const reads=[];const b=await run({},{endDate:dates[2],readDay:d=>{reads.push(d);assert(d<=dates[2]);return {date:d,status:'ok',stocks:[row]};}});assert.deepEqual(reads,dates.slice(1,3));assert.equal(b.horizons[3].reason,'outside_label_window');
const last=await run({},{date:endDate,readDay:()=>assert.fail('boundary read')});assert.equal(last.status,'unavailable');
await assert.rejects(run({},{readDay:d=>({date,status:'ok',stocks:[row]})}),/clock mismatch/);await assert.rejects(run({},{readDay:d=>({date:d,status:'ok',stocks:[row,row]})}),/Duplicate/);
const calls=[];const bench=await evaluateBenchmark({date,dates,endDate,cost:.01,readDay:d=>{calls.push(d);return {date:d,status:'ok',stocks:[row,{...row,code:'600001',name:null}, {...row,code:'600002',name:'*ST样本'},{...row,code:'300001'},{...row,code:'600003',...(d===dates[1]?flat(11):{})}]};}});
assert.deepEqual(calls,dates);assert.equal(bench.historical_st_unknown,1);assert.equal(bench.horizons[3].eligible,3);assert.equal(bench.horizons[3].observed,2);near(bench.horizons[3].net_return,-.01);
const sample=(score,x,d=date)=>({...filled,date:d,score,market_regime:'selective',cycle:'修复',benchmark:{...bench,date:d},horizons:{...filled.horizons,3:{...filled.horizons[3],net_return:x}}});
const records=[sample(1,-.1),sample(2,-.05),sample(3,0),sample(4,.05),sample(5,.1),sample(1,-.2,dates[1])];
const s=summarizeEvaluations(records,{dates});assert.equal(s.coverage.signals,6);assert.equal(s.coverage.quintile_eligible,5);assert.equal(s.by_horizon[3].count,6);assert.equal(s.by_cycle['修复'][3].total,6);assert.equal(s.by_regime.selective[3].nonoverlapping_baskets,1);near(s.by_horizon[3].median_return,-.025);near(s.by_horizon[3].win_rate,2/6);near(s.by_horizon[3].payoff_ratio,.075/(.35/3));near(s.by_quintile.Q5[3].mean_return,.1);assert.equal(s.quintile_monotonicity[3],true);assert.equal(s.downside_scenarios[3][0].losses,3);near(s.paired_benchmark[3].strategy_mean,-.1);near(s.paired_benchmark[3].mean_excess,-.09);
const tied=summarizeEvaluations(records.slice(0,5).map(r=>({...r,score:1})),{dates});assert.equal(tied.by_quintile.Q3[3].count,5);assert.equal(tied.quintile_monotonicity[3],null);
const dd=summarizeEvaluations([sample(1,-.1),sample(1,.2,dates[3]),sample(1,-.25,dates[6])],{dates});near(dd.by_horizon[3].max_drawdown,-.25);
const empty=summarizeEvaluations([],{dates});assert.equal(empty.by_horizon[3].count,0);assert.equal(empty.by_horizon[3].mean_return,null);assert.equal(empty.paired_benchmark[3].mean_excess,null);
console.log('PASS clock, split, execution constraints, reference resets, friction, excursions, coverage, paired benchmark, quintiles and drawdown');
