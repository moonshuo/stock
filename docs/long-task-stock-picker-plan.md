# 长任务规划：A 股新手友好型「可验证选股融合引擎 + AI 排雷助手」

> 用途：供 DeepSeek Coding Agent Harness（调用标准 ChatGPT / OpenAI API）按阶段自主执行的长任务规格书。
> 执行前必须完整阅读项目根目录的 `AGENTS.md` 与 `code_review.md`，所有实现必须服从其中的工程红线。

---

## 1. 业务目标与默认交易口径

本任务面向**A 股交易新手**，目标是把仓库中已有的 4 套孤立选股/打分模块，升级为一个**经过历史样本外验证、自带空仓保护、每天收盘后可直接产出 Top 5–10 候选股及交易计划**的选股系统。

### 固定默认口径（除非配置显式覆盖）
- **目标持股周期**：主线波段 **3–5 个交易日**（主评价指标为 `T+3` 与 `T+5` 净收益，辅以 `T+1` 隔日防暴跌检查）。
- **默认标的池**：A 股主板（`60xxxx` / `00xxxx`）；剔除 ST / `*ST` / 停牌 / 成交额过低个股。创业板（`300/301`）与科创板（`688`）作为可配置开关（默认关闭，避免新手承受 20% 剧烈波动）。
- **买点风格**：顺主线 + 分歧低吸 / 强修复 / 趋势延续；**禁止加速高潮追高、禁止退潮期抄底**。
- **空仓保护**：当市场环境或主线处于退潮/强负反馈区间时，选股器允许输出 **0 只候选股**（`market_regime: "defensive"`），不强行凑数。
- **回测成交假设（严防虚胖）**：
  - `T` 日收盘后仅用 `<= T` 的数据生成信号；
  - `T+1` 日以**开盘价**模拟买入；若 `T+1` 停牌、数据缺失或开盘即一字涨停（买不进），标记为 `unfillable` 并剔除，不得计入虚拟盈利；
  - 扣除双边交易摩擦成本（默认合计 `0.25%`，可在配置中调整）。

---

## 2. 已核查的本地数据边界（执行前必读）

以下为 2026-11-21 实测的本地仓库数据现状，禁止假设不存在的文件已就绪：
1. **历史行情**：`5分钟数据/YYYY/YYYYMMDD.parquet` 共 **697 个交易日**，覆盖 `2024-01-02` ～ `2026-11-19`（注：按 `docs/strong-pullback-v0.1.md` 说明，历史文件主要是收盘全市场快照）。
2. **交易日历**：`data/ashare_trading_calendar/` 现有 `2025.json`、`2026.json`（无 `2024.json`）。
3. **日换手率**：`data/daily_turnover_rate/` 现有 **63 个交易日**，覆盖 `2026-07-24` ～ `2026-10-28`；其余日期缺失，**严禁将缺失换手率填 0**。
4. **主线历史缓存**：`output/mainline_*.json` 当前本机为 **0 个**；评估时需通过现有主线计算路径按 `as_of_date` 严格生成并缓存到 `output/stock-picker-eval/mainline-cache/`，**不得覆盖正式每日快照语义**。
5. **静态成分限制**：`data/stock_sector_map.json` 当前没有逐日历史成分版本。历史回放报告必须在元数据与 Markdown 报告中显式标注 `static_taxonomy_caveat: true`，不得伪装为无生存者/成分偏差的完美回测。

### 严格样本区间切分
- **开发期（In-Sample，允许用于体检与融合参数设定）**：`2025-01-02` ～ `2026-06-30`
- **留出验证期（Out-of-Sample，严禁用于调参，仅在冻结配置后单次评估）**：`2026-07-01` ～ `2026-11-12`（末尾预留至少 5 个交易日保证 `T+5` 收益标签完整）
- **完整换手率子集**：`2026-07-24` ～ `2026-10-28`（用于单独验证依赖换手率的信号完整度）

---

## 3. 工程红线（不可违反）

1. **严禁未来数据泄漏**：计算 `T` 日信号时严禁读取任何 `> T` 的行情、换手率、主线结果或排名。必须有自动化对抗测试（篡改 `T+1` 及之后行情数据，`T` 日选股结果必须逐字节一致）。
2. **最小侵入原则**：**禁止修改现有生产选股/主线算法的原始公式或阈值**来迎合回测。新增的评估底座、适配器、统一选股漏斗必须放在独立目录 `lib/stock-picker/`。
3. **诚实处理缺失与失败**：某策略在样本外（OOS）若跑不赢基准或无正期望，必须如实输出数据并分析原因；严禁偷看 OOS 反复调参，严禁 hardcode 日期/股票/板块特判。
4. **保留现有功能兼容**：新增标准 OpenAI API 适配层时，必须保留 `lib/agent-auth.js` 原有 ChatGPT OAuth 能力与现有测试全部通过。

