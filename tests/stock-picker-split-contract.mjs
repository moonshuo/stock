import assert from 'node:assert/strict';
import {evalOptions} from '../lib/stock-picker/types.js';
import {replay,claimHoldout} from '../lib/stock-picker/evaluation-run.js';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
assert.throws(()=>evalOptions(['--split','oos','--strategy','unified','--from','2026-07-02']));
assert.throws(()=>evalOptions(['--split','is','--to','2026-07-01']));
const T='2026-06-30', next='2026-07-01',reads=[];
const store={dates:[T,next],asOf(date){return{asOfDate:date,day(d){reads.push(d);return{date:d,stocks:[]}}}}};
let count=0;await replay({options:evalOptions(['--split','is','--from',T]),store,selectors:{toy:async v=>({date:v.asOfDate,status:'ok',candidates:[{code:'000001',score:2}]})},onSelection:()=>{},onObservation:()=>{count++},label:async({readDay,endDate})=>{assert.equal(endDate,T);await assert.rejects(readDay(next),/outside split/);return null;}});assert.equal(count,1);assert.deepEqual(reads,[]);
// Disposable mock: never touches the repository OOS marker and never reads market data.
const root=await mkdtemp(join(tmpdir(),'picker-freeze-')),dir=join(root,'output','stock-picker-eval');await mkdir(dir,{recursive:true});
const hash=s=>createHash('sha256').update(s).digest('hex');const configBytes=Buffer.from('test config');await writeFile(join(dir,'baseline_report.json'),'test IS');await writeFile(join(dir,'freeze.json'),JSON.stringify({config_sha256:hash(configBytes),is_report_sha256:hash('test IS')}));await assert.rejects(claimHoldout({root,configBytes:Buffer.from('changed')}));await claimHoldout({root,configBytes});await assert.rejects(claimHoldout({root,configBytes}),{code:'EEXIST'});console.log('PASS split bounds, IS labels cannot cross into OOS, immutable config and duplicate holdout guard');
