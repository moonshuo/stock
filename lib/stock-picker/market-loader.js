import {readFile,mkdir,writeFile,rename,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const exec=promisify(execFile);
const iso=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const empty=(date,reason)=>Object.freeze({date,status:'unavailable',reason,stocks:Object.freeze([])});
export async function createMarketStore({root=process.cwd(),python=process.env.STOCK_PICKER_PYTHON||'python',maxDays=75,
  helper=path.join(path.dirname(fileURLToPath(import.meta.url)),'parquet_daily.py')}={}){
  const base=path.join(root,'output/stock-picker-eval'), cacheDir=path.join(base,'daily-cache');
  const manifest=JSON.parse(await readFile(path.join(base,'data_manifest.json'),'utf8'));
  const dates=Object.freeze([...new Set([...manifest.market.file_dates,...manifest.full_period.missing_unclassified_weekdays])].sort());
  const memory=new Map(),version=createHash('sha256').update(await readFile(helper)).digest('hex').slice(0,16);
  async function fetchDay(date){const meta=manifest.market.days[date];if(!meta?.usable)return empty(date,meta?'audit_rejected_file':'unverified_weekday_or_missing_file');
    const source=path.resolve(root,meta.file),s=await stat(source);if(s.size!==meta.bytes)throw Error('Source size changed since audit: '+date);
    const key=`${date}-${version}-${s.size}-${Math.trunc(s.mtimeMs)}.json`;const dest=path.join(cacheDir,key);let compact;
    try{compact=JSON.parse(await readFile(dest,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;
      const {stdout}=await exec(python,[helper,source,date],{maxBuffer:16*1024*1024,windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});compact=JSON.parse(stdout);
      await mkdir(cacheDir,{recursive:true});const tmp=dest+'.'+randomUUID()+'.tmp';await writeFile(tmp,stdout);await rename(tmp,dest);
    }
    if(compact.date!==date)throw Error('Cache date mismatch');
    const stocks=Object.freeze(compact.rows.map(values=>{const row=Object.fromEntries(compact.columns.map((k,i)=>[k,values[i]]));return Object.freeze({...row,name:null,name_available_asof:false,price:row.close,changePct:(row.close/row.preClose-1)*100});}));
    return Object.freeze({date,status:compact.status,stocks,excluded_codes:compact.excluded_codes,source:meta.file});
  }
  function day(date){if(memory.has(date)){const item=memory.get(date);memory.delete(date);memory.set(date,item);return item;}
    const item=fetchDay(date).catch(e=>{memory.delete(date);throw e;});memory.set(date,item);while(memory.size>maxDays)memory.delete(memory.keys().next().value);return item;}
  return Object.freeze({dates,asOf(date){if(!iso(date))throw Error('Invalid as-of date');const history=Object.freeze(dates.filter(d=>d<=date));return Object.freeze({asOfDate:date,dates:history,async day(d){if(!iso(d)||d>date)throw Error(`Outside signal clock: ${d} > ${date}`);return day(d);}});}});
}
