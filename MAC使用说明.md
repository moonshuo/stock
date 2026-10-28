# 在 macOS 上运行

1. 安装 Node.js 20 或更高版本；如 `duckdb` 安装失败，先执行 `xcode-select --install`。
2. 双击 `一键启动股票分类库.command` 即可启动并自动打开浏览器。
3. 也可以在本目录打开终端，执行 `npm install`，再执行 `npm run dev`，访问终端输出的 `http://localhost:3000`。

本迁移包包含源码、产业分类、股票映射、配置及名称库。为避免携带数 GB 的可重建行情与分析缓存，未包含 `5分钟数据/` 和历史分析缓存目录；首次读取某日期行情时系统会按现有逻辑读取或补全所需本地数据。

不要把 Windows 的 `node_modules/` 一并复制到 Mac；应在 Mac 上执行 `npm install`，以安装与 Apple Silicon 或 Intel 架构匹配的原生依赖。
