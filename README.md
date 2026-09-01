# 股票产业分类库

一个 JSON 驱动的 A 股三级产业分类工具。

## 本地运行

最简单的方式：双击项目中的 `一键启动股票分类库.bat`，启动器会自动打开浏览器。

也可以在终端运行：

```powershell
npm.cmd install
npm.cmd run dev
```

打开 `http://localhost:3000`。

## 数据文件

稳定产业分类拆成两个 JSON：

- `data/sector_taxonomy.json`：统一分类目录，结构为“一级主线 → 二级产业环节 → 三级产品方向”。
- `data/stock_sector_map.json`：股票长期产业归属，包含 `product_tags` 和长期归属理由。

动态炒作题材按日期单独保存：

- `data/daily_themes/YYYY-MM-DD.json`

旧版嵌套数据仍保留在 `data/stock-library.json`，不会删除。

## 分类原则

- `primary_sector` 原则上每只股票只有一个。
- `classifications` 可以包含多个二级和三级归属。
- `tertiary_sectors` 必须来自 `data/sector_taxonomy.json`。
- 更细的公司业务写入 `product_tags`，不要自动创建三级板块。
- 涨价、订单、政策、客户关系等动态事件写入 `data/daily_themes/YYYY-MM-DD.json`。

## 常用命令

```powershell
npm.cmd run convert:legacy
npm.cmd run validate:data
npm.cmd run build:next
```

`convert:legacy` 会把 `data/stock-library.json` 转换成新格式，并输出 `data/migration_report.json`。

`validate:data` 会检查股票代码、一级/二级/三级归属、重复分类、产品标签重复和动态题材引用。

## 新增数据

新增股票：优先在网页里点击“新增股票”；也可以直接编辑 `data/stock_sector_map.json`。

新增三级分类：优先编辑 `data/sector_taxonomy.json`，也可以在网页二级详情页点击“新增三级”。三级分类必须是可形成独立行情的产品方向。

新增动态题材：在 `data/daily_themes/` 下创建日期文件，例如 `2026-07-23.json`，记录题材名、关联三级方向、股票代码、原因和来源。
