import { readFile, writeFile } from "fs/promises";
import path from "path";
const file = path.join(process.cwd(), "data", "stock_sector_map.json");
const data = JSON.parse(await readFile(file, "utf8"));
const P = "AIDC基础设施";
const c = (secondary, ...tertiary) => ({ primary_sector: P, secondary_sector: secondary, tertiary_sectors: tertiary });
const candidates = [
  ["002421", "达实智能", [c("数据中心建设与工程", "数据中心EPC与机电工程"), c("IDC运营与算力服务", "数据中心运维服务")], ["数据中心工程", "智能建筑", "机电工程"], "数据中心智能化建设及运维为明确相关业务。"],
  ["000815", "美利云", [c("IDC运营与算力服务", "第三方IDC", "算力租赁与云基础设施")], ["数据中心", "云计算", "算力服务"], "数据中心和云计算为公司数字业务方向。"],
  ["300166", "东方国信", [c("IDC运营与算力服务", "算力租赁与云基础设施")], ["云计算", "大数据中心", "算力服务"], "云计算和大数据基础设施属于明确业务布局。"],
  ["002050", "三花智控", [c("温控与液冷", "液冷系统", "冷却设备与换热")], ["液冷热管理", "换热器", "数据中心液冷"], "热管理与液冷能力可服务数据中心；该项为相关业务归属。"],
  ["002454", "松芝股份", [c("温控与液冷", "冷却设备与换热")], ["热管理", "冷却系统", "液冷相关"], "热管理和冷却系统可应用于高功率设备；该项为相关业务归属。"],
  ["002733", "雄韬股份", [c("供配电与电力保障", "备用电源与储能")], ["备用电源", "UPS电池", "数据中心储能"], "铅酸及锂电备用电源产品可服务数据中心供电保障。"],
  ["600100", "同方股份", [c("服务器与算力硬件", "通用服务器"), c("IDC运营与算力服务", "算力租赁与云基础设施")], ["服务器", "云计算", "数据中心"], "服务器及云计算基础设施为公司相关业务布局。"],
  ["002178", "延华智能", [c("数据中心建设与工程", "数据中心EPC与机电工程")], ["智能建筑", "机房工程", "数据中心工程"], "智能建筑与机房工程可服务数据中心建设；该项为相关业务归属。"],
  ["300383", "光环新网", [c("IDC运营与算力服务", "数据中心运维服务")], ["IDC运营", "数据中心运维", "云基础设施"], "IDC主营同时覆盖数据中心运营维护服务。"],
  ["002518", "科士达", [c("机柜与机房配套", "机房布线与配套")], ["机房配套", "数据中心基础设施", "微模块"], "模块化数据中心产品含机房配套系统，补充归属。"]
];
const byCode = new Map(data.stocks.map(x=>[x.code,x]));
for(const [code,name,cls,tags,reason] of candidates){let s=byCode.get(code);if(!s){s={code,name,primary_sector:P,classifications:[],product_tags:[],reason};data.stocks.push(s);byCode.set(code,s)}s.name=name;s.product_tags=[...new Set([...(s.product_tags||[]),...tags])];for(const x of cls){let y=s.classifications.find(q=>(q.primary_sector||s.primary_sector)===P&&q.secondary_sector===x.secondary_sector);if(!y){y={primary_sector:P,secondary_sector:x.secondary_sector,tertiary_sectors:[]};s.classifications.push(y)}y.tertiary_sectors=[...new Set([...y.tertiary_sectors,...x.tertiary_sectors])]}if(!s.reason.includes(reason))s.reason=`${s.reason||''}${s.reason?'；':''}${reason}`}
await writeFile(file,`${JSON.stringify(data,null,2)}\n`,"utf8");console.log(`AIDC候选池新增/更新 ${candidates.length} 只股票。`);
