# 选股评估：IS · 2025-01-02 至 2026-06-30

信号逐日收盘计算；交易成本 0.25%。static_taxonomy_caveat: true。分类来自当前静态产业图，不是时点成分；历史 ST 名称缺失不可冒充可交易。

|策略|期限|信号数|可观察数|胜率|均值|中位数|盈亏比|最大回撤¹|同期基准²|超额²|
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|主线＋龙头/中军行动|T+1|0|0|—|—|—|—|—|—|—|
|主线＋龙头/中军行动|T+3|0|0|—|—|—|—|—|—|—|
|主线＋龙头/中军行动|T+5|0|0|—|—|—|—|—|—|—|
|主线＋龙头/中军行动|T+10|0|0|—|—|—|—|—|—|—|
|强势股缩量回调|T+1|0|0|—|—|—|—|—|—|—|
|强势股缩量回调|T+3|0|0|—|—|—|—|—|—|—|
|强势股缩量回调|T+5|0|0|—|—|—|—|—|—|—|
|强势股缩量回调|T+10|0|0|—|—|—|—|—|—|—|
|绿盘涨停回调（完整）|T+1|0|0|—|—|—|—|—|—|—|
|绿盘涨停回调（完整）|T+3|0|0|—|—|—|—|—|—|—|
|绿盘涨停回调（完整）|T+5|0|0|—|—|—|—|—|—|—|
|绿盘涨停回调（完整）|T+10|0|0|—|—|—|—|—|—|—|
|前复权趋势|T+1|0|0|—|—|—|—|—|—|—|
|前复权趋势|T+3|0|0|—|—|—|—|—|—|—|
|前复权趋势|T+5|0|0|—|—|—|—|—|—|—|
|前复权趋势|T+10|0|0|—|—|—|—|—|—|—|
|绿盘形态初筛（诊断、不满足可交易准入）|T+1|53715|48967|47.97%|0.18%|0.00%|1.19|—|0.11%|0.05%|
|绿盘形态初筛（诊断、不满足可交易准入）|T+3|53715|45622|42.96%|-0.17%|-0.89%|1.24|-30.58%|-0.12%|-0.10%|
|绿盘形态初筛（诊断、不满足可交易准入）|T+5|53715|42854|42.75%|-0.18%|-1.16%|1.27|-22.87%|-0.03%|-0.21%|
|绿盘形态初筛（诊断、不满足可交易准入）|T+10|53715|36093|41.38%|-0.20%|-1.83%|1.35|-16.38%|0.35%|-0.57%|

¹ 非重叠入组的等权、可成交且有完整标签组合，按退出日计价；不等同于每日盯市最大回撤。T+1 只计毛浮动收益，不能当日卖出。
² 主板等权、同日同成本、可观察共同日期；非可投资指数，历史 ST 可能未知。无配对观测时不报告超额。