---

## 4. 分阶段任务拆解与验收标准

每完成一个 Phase，必须：
1. 运行该 Phase 的全部验收命令；
2. 将进度、产物路径、关键指标、测试结果写入 `output/long-task-progress.json`；
3. 检查 `git diff`，确认无临时调试代码和越界修改后再进入下一 Phase。

---

### Phase 0：数据盘点与可回放索引
**目标**：建立精确的数据清单，确认每个交易日行情字段、交易日历、换手率和前复权核验文件的真实可用性。

- **交付物**：
  - `scripts/audit_eval_data.mjs`
  - `output/stock-picker-eval/data_manifest.json`
- **要求**：
  - 扫描 `5分钟数据/`、`data/ashare_trading_calendar/`、`data/daily_turnover_rate/`、`data/historical_qfq_quote_audits/`（如存在）；
  - 输出开发期、留出期、换手率子集的精确可用交易日列表，以及发现的异常/缺失日期。
- **验收命令**：
  - `node scripts/audit_eval_data.mjs` 正常退出（exit 0）且生成的 JSON 包含非空日期清单。

---

### Phase 1：无未来泄漏的选股评估与回测底座
**目标**：构建统一的策略评估引擎，能对任意选股器输出客观的前向收益、风控和分位单调性统计。

- **交付物**：
  - `lib/stock-picker/types.js`（或 JSDoc 契约定义）
  - `lib/stock-picker/market-loader.js`（严格 `<= as_of_date` 截断的 Parquet 日线加载器）
  - `lib/stock-picker/evaluator.js`（成交可行性检查、交易成本、前向收益 `T+1/T+3/T+5/T+10`、胜率、盈亏比、MFE/MAE、按市场周期分组、分位单调性）
  - `scripts/eval_stock_pickers.mjs`（CLI 入口，支持 `--strategy`、`--from`、`--to`、`--split is|oos`）
  - `tests/stock-picker-no-leakage-contract.mjs`（未来数据泄漏对抗测试）
  - `tests/stock-picker-execution-contract.mjs`（一字涨停 `unfillable`、停牌、成本扣除、边界日期测试）
- **验收命令**：
  - `node tests/stock-picker-no-leakage-contract.mjs`
  - `node tests/stock-picker-execution-contract.mjs`

---

### Phase 2：现有 4 套选股器全历史体检（Baseline）
**目标**：不改原算法，通过只读适配器把现有 4 套选股器接入评估底座，拿到真实历史数据体检报告。

- **交付物**：
  - `lib/stock-picker/adapters/mainline-leader-adapter.js`（对接主线 + 龙头/容量核心 + `action-state-machine.js`）
  - `lib/stock-picker/adapters/strong-pullback-adapter.js`（对接 `lib/strong-pullback/`）
  - `lib/stock-picker/adapters/green-limit-up-adapter.js`（对接 `app/lib/greenLimitUpSelection.js`）
  - `lib/stock-picker/adapters/uptrend-score-adapter.js`（对接 `scripts/uptrend_score.py`；若本地缺少双源前复权核验数据，明确返回 `unavailable` 原因，不伪造分数）
  - `output/stock-picker-eval/baseline_report.json`
  - `docs/stock-picker-baseline-report.md`（由脚本基于真实计算结果自动生成，含各策略在开发期与不同生命周期阶段下的胜率、均值/中位数收益、盈亏比、最大回撤、踩雷高频场景）
- **验收命令**：
  - `node scripts/eval_stock_pickers.mjs --strategy all --split is` 成功产出报告且所有数值可追溯；
  - 核对报告中显式包含 `static_taxonomy_caveat` 与缺失数据覆盖说明。

---

### Phase 3：统一选股漏斗（Unified Stock Picker）与样本外（OOS）验收
**目标**：基于 Phase 2 的开发期证据，设计面向新手的三层选股漏斗，冻结参数后在留出期完成单次诚实验收。

