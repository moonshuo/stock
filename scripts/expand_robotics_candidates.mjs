import { readFile, writeFile } from "fs/promises";
import path from "path";
const file=path.join(process.cwd(),"data","stock_sector_map.json");const data=JSON.parse(await readFile(file,"utf8"));const P="机器人";const c=(s,...t)=>({primary_sector:P,secondary_sector:s,tertiary_sectors:t});
const rows=[
 ["301255","通力科技",[c("精密传动与执行部件","减速器")],["减速器","精密传动","机器人减速器"],"精密减速器产品可应用于工业机器人；该项为相关业务归属。"],
 ["301261","恒工精密",[c("精密传动与执行部件","丝杠导轨与轴承")],["精密加工","丝杠部件","机器人零部件"],"精密传动结构件可服务机器人执行部件；该项为相关业务归属。"],
 ["300780","德恩精工",[c("精密传动与执行部件","丝杠导轨与轴承")],["传动件","丝杠","精密机械"],"精密传动件业务与机器人直线执行机构相关。"],
 ["688610","埃科光电",[c("机器视觉与传感","机器视觉")],["工业相机","机器视觉","视觉传感"],"主营工业相机及机器视觉核心部件。"],
 ["301568","思泰克",[c("机器视觉与传感","机器视觉")],["AOI","机器视觉","自动光学检测"],"AOI自动光学检测具备机器视觉直接业务属性。"],
 ["301312","智立方",[c("机器视觉与传感","机器视觉"),c("末端执行与工艺装备","柔性装配与检测装备")],["机器视觉","自动化测试","精密装配"],"机器视觉及工业自动化测试装备为明确业务方向。"],
 ["300486","东杰智能",[c("系统集成与行业应用","智能物流与仓储机器人")],["智能物流","仓储机器人","物流自动化"],"智能物流仓储系统和物流机器人为主营方向。"],
 ["603066","音飞储存",[c("系统集成与行业应用","智能物流与仓储机器人")],["智能仓储","堆垛机","物流自动化"],"智能仓储设备和物流自动化为主营业务。"],
 ["300450","先导智能",[c("系统集成与行业应用","新能源与汽车机器人应用")],["新能源自动化","智能制造","机器人应用"],"新能源制造自动化产线大量应用机器人；该项为行业应用相关归属。"],
 ["688155","先惠技术",[c("系统集成与行业应用","新能源与汽车机器人应用")],["汽车自动化","机器人工作站","智能制造"],"新能源汽车自动化产线与机器人工作站为明确业务。"],
 ["603895","天永智能",[c("系统集成与行业应用","工业机器人系统集成","新能源与汽车机器人应用")],["智能制造","汽车自动化","机器人系统集成"],"汽车制造自动化和机器人系统集成为主营方向。"],
 ["300097","智云股份",[c("系统集成与行业应用","工业机器人系统集成")],["智能制造","自动化产线","机器人集成"],"自动化装备及智能制造系统与机器人集成相关。"]
];
const by=new Map(data.stocks.map(x=>[x.code,x]));for(const [code,name,cls,tags,reason] of rows){let s=by.get(code);if(!s){s={code,name,primary_sector:P,classifications:[],product_tags:[],reason};data.stocks.push(s);by.set(code,s)}s.name=name;s.product_tags=[...new Set([...(s.product_tags||[]),...tags])];for(const x of cls){let y=s.classifications.find(q=>(q.primary_sector||s.primary_sector)===P&&q.secondary_sector===x.secondary_sector);if(!y){y={primary_sector:P,secondary_sector:x.secondary_sector,tertiary_sectors:[]};s.classifications.push(y)}y.tertiary_sectors=[...new Set([...y.tertiary_sectors,...x.tertiary_sectors])]}if(!s.reason.includes(reason))s.reason=`${s.reason||''}${s.reason?'；':''}${reason}`};await writeFile(file,`${JSON.stringify(data,null,2)}\n`,"utf8");console.log(`机器人候选池新增/更新 ${rows.length} 只股票。`);
