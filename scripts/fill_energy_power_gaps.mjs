import { readFile, writeFile } from "fs/promises";
import path from "path";
const file=path.join(process.cwd(),"data","stock_sector_map.json"),d=JSON.parse(await readFile(file,"utf8"));
const rows=[
["光伏产业链","688556","高测股份","光伏设备","硅片设备"],["风电产业链","002202","金风科技","风电运营","风电运维"],["锂电产业链","000792","盐湖股份","锂资源","盐湖提锂"],["储能","300648","星云股份","储能电池","钠离子与新型电池"],["储能","002960","青鸟消防","储能温控与安全","消防与安全"],["储能","600995","南网储能","储能运营","储能电站运营"],["氢能源","000868","安凯客车","氢能应用","氢能重卡"],["智能电网","600406","国电南瑞","调度与数字电网","电力调度"]
];
const by=new Map(d.stocks.map(x=>[x.code,x]));for(const [p,code,name,s,z] of rows){let x=by.get(code);if(!x){x={code,name,primary_sector:p,classifications:[],product_tags:[],reason:"相关产业链业务"};d.stocks.push(x);by.set(code,x)}let q=x.classifications.find(a=>(a.primary_sector||x.primary_sector)===p&&a.secondary_sector===s);if(!q){q={primary_sector:p,secondary_sector:s,tertiary_sectors:[]};x.classifications.push(q)}q.tertiary_sectors=[...new Set([...q.tertiary_sectors,z])];x.product_tags=[...new Set([...(x.product_tags||[]),z])];if(!x.reason.includes("相关产业链业务"))x.reason=`${x.reason||""}${x.reason?"；":""}相关产业链业务`};await writeFile(file,`${JSON.stringify(d,null,2)}\n`,"utf8");
