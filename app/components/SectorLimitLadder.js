"use client";

import { useEffect, useState } from "react";
import { buildScoreHistoryChart, scoreHistoryLineSegments } from "../lib/scoreHistoryChart.js";

const rate = (value) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const height = (row) => row.heightExact ? row.height === 1 ? "首板" : `${row.height}连板` : `至少${row.height}板`;
function groupRows(rows, label) {
  const groups = new Map();
  for (const row of rows) {
    const key = label(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups];
}

const trendMetrics = [
  ["highest", "最高连板高度"],
  ["firstBoards", "首板数量"],
  ["consecutive", "连板数量"],
  ["promotionRate", "晋级率"],
  ["failedSealRate", "炸板率"],
  ["previousMeanReturn", "昨日涨停股平均收益"],
];

function LadderTrend({ history }) {
  const [field, setField] = useState("highest");
  const percentage = field.endsWith("Rate") || field === "previousMeanReturn";
  const label = trendMetrics.find(([key]) => key === field)[1];
  const values = history.map((row) => !row.final || (field === "highest" && row.heightIncomplete)
    ? null : row[field] == null ? null : row[field] * (field.endsWith("Rate") ? 100 : 1));
  const min = Math.min(0, ...values.filter(Number.isFinite));
  const max = Math.max(1, ...values.filter(Number.isFinite));
  const chart = buildScoreHistoryChart(history.map((row, index) => ({
    date: row.date, score: { mainline_rank_score: values[index] == null ? null : (values[index] - min) / (max - min) * 100 },
  })));
  return <>
    <label>趋势指标 <select value={field} onChange={(event) => setField(event.target.value)}>{trendMetrics.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <figure className="sector-ladder-chart">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${label}逐交易日趋势，具体数值见下表`}>
        {scoreHistoryLineSegments(chart.points, "scoreY").map((segment) => <polyline key={segment[0]} points={segment.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />)}
        {chart.points.map((point, index) => point.scoreY == null ? null : <circle key={point.date} cx={point.x} cy={point.scoreY} r="3" fill="currentColor"><title>{point.date} {values[index].toFixed(percentage ? 2 : 0)}{percentage ? "%" : ""}</title></circle>)}
        {[chart.points[0], chart.points.at(-1)].filter(Boolean).map((point, index) => <text key={point.date} x={point.x} y={chart.height - 5} textAnchor={index ? "end" : "start"} fill="currentColor">{point.date}</text>)}
      </svg>
    </figure>
  </>;
}

export default function SectorLimitLadder({ taxonomy, initialDate, initialPrimary, onOpenStock }) {
  const [date, setDate] = useState(initialDate);
  const [primary, setPrimary] = useState(initialPrimary || "");
  const [secondary, setSecondary] = useState("");
  const [tertiary, setTertiary] = useState("");
  const [board, setBoard] = useState("");
  const [includeSt, setIncludeSt] = useState(true);
  const [period, setPeriod] = useState("5");
  const [filter, setFilter] = useState("全部");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [query, setQuery] = useState(null);
  const sectors = taxonomy.sectors || [];
  const secondaries = sectors.find((sector) => sector.name === primary)?.secondary_sectors || [];
  const tertiaries = secondaries.find((sector) => sector.name === secondary)?.tertiary_sectors || [];

  function analyze(event) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    setError("");
    setQuery(new URLSearchParams({ date, primary, secondary, tertiary, board, period, includeSt: includeSt ? "1" : "0" }));
  }

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const response = await fetch(`/api/sector-limit-ladder?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(payload.error || "读取失败");
        setResult(payload);
        setError("");
        if (payload.current.live && !payload.current.final && payload.current.available) timer = window.setTimeout(refresh, 60_000);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const current = result?.current;
  const ladder = (result?.ladder || []).filter((row) => filter === "全部" ||
    (filter === "首板" && row.height === 1 && row.heightExact) ||
    (filter === "连板" && row.height >= 2));
  const groups = groupRows(ladder, height);
  const cohorts = groupRows(result?.transitions || [], (row) => row.previousHeightExact ? `${row.previousHeight}板` : `至少${row.previousHeight}板`);
  const stockButton = (row) => <button type="button" className="notes-toggle" onClick={() => onOpenStock(row, current.date)}>{row.name} {row.code}</button>;

  return <section className="selection-result sector-ladder">
    <h2>板块连板梯队</h2>
    <form className="strategy-backtest-controls" onSubmit={analyze}>
      <label>交易日期<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label>一级产业<select required value={primary} onChange={(event) => { setPrimary(event.target.value); setSecondary(""); setTertiary(""); }}><option value="">选择产业</option>{sectors.map(({ name }) => <option key={name}>{name}</option>)}</select></label>
      <label>二级方向<select value={secondary} onChange={(event) => { setSecondary(event.target.value); setTertiary(""); }}><option value="">全部</option>{secondaries.map(({ name }) => <option key={name}>{name}</option>)}</select></label>
      <label>三级方向<select value={tertiary} onChange={(event) => setTertiary(event.target.value)}><option value="">全部</option>{tertiaries.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>市场<select value={board} onChange={(event) => setBoard(event.target.value)}><option value="">全部</option>{["主板", "创业板", "科创板", "北交所"].map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>历史窗口<select value={period} onChange={(event) => setPeriod(event.target.value)}>{[5, 10, 20, 30].map((n) => <option key={n} value={n}>{n} 个交易日</option>)}</select></label>
      <label><span><input type="checkbox" checked={includeSt} onChange={(event) => setIncludeSt(event.target.checked)} /> 包含 ST 及 ST 状态未知</span></label>
      <button type="submit" className="notes-toggle" disabled={loading}>{loading ? "正在读取行情…" : "查询 / 刷新"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {current && <>
      <h3>{current.date} · {[result.primary, result.secondary, result.tertiary].filter(Boolean).join(" / ")}</h3>
      <p>{current.final ? "收盘统计" : current.available ? "盘中快照 · 封板与晋级为暂时状态" : "行情不可用"} · {result.memberCount} 只成员 · {current.unobservable} 只缺少可用限价判断</p>
      <p>{current.source} {current.issue}。{result.classificationBasis}</p>
      {current.available && result.unavailableMembers.length > 0 && <details><summary>查看不可观察成员</summary><ul>{result.unavailableMembers.map((row) => <li key={row.code}>{stockButton(row)} {row.reason}</li>)}</ul></details>}
      <p>常规限价按昨收和交易规则计算。首封、末封、开板次数及封单暂无数据。</p>
      <div className="strategy-summary">
        {[["涨停", current.limitUps], ["最高板", current.heightIncomplete ? `至少 ${current.highest}` : current.highest], ["连板", current.consecutive], ["晋级率", rate(current.promotionRate)], ["炸板率", rate(current.failedSealRate)]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value ?? "—"}</b></div>)}
      </div>
      <section><h3>涨停梯队</h3>
        <label>梯队筛选 <select value={filter} onChange={(event) => setFilter(event.target.value)}>{["全部", "首板", "连板"].map((name) => <option key={name}>{name}</option>)}</select></label>
        {!ladder.length && <p>{current.available ? "无已识别的匹配股票。" : "缺少行情。"}</p>}
        {groups.map(([label, rows]) => <div key={label}><h4>{label} · {rows.length} 只</h4><ul className="sector-ladder-stocks">{rows.map((row) => <li key={row.code}>
          {stockButton(row)}<span>{row.type} · {row.rollingCount == null ? "13日数据不足" : `13天${row.rollingCount}板`}{row.rebound ? " · 反包" : ""}</span>
          <span>{row.amount == null ? "成交额暂无" : `成交额 ${(row.amount / 1e8).toFixed(2)} 亿`} · 主营关联度 {row.relevance ?? "—"}</span>
          <span title={row.turnoverSource}>换手率 {row.turnoverRate == null ? "暂无" : `${row.turnoverRate.toFixed(2)}%`}</span>
          <small>{row.directions.join("、") || "暂无三级方向"}</small>
        </li>)}</ul></div>)}
      </section>
      <section><h3>晋级与淘汰</h3>
        <p>分母为昨日封板且今日可观察的股票。{current.previousAvailable ? `昨日 ${current.previous} 只，今日可观察 ${current.observable ?? "待收盘"} 只。` : "昨日缺少已确认收盘行情。"}</p>
        {cohorts.map(([label, rows]) => {
          const promoted = rows.filter((row) => row.status === "晋级").length;
          const broken = rows.filter((row) => row.status === "断板").length;
          return <details key={label}><summary>昨日{label} · {rows.length} 只 · {current.final ? `晋级 ${promoted} / 断板 ${broken} / 晋级率 ${rate(promoted + broken ? promoted / (promoted + broken) : null)}` : "待收盘"}</summary>
            <ul>{rows.map((row) => <li key={row.code}>{stockButton(row)} {row.status} {row.down && current.final ? "· 跌停" : ""} {row.highOpenFade ? "· 高开低走" : ""} {row.reason}</li>)}</ul>
          </details>;
        })}
        <p>炸板 {current.failedSeals ?? "—"} 只 {result.failedSeals.map((row) => <span key={row.code}>{stockButton(row)} </span>)}</p>
      </section>
      <section><h3>产业细分</h3>
        <div className="sector-ladder-table"><table><thead><tr>{["方向", "最高板", "连板", "首板", "涨停", "断板", "晋级率"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{result.directions.map((row) => <tr key={row.direction}><th scope="row">{row.direction}</th><td>{row.heightIncomplete ? "≥" : ""}{row.highest ?? "—"}</td><td>{row.consecutive ?? "—"}</td><td>{row.firstBoards ?? "—"}</td><td>{row.limitUps ?? "—"}</td><td>{row.broken ?? "—"}</td><td>{rate(row.promotionRate)}</td></tr>)}</tbody></table></div>
      </section>
      <section><h3>历史演变</h3>
        <LadderTrend history={result.history} />
        <div className="sector-ladder-table"><table><thead><tr>{["日期", "最高板", "3板以上（含）", "2板", "首板", "连板", "2进3", "总晋级率", "炸板率", "昨日涨停平均收益"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{result.history.map((row) => <tr key={row.date}><th scope="row" title={row.issue || row.source}>{row.date}{!row.final && row.available ? "（盘中）" : ""}</th><td>{row.heightIncomplete ? "≥" : ""}{row.highest ?? "—"}</td><td>{row.threePlus ?? "—"}</td><td>{row.twoBoards ?? "—"}</td><td>{row.firstBoards ?? "—"}</td><td>{row.consecutive ?? "—"}</td><td>{rate(row.twoToThree)}</td><td>{rate(row.promotionRate)}</td><td>{rate(row.failedSealRate)}</td><td>{row.previousMeanReturn == null ? "—" : `${row.previousMeanReturn.toFixed(2)}%（${row.returnSample}只）`}</td></tr>)}</tbody></table></div>
      </section>
      <section><h3>空间高度候选</h3>
        {result.leaders.length ? <ul>{result.leaders.map((row) => <li key={row.code}>{stockButton(row)} {height(row)} · 当日已识别的最高连续封板高度{current.final ? "" : "（暂时）"}</li>)}</ul> : <p>暂无可确认的候选。</p>}
        <h4>高弹性候选</h4>
        {result.highElasticity.length ? <ul>{result.highElasticity.map((row) => <li key={row.code}>{stockButton(row)} {row.board} · 涨幅 {row.changePct.toFixed(2)}% · {current.final ? "收盘封板" : "暂时封板"}</li>)}</ul> : <p>暂无创业板或科创板封板候选。</p>}
        <h4>当日高标共存</h4>
        {result.highCoexistence.length < 2 ? <p>所选板块暂无两只及以上达到 3 板的股票。</p> : <ul>{result.highCoexistence.map((row) => <li key={row.code}>{stockButton(row)} {height(row)} · {row.directions.join("、") || "暂无三级方向"}</li>)}</ul>}
      </section>
    </>}
  </section>;
}
