import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {WINDOWS} from './types.js';

/** Evaluate without granting the picker access to label reads (or a mutable shared row). */
export async function replay({options,store,selectors,onSelection,onObservation,label,cost=.0025}) {
  const dates=store.dates;
  // Never cross into OOS for IS labels, even if the last IS signal has no forward window.
  const labelEnd=options.split==='is'?WINDOWS.is[1]:dates.at(-1);
  for(const date of dates.filter(d=>d>=options.from&&d<=options.to)) {
    const view=store.asOf(date);
    for(const [strategy,select] of Object.entries(selectors)) {
      const result=await select(view);
      if(!result||result.date!==date||!['ok','unavailable'].includes(result.status)||!Array.isArray(result.candidates))throw Error(`Bad selection envelope: ${strategy} ${date}`);
      if(result.status==='unavailable' && result.candidates.length)throw Error('Unavailable selector emitted candidates');
      const seen=new Set();for(const c of result.candidates){if(!/^\d{6}$/.test(c.code)||!Number.isFinite(c.score)||seen.has(c.code))throw Error(`Invalid/duplicate score ${strategy} ${date}`);seen.add(c.code);}
      await onSelection(strategy,result);
      const readDay=async d=>{if(d<date||d>labelEnd)throw Error(`Label outside split: ${d}`);return store.asOf(d).day(d);};
      for(const c of result.candidates){const observed=await label({date,code:c.code,dates,readDay,endDate:labelEnd,cost});await onObservation(strategy,result,c,observed);}
    }
  }
}
export async function claimHoldout({root,configBytes}){
  const dir=path.join(root,'output/stock-picker-eval');await mkdir(dir,{recursive:true});
  const hash=createHash('sha256').update(configBytes).digest('hex');
  const frozen=JSON.parse(await readFile(path.join(dir,'freeze.json'),'utf8'));
  if(frozen.config_sha256!==hash||!frozen.is_report_sha256)throw Error('Configuration not frozen against the development-period report');
  const actual=createHash('sha256').update(await readFile(path.join(dir,'baseline_report.json'))).digest('hex');
  if(actual!==frozen.is_report_sha256)throw Error('Development report differs from frozen evidence');
  for(const [file,expected] of Object.entries(frozen.frozen_inputs||{})){const resolved=path.resolve(root,file);if(!resolved.startsWith(path.resolve(root)+path.sep))throw Error('Invalid frozen input');const observed=createHash('sha256').update(await readFile(resolved)).digest('hex');if(observed!==expected)throw Error('Frozen input changed: '+file);}
  await writeFile(path.join(dir,'oos-attempt.json'),JSON.stringify({started_at:new Date().toISOString(),config_sha256:hash,baseline_sha256:actual,frozen_at:frozen.frozen_at??null})+'\n',{flag:'wx'});
}
export async function runEvaluation(options){
  // The research driver is separated from the phase-1 execution engine. No default proxy algorithms.
  const {runResearch}=await import('./research-driver.js');return runResearch(options,{replay,claimHoldout});
}
