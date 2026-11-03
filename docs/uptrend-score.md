# 日K上涨趋势评分 V1.0

评分器只评估日K的上涨趋势，输出均线、结构、持续性、回调稳定性和成交量五项分数，总分为 0—100。它不引用板块、股票类型、买卖点、龙头或风险等级。

## 数据口径

趋势价格读取 `data/historical_qfq_quote_audits/YYYY-MM-DD/<code>.json`：同花顺前复权与腾讯前复权 OHLC 必须逐字段一致后才会缓存并参与计算。本地 `5分钟数据/` 不再作为趋势价格来源；缺少完整核验窗口时不输出趋势分。

评分口径为 `two_source_qfq_daily_ohlc`。成交量与换手率保留各自的明确来源，不能反推或冒充复权价格。

## 运行

先安装项目本地 Python 依赖：

```bash
/opt/homebrew/bin/python3.12 -m venv .venv-uptrend312
.venv-uptrend312/bin/python -m pip install -r requirements-uptrend-score.txt
```

计算一只股票：

```bash
.venv-uptrend312/bin/python scripts/uptrend_score.py --date 2026-06-05 --code 600667
```

计算全市场并取前 100 名：

```bash
.venv-uptrend312/bin/python scripts/uptrend_score.py --date 2026-06-05 --limit 100 --output output/uptrend_2026-06-05.json
```

也支持传入自有的标准日K CSV、JSON 或 Parquet；字段必须包括 `date`、`code`、`open`、`high`、`low`、`close`、`pre_close`、`volume`，可选 `name`：

```bash
.venv-uptrend312/bin/python scripts/uptrend_score.py --date 2026-06-05 --input bars.csv --code 600667
```

所有阈值与分项权重位于 [`data/uptrend_score_config.json`](../data/uptrend_score_config.json)。评分日期后的行会在进入计算前被过滤，输出 `evidence` 保留每项的原始观察值、确认波段和得分组成。
