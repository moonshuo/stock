import { readFile, writeFile } from "fs/promises";
import path from "path";
const file=path.join(process.cwd(),"data","stock_sector_map.json"),d=JSON.parse(await readFile(file,"utf8"));
const rows=[
  ["600396","华电辽能",[["风电产业链","风电运营","风电场运营"],["光伏产业链","逆变器与电站","电站开发与EPC"]],["风电运营","光伏发电","新能源运营"],"新能源发电与运营为明确业务方向，按风电及光伏电站运营相关业务归属。"],
  ["600758","辽宁能源",[["风电产业链","风电运营","风电场运营"],["光伏产业链","逆变器与电站","电站开发与EPC"]],["风电","光伏","新能源项目"],"在传统能源业务外，公司存在风电、光伏等新能源相关项目；按相关业务归属。"]
];
const by=new Map(d.stocks.map(x=>[x.code,x]));for(const [code,name,cs,tags,reason] of rows){let s=by.get(code);if(!s){s={code,name,primary_sector:"风电产业链",classifications:[],product_tags:[],reason};d.stocks.push(s);by.set(code,s)}s.name=name;s.product_tags=[...new Set([...(s.product_tags||[]),...tags])];for(const [p,sec,ter] of cs){let c=s.classifications.find(x=>(x.primary_sector||s.primary_sector)===p&&x.secondary_sector===sec);if(!c){c={primary_sector:p,secondary_sector:sec,tertiary_sectors:[]};s.classifications.push(c)}c.tertiary_sectors=[...new Set([...c.tertiary_sectors,ter])]}if(!s.reason.includes(reason))s.reason=`${s.reason||''}${s.reason?'；':''}${reason}`};await writeFile(file,`${JSON.stringify(d,null,2)}\n`,"utf8");