- **交付物**：
  - `data/stock_picker_config.json`（冻结的漏斗权重、环境闸门阈值、流动性/主板过滤规则、成本假设）
  - `lib/stock-picker/unified-picker.js`：
    1. **环境闸门层**：结合市场概览 + 主线周期状态机，判定 `offensive / selective / defensive`；`defensive` 时输出空仓信号（0 只或仅观察不建议建仓）。
    2. **多维共振打分层**：仅融合 Phase 2 开发期验证有效的维度，剔除负贡献或高回撤噪声项。
    3. **新手风控排雷层**：复用 `postSurgeCollapseEvidence` 等现有规则，过滤连续崩塌、高潮追高、低流动性、ST/停牌股。
    4. **可执行交易卡输出**：每只候选股返回 `code`、`name`、`score`、`setup_type`（分歧低吸 / 强修复 / 趋势延续）、`sector_context`、`invalidation_rules`、`invalidation_price`、`historical_bucket_stats`、`risk_warnings`。
  - `tests/unified-stock-picker-contract.mjs`（含空仓闸门测试、排雷测试、结构化输出测试、无未来泄漏测试）
  - `output/stock-picker-eval/oos_report.json` 与 `docs/stock-picker-oos-report.md`（冻结配置后的留出期单次评估对比报告）
- **验收命令**：
  - `node tests/unified-stock-picker-contract.mjs`
  - `node scripts/eval_stock_pickers.mjs --strategy unified --split oos`
  - 运行仓库既有合约测试，确保无回归。

---

### Phase 4：每日选股接口、标准 OpenAI API 排雷与前端面板
**目标**：把选股引擎变成每天收盘后可一键使用的交易助手界面，并接入标准 ChatGPT API 做候选股交叉排雷。

- **交付物**：
  - `lib/llm-provider.js`：统一模型调用层，支持标准 OpenAI API（环境变量 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`，默认兼容 Chat Completions / Responses API），同时保留原有 `lib/agent-auth.js` OAuth 路径作为备选。
  - `lib/stock-picker/ai-review.js`：把当日 Top 5–10 候选股 + 产业归属（`stock_sector_map.json`）+ 板块周期 + 近期笔记（`data/notes.json`）组装为结构化 prompt，强制要求 LLM 仅基于 `<= as_of_date` 的证据输出 JSON 排雷结论（`verdict: pass|caution|reject`、`core_logic`、`conflict_or_risk`、`watch_trigger`），禁止虚构数据或预测具体涨跌幅。
  - `app/api/stock-picker/route.js`（GET：按日期返回环境闸门 + 候选股交易卡）
  - `app/api/stock-picker/review/route.js`（POST：触发标准 OpenAI API 对当日候选股做批量排雷）
  - 前端面板组件 `app/components/StockPickerPanel.js`（接入主页面导航，展示市场环境灯、空仓提示、Top 候选股卡片、失效止损位、历史同类统计和“一键 AI 排雷”按钮）
  - `tests/stock-picker-api-contract.mjs` 与 `tests/llm-provider-contract.mjs`（mock 上游验证标准 API 请求构造、错误处理、鉴权降级）
- **验收命令**：
  - `node tests/stock-picker-api-contract.mjs`
  - `node tests/llm-provider-contract.mjs`
  - `npm.cmd run validate:data`
  - `npm.cmd run build:next`

---

## 5. DeepSeek Harness 长任务进度追踪格式

执行期间维护 `output/long-task-progress.json`（每阶段结束更新）：

```json
{
  "task": "unified-stock-picker-v1",
  "updated_at": "ISO-8601",
  "current_phase": "phase_1",
  "phases": {
    "phase_0": { "status": "completed", "artifacts": [], "checks": [] },
    "phase_1": { "status": "in_progress", "artifacts": [], "checks": [] },
    "phase_2": { "status": "pending", "artifacts": [], "checks": [] },
    "phase_3": { "status": "pending", "artifacts": [], "checks": [] },
    "phase_4": { "status": "pending", "artifacts": [], "checks": [] }
  },
  "open_risks": []
}
```

---

## 6. 最终交付检查清单

全部 Phase 完成后，输出最终汇总报告（格式对齐 `AGENTS.md`）：
1. 各阶段改动文件清单与核心设计说明；
2. Phase 2（4 套单策略体检）与 Phase 3（统一选股漏斗开发期 vs 留出期）的真实对比指标表；
3. 全量运行过的测试命令、Build 结果及人工抽检的真实交易日输出样本（至少覆盖 1 个主线进攻日 + 1 个退潮空仓日）；
4. 明确列出未验证项、数据局限与已知回归风险（不得隐瞒）。
