import { readFile, writeFile } from "fs/promises";
import path from "path";
const file=path.join(process.cwd(),"data","stock_sector_map.json");const data=JSON.parse(await readFile(file,"utf8"));const P="电子元器件";const c=(s,...t)=>({primary_sector:P,secondary_sector:s,tertiary_sectors:t});
const rows=[
 ["300285","国瓷材料",[c("被动元件","陶瓷电容")],["MLCC材料","介电材料","电子陶瓷"],"MLCC介电材料为明确业务，按陶瓷电容产业链归属。"],
 ["002782","可立克",[c("被动元件","电感磁性元件")],["变压器","磁性元件","电感"],"主营磁性元件、变压器及相关电源产品。"],
 ["002484","江海股份",[c("被动元件","功率与储能电容")],["铝电解电容","薄膜电容","超级电容"],"主营铝电解、薄膜和超级电容。"],
 ["603328","依顿电子",[c("连接器","汽车连接器")],["汽车电子","汽车连接器相关","PCB"],"汽车电子业务与连接器配套存在明确相关性；该项为相关业务归属。"],
 ["688800","瑞可达",[c("连接器","消费电子互连")],["消费电子连接器","高速连接器","汽车连接器"],"除汽车和通信连接器外，消费电子连接器为相关产品方向。"],
 ["688665","四方光电",[c("传感器","环境传感器","汽车传感器")],["气体传感器","汽车传感器","环境监测"],"主营气体传感器，产品覆盖环境监测及汽车应用。"],
 ["300112","万讯自控",[c("传感器","工业传感器")],["工业传感器","压力传感器","自动化仪表"],"工业自动化仪表和传感器为长期主营。"],
 ["300790","宇瞳光学",[c("光学元件","机器视觉光学")],["工业镜头","机器视觉镜头","安防镜头"],"工业和机器视觉镜头为明确产品方向。"],
 ["002222","福晶科技",[c("光学元件","AR/VR光学")],["激光晶体","精密光学","AR/VR光学相关"],"精密光学元件可应用于AR/VR光学系统；该项为相关业务归属。"],
 ["002384","东山精密",[c("PCB","AI服务器PCB","消费电子PCB")],["高多层PCB","FPC","消费电子PCB"],"PCB业务覆盖消费电子和通信高多层板，相关产品可服务服务器。"],
 ["603920","世运电路",[c("PCB","汽车PCB")],["汽车PCB","新能源汽车PCB","多层板"],"汽车电子和新能源汽车PCB为核心应用方向。"],
 ["002815","崇达技术",[c("PCB","AI服务器PCB","汽车PCB")],["高多层PCB","通信PCB","汽车PCB"],"高多层通信板和汽车PCB为明确业务方向。"],
 ["002351","漫步者",[c("声学器件","智能声学终端","专业电声")],["TWS耳机","音箱","专业电声"],"耳机、音箱等智能及专业电声产品为长期主营。"],
 ["300283","温州宏丰",[c("继电器与电接触","电接触材料")],["电接触材料","触点材料","继电器材料"],"主营电接触材料，服务继电器和电气开关。"],
 ["300602","飞荣达",[c("电子功能件","精密功能件")],["电磁屏蔽","导热材料","精密功能件"],"除散热屏蔽外，精密功能件为相关产品方向。"],
 ["002635","安洁科技",[c("电子功能件","新型材料结构件")],["功能材料","精密结构件","新型材料"],"功能材料及精密结构件业务具备新型材料结构件属性。"]
];
const by=new Map(data.stocks.map(x=>[x.code,x]));for(const [code,name,cls,tags,reason] of rows){let s=by.get(code);if(!s){s={code,name,primary_sector:P,classifications:[],product_tags:[],reason};data.stocks.push(s);by.set(code,s)}s.name=name;s.product_tags=[...new Set([...(s.product_tags||[]),...tags])];for(const x of cls){let y=s.classifications.find(q=>(q.primary_sector||s.primary_sector)===P&&q.secondary_sector===x.secondary_sector);if(!y){y={primary_sector:P,secondary_sector:x.secondary_sector,tertiary_sectors:[]};s.classifications.push(y)}y.tertiary_sectors=[...new Set([...y.tertiary_sectors,...x.tertiary_sectors])]}if(!s.reason.includes(reason))s.reason=`${s.reason||''}${s.reason?'；':''}${reason}`};await writeFile(file,`${JSON.stringify(data,null,2)}\n`,"utf8");console.log(`电子元器件候选池新增/更新 ${rows.length} 只股票。`);
