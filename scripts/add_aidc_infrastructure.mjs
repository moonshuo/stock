import { readFile, writeFile } from "fs/promises";
import path from "path";

const root = process.cwd();
const taxonomyFile = path.join(root, "data", "sector_taxonomy.json");
const stockFile = path.join(root, "data", "stock_sector_map.json");
const taxonomy = JSON.parse(await readFile(taxonomyFile, "utf8"));
const stockMap = JSON.parse(await readFile(stockFile, "utf8"));
const P = "AIDC基础设施";
const c = (secondary, ...tertiary) => ({ primary_sector: P, secondary_sector: secondary, tertiary_sectors: tertiary });

const sector = {
  name: P,
  secondary_sectors: [
    {
      name: "数据中心建设与工程",
      tertiary_sectors: ["模块化数据中心", "数据中心EPC与机电工程"],
      tertiary_descriptions: {
        "模块化数据中心": "覆盖微模块、模块化机房及一体化数据中心交付。",
        "数据中心EPC与机电工程": "覆盖数据中心机房建设、机电安装及整体工程交付。"
      }
    },
    {
      name: "供配电与电力保障",
      tertiary_sectors: ["UPS与HVDC", "配电与母线", "备用电源与储能"],
      tertiary_descriptions: {
        "UPS与HVDC": "覆盖不间断电源、高压直流供电和数据中心电源系统。",
        "配电与母线": "覆盖配电柜、智能配电、母线及机房供配电设施。",
        "备用电源与储能": "覆盖柴油发电机、备用电源及数据中心储能系统。"
      }
    },
    {
      name: "温控与液冷",
      tertiary_sectors: ["精密空调", "液冷系统", "冷却设备与换热"],
      tertiary_descriptions: {
        "精密空调": "覆盖机房精密空调、恒温恒湿及风冷温控设备。",
        "液冷系统": "覆盖冷板式、浸没式液冷及CDU等液冷解决方案。",
        "冷却设备与换热": "覆盖冷水机组、冷却塔、换热器等热管理设备。"
      }
    },
    {
      name: "机柜与机房配套",
      tertiary_sectors: ["服务器机柜与微模块", "PDU与智能配电", "机房布线与配套"],
      tertiary_descriptions: {
        "服务器机柜与微模块": "覆盖服务器机柜、微模块和机房一体化配套。",
        "PDU与智能配电": "覆盖机柜PDU、列头柜及智能配电终端。",
        "机房布线与配套": "覆盖数据中心综合布线、机房配套及连接组件。"
      }
    },
    {
      name: "服务器与算力硬件",
      tertiary_sectors: ["AI服务器", "通用服务器", "存储服务器"],
      tertiary_descriptions: {
        "AI服务器": "覆盖面向训练和推理部署的AI服务器及整机集成。",
        "通用服务器": "覆盖通用计算服务器、云服务器及整机制造。",
        "存储服务器": "覆盖企业级存储、存储服务器及相关硬件系统。"
      }
    },
    {
      name: "高速网络与光互连",
      tertiary_sectors: ["交换机与路由器", "高速光模块", "光连接与高速线缆"],
      tertiary_descriptions: {
        "交换机与路由器": "覆盖数据中心交换机、路由器和网络设备。",
        "高速光模块": "覆盖800G、400G等数据中心高速光模块。",
        "光连接与高速线缆": "覆盖光器件、AOC/DAC、高速连接器及线缆。"
      }
    },
    {
      name: "IDC运营与算力服务",
      tertiary_sectors: ["第三方IDC", "算力租赁与云基础设施", "数据中心运维服务"],
      tertiary_descriptions: {
        "第三方IDC": "覆盖机柜托管、互联网数据中心建设运营。",
        "算力租赁与云基础设施": "覆盖算力资源租赁及云基础设施服务。",
        "数据中心运维服务": "覆盖数据中心运维、能效管理和基础设施服务。"
      }
    }
  ]
};