## 覆盖、周期与风险
### 主线＋龙头/中军行动
- 逐日覆盖：{"ok_days":0,"unavailable_days":370,"no_candidate_days":0,"reasons":{"unavailable_session:2025-01-01:unverified_weekday_or_missing_file":9,"production_mainline_does_not_emit_lifecycle":370,"leader_or_capacity_analysis_pending_offline":294,"unavailable_session:2025-01-28:unverified_weekday_or_missing_file":1,"unavailable_session:2025-01-29:unverified_weekday_or_missing_file":1,"unavailable_session:2025-01-30:unverified_weekday_or_missing_file":1,"unavailable_session:2025-01-31:unverified_weekday_or_missing_file":1,"unavailable_session:2025-02-03:unverified_weekday_or_missing_file":1,"unavailable_session:2025-02-04:unverified_weekday_or_missing_file":10,"unavailable_session:2025-04-04:unverified_weekday_or_missing_file":10,"unavailable_session:2025-05-01:unverified_weekday_or_missing_file":1,"unavailable_session:2025-05-02:unverified_weekday_or_missing_file":1,"unavailable_session:2025-05-05:unverified_weekday_or_missing_file":10,"unavailable_session:2025-06-02:unverified_weekday_or_missing_file":10,"unavailable_session:2025-06-16:no_usable_close":10,"unavailable_session:2026-02-10:no_usable_close":10}}
- 历史交易阶段：无可评价信号；不按未知周期倒推历史阶段。
- T+3 主要亏损组：[]；T+3 分位单调性：样本不足。
### 强势股缩量回调
- 逐日覆盖：{"ok_days":0,"unavailable_days":370,"no_candidate_days":0,"reasons":{"no_same_day_turnover_coverage":370}}
- 历史交易阶段：无可评价信号；不按未知周期倒推历史阶段。
- T+3 主要亏损组：[]；T+3 分位单调性：样本不足。
### 绿盘涨停回调（完整）
- 逐日覆盖：{"ok_days":0,"unavailable_days":370,"no_candidate_days":0,"reasons":{"unverified_10_session_window":76,"incomplete_verified_60_session_qfq":294}}
- 历史交易阶段：无可评价信号；不按未知周期倒推历史阶段。
- T+3 主要亏损组：[]；T+3 分位单调性：样本不足。
### 前复权趋势
- 逐日覆盖：{"ok_days":0,"unavailable_days":370,"no_candidate_days":0,"reasons":{"incomplete_verified_60_session_qfq":370}}
- 历史交易阶段：无可评价信号；不按未知周期倒推历史阶段。
- T+3 主要亏损组：[]；T+3 分位单调性：样本不足。
### 绿盘形态初筛（诊断、不满足可交易准入）
- 逐日覆盖：{"ok_days":294,"unavailable_days":76,"no_candidate_days":0,"reasons":{"shape_only_not_trade_eligible":370}}
- 历史交易阶段：emergence、fermentation、normal_divergence、strong_divergence、repair、startup_continuation、re_strengthening、unstarted、divergence_continuation、retreat_warning；不按未知周期倒推历史阶段。
- emergence T+3：n=4615，胜率 44.94%，均值 0.18%，中位数 -0.56%，盈亏比 1.33，最大回撤 -5.52%。
- fermentation T+3：n=7031，胜率 37.95%，均值 -1.11%，中位数 -1.61%，盈亏比 1.05，最大回撤 -33.11%。
- normal_divergence T+3：n=13450，胜率 42.88%，均值 -0.23%，中位数 -0.93%，盈亏比 1.21，最大回撤 -21.87%。
- strong_divergence T+3：n=1656，胜率 54.11%，均值 1.43%，中位数 0.53%，盈亏比 1.57，最大回撤 -2.63%。
- repair T+3：n=8358，胜率 41.34%，均值 -0.18%，中位数 -1.01%，盈亏比 1.32，最大回撤 -14.47%。
- startup_continuation T+3：n=1035，胜率 51.21%，均值 1.20%，中位数 0.18%，盈亏比 1.67，最大回撤 -1.73%。
- re_strengthening T+3：n=6002，胜率 43.12%，均值 -0.00%，中位数 -0.99%，盈亏比 1.32，最大回撤 -16.38%。
- unstarted T+3：n=2908，胜率 45.60%，均值 -0.03%，中位数 -0.60%，盈亏比 1.18，最大回撤 -10.20%。
- divergence_continuation T+3：n=272，胜率 52.94%，均值 1.36%，中位数 0.12%，盈亏比 1.75，最大回撤 0.00%。
- retreat_warning T+3：n=295，胜率 50.17%，均值 0.54%，中位数 0.01%，盈亏比 1.30，最大回撤 0.00%。
- T+3 主要亏损组：[{"market_regime":"unknown","cycle":"normal_divergence","observed":13450,"losses":7682,"loss_rate":0.5711524163568773,"mean_loss":-0.045880203841485036},{"market_regime":"unknown","cycle":"repair","observed":8358,"losses":4903,"loss_rate":0.5866235941612826,"mean_loss":-0.04303956484997629},{"market_regime":"unknown","cycle":"fermentation","observed":7031,"losses":4363,"loss_rate":0.6205376191153463,"mean_loss":-0.05000227115555837}]；T+3 分位单调性：样本不足。

## 证据索引
逐日信号、不可用原因、成交、标签及对照基准：output\stock-picker-eval\baseline-days。收益均为小数，缺失指标为 null，不是 0。
