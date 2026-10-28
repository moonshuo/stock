import { readFile, writeFile } from "fs/promises";
import path from "path";
const root=process.cwd(), sf=path.join(root,"data","stock_sector_map.json"), cf=path.join(root,"data","source_candidates_eastmoney.json");
const data=JSON.parse(await readFile(sf,"utf8")), candidates=JSON.parse(await readFile(cf,"utf8")).candidates||[];
const by=new Map(data.stocks.map(x=>[x.code,x]));
function target(themes){const joined=themes.join("|");if(joined.includes("传感器"))return ["电子元器件","传感器","工业传感器",.3];if(joined.includes("第三代半导体"))return ["半导体","半导体材料","硅片材料",.3];return ["半导体","半导体产业服务","半导体设备零部件",.2]}
let added=0,merged=0;for(const item of candidates){const [p,s,z,score]=target(item.themes);let stock=by.get(item.code);if(!stock){stock={code:item.code,name:item.name,primary_sector:p,classifications:[],product_tags:[],reason:"公开概念成分股，尚待以公司收入与产品进一步验证，按低相关性概念关联收录。"};data.stocks.push(stock);by.set(item.code,stock);added++}else merged++;let cls=stock.classifications.find(x=>(x.primary_sector||stock.primary_sector)===p&&x.secondary_sector===s);if(!cls){cls={primary_sector:p,secondary_sector:s,tertiary_sectors:[]};stock.classifications.push(cls)}cls.tertiary_sectors=[...new Set([...cls.tertiary_sectors,z])];cls.relevance_score=Math.max(Number(cls.relevance_score||0),score);cls.source_refs=[...new Set([...(cls.source_refs||[]),...item.themes,"东方财富:概念候选（低相关性）"])]}
await writeFile(sf,`${JSON.stringify(data,null,2)}\n`,"utf8");console.log(JSON.stringify({candidates:candidates.length,added,merged,totalStocks:data.stocks.length},null,2));