const stocks = [
  ["002335", "科华数据", [c("数据中心建设与工程", "模块化数据中心", "数据中心EPC与机电工程"), c("供配电与电力保障", "UPS与HVDC", "配电与母线"), c("机柜与机房配套", "服务器机柜与微模块")], ["模块化数据中心", "UPS", "HVDC", "微模块"], "长期提供数据中心整体解决方案、模块化机房及电源系统，是AIDC基础设施代表企业。"],
  ["002518", "科士达", [c("数据中心建设与工程", "模块化数据中心"), c("供配电与电力保障", "UPS与HVDC", "配电与母线"), c("机柜与机房配套", "服务器机柜与微模块", "PDU与智能配电")], ["模块化数据中心", "UPS", "精密空调", "机柜"], "长期主营数据中心关键基础设施，覆盖UPS、精密空调、机柜及微模块。"],
  ["002364", "中恒电气", [c("供配电与电力保障", "UPS与HVDC", "配电与母线")], ["HVDC", "数据中心电源", "智能配电"], "高压直流供电和数据中心电源系统为公司核心市场方向。"],
  ["300153", "科泰电源", [c("供配电与电力保障", "备用电源与储能")], ["柴油发电机组", "备用电源", "数据中心供电"], "主营备用电源和柴油发电机组，服务数据中心的供电保障环节。"],
  ["300499", "高澜股份", [c("温控与液冷", "液冷系统", "冷却设备与换热")], ["液冷", "CDU", "换热器"], "液冷和热管理设备覆盖数据中心及高功率算力场景。"],
  ["002837", "英维克", [c("温控与液冷", "精密空调", "液冷系统")], ["机房精密空调", "液冷", "CDU"], "机房温控和液冷是公司长期核心业务，直接受益于AIDC建设。"],
  ["301018", "申菱环境", [c("温控与液冷", "精密空调", "冷却设备与换热")], ["精密空调", "数据中心温控", "冷水机组"], "长期从事专用性空调与环境控制，数据中心温控为重要应用领域。"],
  ["603912", "佳力图", [c("温控与液冷", "精密空调"), c("IDC运营与算力服务", "数据中心运维服务")], ["精密空调", "机房温控", "数据中心运维"], "主营数据中心精密空调，并布局数据中心基础设施运维。"],
  ["920808", "曙光数创", [c("温控与液冷", "液冷系统")], ["浸没式液冷", "冷板液冷", "数据中心液冷"], "主营数据中心液冷产品与解决方案，是AIDC液冷代表标的。"],
  ["000977", "浪潮信息", [c("服务器与算力硬件", "AI服务器", "通用服务器", "存储服务器")], ["AI服务器", "通用服务器", "存储服务器"], "服务器整机及AI服务器为长期主营，是AIDC算力硬件代表企业。"],
  ["603019", "中科曙光", [c("服务器与算力硬件", "AI服务器", "通用服务器", "存储服务器"), c("IDC运营与算力服务", "算力租赁与云基础设施")], ["高性能计算", "AI服务器", "存储服务器", "算力服务"], "长期覆盖高性能计算服务器、存储及算力基础设施服务。"],
  ["601138", "工业富联", [c("服务器与算力硬件", "AI服务器", "通用服务器")], ["AI服务器", "云服务器", "服务器制造"], "云服务器和AI服务器制造为公司核心业务之一。"],
  ["603296", "华勤技术", [c("服务器与算力硬件", "AI服务器", "通用服务器")], ["服务器ODM", "AI服务器", "数据中心硬件"], "服务器ODM与数据中心硬件是其重要增长方向。"],
  ["000938", "紫光股份", [c("服务器与算力硬件", "通用服务器", "存储服务器"), c("高速网络与光互连", "交换机与路由器")], ["服务器", "存储", "交换机", "网络设备"], "通过新华三覆盖服务器、存储及数据中心网络设备。"],
  ["301165", "锐捷网络", [c("高速网络与光互连", "交换机与路由器")], ["数据中心交换机", "路由器", "网络设备"], "主营网络设备，数据中心交换机是核心产品方向。"],
  ["300308", "中际旭创", [c("高速网络与光互连", "高速光模块")], ["800G光模块", "400G光模块", "数据中心光模块"], "高速数据中心光模块为长期核心业务。"],
  ["300502", "新易盛", [c("高速网络与光互连", "高速光模块")], ["800G光模块", "400G光模块", "高速光模块"], "主营高速光模块，直接服务云数据中心互连需求。"],
  ["002281", "光迅科技", [c("高速网络与光互连", "高速光模块", "光连接与高速线缆")], ["高速光模块", "光器件", "数据中心互连"], "光模块和光器件服务数据中心高速互连。"],
  ["300394", "天孚通信", [c("高速网络与光互连", "光连接与高速线缆")], ["光引擎", "光器件", "高速互连"], "高速光器件和光引擎是数据中心光互连的重要配套。"],
  ["300442", "润泽科技", [c("IDC运营与算力服务", "第三方IDC", "算力租赁与云基础设施")], ["IDC", "智能算力中心", "机柜托管"], "主营互联网数据中心及智能算力中心运营。"],
  ["300738", "奥飞数据", [c("IDC运营与算力服务", "第三方IDC", "算力租赁与云基础设施")], ["IDC", "云计算基础设施", "机柜托管"], "主营互联网数据中心和云计算基础设施服务。"],
  ["603881", "数据港", [c("IDC运营与算力服务", "第三方IDC")], ["数据中心", "IDC运营", "机柜托管"], "长期从事数据中心建设和运营。"],
  ["600845", "宝信软件", [c("IDC运营与算力服务", "第三方IDC", "数据中心运维服务")], ["IDC", "数据中心运维", "云服务"], "数据中心运营和运维服务为公司核心业务之一。"],
  ["300383", "光环新网", [c("IDC运营与算力服务", "第三方IDC", "算力租赁与云基础设施")], ["IDC", "云计算基础设施", "数据中心服务"], "主营IDC及云计算基础设施服务。"]
];

const index = taxonomy.sectors.findIndex((item) => item.name === P);
if (index >= 0) taxonomy.sectors[index] = sector;
else taxonomy.sectors.push(sector);

const byCode = new Map(stockMap.stocks.map((item) => [item.code, item]));
for (const [code, name, classifications, product_tags, reason] of stocks) {
  const existing = byCode.get(code);
  if (existing) {
    const nonAidc = (existing.classifications || []).filter((item) => (item.primary_sector || existing.primary_sector) !== P);
    Object.assign(existing, { classifications: [...nonAidc, ...classifications], product_tags: Array.from(new Set([...(existing.product_tags || []), ...product_tags])), reason: existing.reason || reason });
  } else {
    const item = { code, name, primary_sector: P, classifications, product_tags, reason };
    stockMap.stocks.push(item);
    byCode.set(code, item);
  }
}

await writeFile(taxonomyFile, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8");
await writeFile(stockFile, `${JSON.stringify(stockMap, null, 2)}\n`, "utf8");
console.log(`已写入 ${P}：${sector.secondary_sectors.length} 个二级分类，${stocks.length} 只代表股。`);
