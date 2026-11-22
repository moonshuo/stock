"use client";

import { useEffect, useRef, useState } from "react";

const regimes = { offensive: "进攻", selective: "精选", defensive: "空仓防守" };
const reasons = {
  mixed_market: "市场信号分化",
  insufficient_market_data: "有效行情样本不足",
  negative_market_feedback: "市场上涨广度或涨跌幅中位数偏弱",
  cycle_unverified: "主线周期尚未确认",
  breadth_and_leading_cycle_confirmed: "市场广度与主线周期均已确认",
  no_is_validated_dimension: "暂无通过样本内验证的选股维度",
  incomplete_risk_window: "风控所需的历史交易日不足",
  no_entry_cycle: "当前周期禁止开仓",
  dimension_unavailable: "选股维度缺少数据",
};
const verdicts = { pass: "通过", caution: "谨慎", reject: "排除" };
const colors = { pass: "#187454", caution: "#926114", reject: "#ad3844" };
const card = { padding: 16, border: "1px solid #d5dce2", borderRadius: 10, overflowWrap: "anywhere" };

function reasonLabel(reason) {
  const [key, detail] = reason.split(":");
  return [reasons[key] || key, detail].filter(Boolean).join(" · ");
}

async function readResponse(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function Candidate({ stock }) {
  const sector = stock.sector_context;
  const stats = stock.historical_bucket_stats;
  return <article style={card}>
    <h3>{stock.name} <small>{stock.code}</small></h3>
    <p><strong>{stock.score.toFixed(1)} 分</strong> · {stock.setup_type} · {[sector.primary, sector.secondary].filter(Boolean).join(" / ") || sector.key}</p>
    <p>结构失效止损位 <b>{stock.invalidation_price} 元</b></p>
    <p>{stock.invalidation_rules.join("；")}</p>
    <strong>历史同分位统计</strong>
    {stats.dimensions?.length ? stats.dimensions.map((row, index) =>
      <p key={index}>截至 {row.as_of_date} · 样本 {row.sample_count} · T+3 超额 {row.t3_excess} · T+5 超额 {row.t5_excess}</p>
    ) : <p>截至当日暂无已验证的历史分组统计。</p>}
    <p>风险提示 · {stock.risk_warnings.join("；")}</p>
  </article>;
}

function PickerResults({ date, board, refresh, controls }) {
  const [result, setResult] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reviewRequest = useRef(null);
  useEffect(() => {
    const request = new AbortController();
    const params = new URLSearchParams({ board });
    if (date) params.set("date", date);
    readResponse(`/api/stock-picker?${params}`, { signal: request.signal, cache: "no-store" })
      .then(data => { if (!request.signal.aborted) setResult(data); })
      .catch(err => { if (!request.signal.aborted) setError(err.message); });
    return () => {
      request.abort();
      reviewRequest.current?.abort();
    };
  }, [date, board]);

  async function runReview() {
    const request = new AbortController();
    reviewRequest.current = request;
    setBusy(true);
    setError("");
    setReview(null);
    try {
      const data = await readResponse("/api/stock-picker/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: result.as_of_date, pickerResult: result }), signal: request.signal,
      });
      if (!request.signal.aborted) setReview(data);
    } catch (err) {
      if (!request.signal.aborted) setError(err.message);
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return <section style={{ display: "grid", gap: 12 }}>
    <h2>每日选股</h2>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {controls}
      <button type="button" onClick={refresh}>刷新</button>
      <button type="button" disabled={!result?.candidates.length || busy} onClick={runReview}>{busy ? "排雷中…" : "一键 AI 排雷"}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!result && !error && <p role="status">正在读取候选股…</p>}
    {result && <>
      <div style={card} role="status">
        <strong>{result.as_of_date} · {regimes[result.market_regime]}</strong>
        <p>{result.reasons.map(reasonLabel).join("；")}</p>
        {!result.candidates.length && <p>{result.cash_hint} 当日候选集为空。
          {Object.entries(result.diagnostics.exclusions).map(([key, count]) => <span key={key}> {key} × {count}</span>)}</p>}
        {result.static_taxonomy_caveat && <small>板块采用静态行业归属，历史成分可能与当时实际归属不同。</small>}
      </div>
      {result.candidates.map(stock => <Candidate key={stock.code} stock={stock} />)}
    </>}
    {review && <section style={{ display: "grid", gap: 10 }}>
      <h3>AI 排雷结果</h3><p>{review.market_summary}</p>
      {review.items.map(item => <article style={card} key={item.code}>
        <strong>{result.candidates.find(stock => stock.code === item.code)?.name} {item.code} · <span style={{ color: colors[item.verdict] }}>{verdicts[item.verdict]}</span></strong>
        <p>核心逻辑 · {item.core_logic}</p><p>冲突与风险 · {item.conflict_or_risk}</p><p>观察触发条件 · {item.watch_trigger}</p>
      </article>)}
    </section>}
  </section>;
}

export default function StockPickerPanel() {
  const [date, setDate] = useState("");
  const [board, setBoard] = useState("main_board");
  const [revision, setRevision] = useState(0);
  return <PickerResults key={`${date}/${board}/${revision}`} date={date} board={board}
    refresh={() => setRevision(n => n + 1)} controls={<>
      <label>交易日期 <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>板块范围 <select value={board} onChange={e => setBoard(e.target.value)}>
        <option value="main_board">主板优先</option><option value="all">全市场</option>
      </select></label>
    </>} />;
}
