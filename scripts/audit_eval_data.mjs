// Offline, read-only inventory of raw inputs. Run from the repository root.
import { readdir, readFile, open, mkdir, writeFile } from 'node:fs/promises';
import { asyncBufferFromFile, parquetMetadataAsync } from 'hyparquet';

const parquetRoot = '5分钟数据';
const output = 'output/stock-picker-eval';
const required = ['code','date','trade_time','open','high','low','close','pre_close','vol','amount'];
const windows = { is: ['2025-01-02','2026-06-30'], oos: ['2026-07-01','2026-11-12'], turnover_subset: ['2026-07-24','2026-10-28'] };
const validDate = d => /^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
const weekday = d => ![0,6].includes(new Date(d).getUTCDay());
const json = file => readFile(file,'utf8').then(JSON.parse);
async function list(dir, optional=false) {
  try { return (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
  catch(e) { if(optional && e.code==='ENOENT') return null; throw e; }
}
const problems = [];
const schemas = [], days = {}, closed = new Set(), calendars = {};
for(const entry of await list('data/ashare_trading_calendar',true) || []) {
  if(!/^\d{4}\.json$/.test(entry.name)) continue;
  const c=await json(`data/ashare_trading_calendar/${entry.name}`);
  if(!Array.isArray(c.closed_dates) || `${c.year}.json`!==entry.name || !c.closed_dates.every(d=>validDate(d)&&d.startsWith(`${c.year}-`))) throw new Error(`invalid calendar: ${entry.name}`);
  c.closed_dates.forEach(d=>closed.add(d)); calendars[c.year]={source_url:c.source_url,recorded_closed_dates:c.closed_dates,coverage:'explicit closure entries only; unlisted weekdays not assumed open'};
}
function statRange(groups, column, key, compare) {
  const values = groups.map(g=>g.columns.find(c=>c.meta_data.path_in_schema.join('.')===column)?.meta_data.statistics?.[key]);
  if(!values.length || values.some(v=>v==null)) return null;
  const value=values.reduce((a,b)=>compare(a,b)?a:b);
  // hyparquet maps TIMESTAMP(isAdjustedToUTC=false) to Date. Its UTC components
  // carry the encoded wall clock; host-local Date.toString() corrupts it.
  return value instanceof Date ? value.toISOString().slice(0,19).replace('T',' ') : value.toString();
}
for(const dir of await list(parquetRoot)) {
  if(!dir.isDirectory() || !/^\d{4}$/.test(dir.name)) continue;
  for(const f of await list(`${parquetRoot}/${dir.name}`)) {
    if(!f.isFile() || !f.name.endsWith('.parquet')) continue;
    const file=`${parquetRoot}/${dir.name}/${f.name}`, date=f.name.slice(0,-8).replace(/^(\d{4})(\d\d)(\d\d)$/,'$1-$2-$3');
    if(!validDate(date) || date.slice(0,4)!==dir.name){problems.push({file,error:'invalid date or year directory'});continue;}
    try {
      const hdr=await open(file,'r'); try {const b=Buffer.alloc(4); await hdr.read(b,0,4,0);if(b.toString()!=='PAR1')throw new Error('missing PAR1 header (possibly a Git LFS pointer)');}finally{await hdr.close();}
      const buffer=await asyncBufferFromFile(file), meta=await parquetMetadataAsync(buffer);
      const schema=meta.schema.slice(1).map(s=>({name:s.name,type:s.type,logical_type:s.logical_type??s.converted_type??null,repetition:s.repetition_type}));
      const key=JSON.stringify(schema); let id=schemas.findIndex(s=>JSON.stringify(s.fields)===key);
      if(id<0){id=schemas.length;schemas.push({id,fields:schema,files:0});}schemas[id].files++;
      const missing=required.filter(k=>!schema.some(s=>s.name===k));
      const time_min=statRange(meta.row_groups,'trade_time','min_value',(a,b)=>a<b), time_max=statRange(meta.row_groups,'trade_time','max_value',(a,b)=>a>b);
      const date_min=statRange(meta.row_groups,'date','min_value',(a,b)=>a<b), date_max=statRange(meta.row_groups,'date','max_value',(a,b)=>a>b);
      const reasons=[];if(missing.length) reasons.push(`missing fields: ${missing.join(',')}`);
      if(!Number(meta.num_rows)||!meta.row_groups.length)reasons.push('empty');
      if(!weekday(date)||closed.has(date))reasons.push('calendar conflict');
      for(const value of [date_min,date_max]) if(value && value.replaceAll('-','')!==date.replaceAll('-',''))reasons.push(`embedded date conflicts: ${value}`);
      for(const value of [time_min,time_max]) {
        if(!value || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value))reasons.push(`unverified clock encoding: ${value}`);
        else if(value.slice(0,10)!==date)reasons.push(`embedded time conflicts: ${value}`);
      }
      if(time_max && /^\d{4}-/.test(time_max) && time_max.slice(11,16)<'15:00')reasons.push('no end-of-session time in footer');
      days[date]={file,bytes:buffer.byteLength,rows:Number(meta.num_rows),row_groups:meta.row_groups.length,schema_id:id,time_min,time_max,date_min,date_max,usable:!reasons.length};
      if(reasons.length)problems.push({file,error:reasons.join('; ')});
    } catch(e){days[date]={file,usable:false};problems.push({file,error:e.message});}
  }
}
async function scanRecords(dir,accept) {
  const entries=await list(dir,true), by_date={}, errors=[];
  for(const e of entries || []) {
    if(!e.isDirectory() || !validDate(e.name))continue;
    const files=(await list(`${dir}/${e.name}`)).filter(x=>x.isFile()&&x.name.endsWith('.json'));
    let valid=0;for(const f of files){const p=`${dir}/${e.name}/${f.name}`;try{const v=await json(p);if(!/^\d{6}\.json$/.test(f.name)||v.date!==e.name||v.code!==f.name.slice(0,6)||!accept(v))throw new Error('invalid identity or data');valid++;}catch(err){errors.push({file:p,error:err.message});}}
    by_date[e.name]={files:files.length,valid};
  }
  return {exists:!!entries,by_date,errors,available_dates:Object.keys(by_date).filter(d=>by_date[d].valid>0),valid_records:Object.values(by_date).reduce((n,d)=>n+d.valid,0)};
}
const turnover=await scanRecords('data/daily_turnover_rate',r=>Number.isFinite(r.turnover_rate)&&r.turnover_rate>=0);
const qfq=await scanRecords('data/historical_qfq_quote_audits',r=>r.version==='1.0'&&r.verification==='two_source_qfq_ohlc_agreement'&&r.consensus?.date===r.date&&['open','close','high','low','pre_close'].every(k=>Number.isFinite(r.consensus[k])&&r.consensus[k]>0));
const dates=Object.keys(days).sort(), valid=dates.filter(d=>days[d].usable);
if(!valid.length)throw new Error('no usable market dates');
function period(start,end){
  const observed=valid.filter(d=>d>=start&&d<=end), absent=[],closedDates=[];
  for(let t=Date.parse(start);t<=Date.parse(end);t+=86400000){const d=new Date(t).toISOString().slice(0,10);if(!weekday(d))continue;if(closed.has(d))closedDates.push(d);else if(!days[d])absent.push(d);}
  return {start,end,available_dates:observed,missing_unclassified_weekdays:absent,explicit_weekday_closures:closedDates,unusable_file_dates:dates.filter(d=>d>=start&&d<=end&&!days[d].usable),turnover_dates:observed.filter(d=>turnover.by_date[d]?.valid>0),qfq_dates:observed.filter(d=>qfq.by_date[d]?.valid>0)};
}
const splits=Object.fromEntries(Object.entries(windows).map(([k,range])=>[k,period(...range)]));
const manifest={version:1,static_taxonomy_caveat:true,method:'Local files only. usable = positive footer row count, required field names, no detected timestamp/calendar conflict; not row-level validation or proof of coverage of every security. Absence without explicit closure evidence remains unclassified. A turnover or qfq date means at least one valid stock, never full-market coverage.',market:{file_dates:dates,available_dates:valid,schemas,days,anomalies:problems},calendars,full_period:period(dates[0],dates.at(-1)),splits,turnover,qfq,mainline_cache_files:(await list('output',true)||[]).filter(f=>f.isFile()&&/^mainline_.*\.json$/.test(f.name)).map(f=>f.name)};
await mkdir(output,{recursive:true});await writeFile(`${output}/data_manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({usable:valid.length,files:dates.length,first:valid[0],last:valid.at(-1),schema_files:schemas.map(s=>s.files),file_anomalies:problems.length,unclassified:manifest.full_period.missing_unclassified_weekdays.length,splits:Object.fromEntries(Object.entries(splits).map(([k,s])=>[k,s.available_dates.length])),turnover_dates:turnover.available_dates.length,turnover_records:turnover.valid_records,qfq_dates:qfq.available_dates.length,mainline_files:manifest.mainline_cache_files.length}));
