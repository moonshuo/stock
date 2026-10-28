export const seedData = {
  sectors: [
    {
      id: "grid",
      name: "电网设备",
      description: "输电、变电、配电及电网数字化相关设备与服务",
      color: "#e85d3f",
      groups: [
        {
          id: "uhv",
          name: "特高压",
          description: "特高压交直流输电设备与核心零部件",
          categories: [
            { id: "uhv-transformer", name: "特高压变压器", description: "换流变压器、交流变压器等核心设备" },
            { id: "uhv-switch", name: "高压开关", description: "GIS、断路器及组合电器" }
          ],
          stocks: [
            { id: "600089", code: "600089", name: "特变电工", categoryId: "uhv-transformer", note: "变压器、输变电系统" },
            { id: "601179", code: "601179", name: "中国西电", categoryId: "uhv-switch", note: "高压开关、变压器" },
            { id: "600312", code: "600312", name: "平高电气", categoryId: "uhv-switch", note: "高压及特高压开关" }
          ]
        },
        {
          id: "smart-grid",
          name: "智能电网",
          description: "调度自动化、继电保护与电网数字化",
          categories: [
            { id: "grid-automation", name: "电网自动化", description: "调度、变电站与配网自动化系统" },
            { id: "relay-protection", name: "继电保护", description: "电力系统保护、控制与安全稳定装置" },
            { id: "grid-digital", name: "电网数字化", description: "数字电网平台、通信与数据应用" }
          ],
          stocks: [
            { id: "600406", code: "600406", name: "国电南瑞", categoryId: "grid-automation", note: "电网自动化龙头" },
            { id: "000400", code: "000400", name: "许继电气", categoryId: "relay-protection", note: "保护控制、直流输电" }
          ]
        },
        {
          id: "distribution",
          name: "配电设备",
          description: "配电开关、成套设备与终端",
          categories: [
            { id: "distribution-switch", name: "配电开关", description: "中低压开关及成套设备" },
            { id: "smart-meter", name: "智能电表", description: "智能计量与用电信息采集" }
          ],
          stocks: [
            { id: "002028", code: "002028", name: "思源电气", categoryId: "distribution-switch", note: "输配电设备" },
            { id: "601567", code: "601567", name: "三星医疗", categoryId: "smart-meter", note: "智能配用电" }
          ]
        }
      ]
    },
    {
      id: "semiconductor",
      name: "半导体",
      description: "芯片设计、制造、设备与材料产业链",
      color: "#4778c7",
      groups: [
        { id: "chip-design", name: "芯片设计", description: "Fabless 与 IP", categories: [], stocks: [] },
        { id: "equipment", name: "半导体设备", description: "晶圆制造核心设备", categories: [], stocks: [] }
      ]
    }
  ]
};
