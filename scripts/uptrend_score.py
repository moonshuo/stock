#!/usr/bin/env python3
"""Deterministic, forward-only A-share daily uptrend scorer.

The scorer intentionally contains no board, industry, trading-signal, or risk
classification logic.  It accepts normalized daily OHLCV bars, scores one
as-of date using only that date and earlier bars, and uses cached,
two-source-verified qfq daily OHLC for market scoring.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_COLUMNS = ("date", "code", "open", "high", "low", "close", "pre_close", "volume")


def load_config(path: Path | None = None) -> dict[str, Any]:
    with (path or ROOT / "data" / "uptrend_score_config.json").open(encoding="utf-8") as handle:
        return json.load(handle)


def normalize_code(value: Any) -> str:
    return "".join(character for character in str(value or "") if character.isdigit()).zfill(6)[-6:]


def threshold_score(value: float, rules: list[list[float | None]]) -> float:
    """Rules are upper bounds followed by score; null means the final bucket."""
    for upper, score in rules:
        if upper is None or value <= float(upper):
            return float(score)
    raise AssertionError("threshold rules require a final open-ended bucket")


def percentage_change(last: float, first: float) -> float:
    return last / first - 1 if first > 0 else float("nan")


def maximum_drawdown(closes: pd.Series) -> float:
    peaks = closes.cummax()
    return float((1 - closes / peaks).max())


def upper_shadow_ratio(bar: pd.Series) -> float | None:
    """Return the upper wick as a fraction of the day's full range."""
    high, low, open_price, close = (float(bar[key]) for key in ("high", "low", "open", "close"))
    if not all(math.isfinite(value) for value in (high, low, open_price, close)) or high <= low:
        return None
    return max(0.0, (high - max(open_price, close)) / (high - low))


def upper_shadow_penalty(frame: pd.DataFrame, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    """Penalize recent upper wicks, with a separate confirmation from turnover.

    Each of the most recent three observed trading days is compared only with
    its preceding five rows.  This preserves the as-of boundary and avoids
    treating absolute volume as turnover rate.
    """
    windows, thresholds = config["windows"], config["thresholds"]
    recent_days = int(windows["upper_shadow_recent_days"])
    baseline_days = int(windows["upper_shadow_turnover_baseline_days"])
    minimum_ratio = float(thresholds["upper_shadow_min_ratio"])
    full_penalty = float(thresholds["upper_shadow_full_penalty"])
    turnover_full_multiple = float(thresholds["upper_shadow_turnover_full_penalty_multiple"])
    if not 0 <= minimum_ratio < 1 or full_penalty < 0 or turnover_full_multiple <= 1:
        raise ValueError("上影线惩罚配置无效")

    observations = []
    total = 0.0
    start = max(baseline_days, len(frame) - recent_days)
    for position in range(start, len(frame)):
        bar = frame.iloc[position]
        ratio = upper_shadow_ratio(bar)
        wick_scale = 0.0 if ratio is None else min(1.0, max(0.0, (ratio - minimum_ratio) / (1 - minimum_ratio)))
        base_penalty = full_penalty * wick_scale

        turnover_rate = float(bar.turnover_rate) if "turnover_rate" in frame and pd.notna(bar.turnover_rate) else float("nan")
        prior_rates = pd.to_numeric(frame.iloc[position - baseline_days:position].get("turnover_rate", pd.Series(dtype=float)), errors="coerce")
        turnover_available = math.isfinite(turnover_rate) and turnover_rate > 0 and len(prior_rates) == baseline_days and prior_rates.notna().all() and (prior_rates > 0).all()
        baseline = float(prior_rates.mean()) if turnover_available else None
        turnover_multiple = turnover_rate / baseline if turnover_available and baseline and baseline > 0 else None
        # The confirmation starts only when turnover is above its own prior
        # five-trading-day mean, then rises linearly to a doubled wick penalty
        # at the configured multiple.  Missing rates never use volume as a proxy.
        turnover_scale = min(1.0, max(0.0, (turnover_multiple - 1) / (turnover_full_multiple - 1))) if turnover_multiple is not None else 0.0
        penalty = base_penalty * (1 + turnover_scale)
        total += penalty
        observations.append({
            "date": str(bar.date.date()), "upper_shadow_ratio": round(ratio, 6) if ratio is not None else None,
            "turnover_rate": round(turnover_rate, 6) if math.isfinite(turnover_rate) else None,
            "turnover_baseline_rate": round(baseline, 6) if baseline is not None else None,
            "turnover_multiple": round(turnover_multiple, 6) if turnover_multiple is not None else None,
            "base_penalty": round(base_penalty, 6), "turnover_scale": round(turnover_scale, 6), "penalty": round(penalty, 6),
        })
    return total, {
        "recent_days": recent_days, "turnover_baseline_days": baseline_days,
        "minimum_upper_shadow_ratio": minimum_ratio, "full_penalty_per_day": full_penalty,
        "turnover_full_penalty_multiple": turnover_full_multiple, "observations": observations,
        "total_penalty": round(total, 6),
    }


def confirmed_pivots(frame: pd.DataFrame, field: str, radius: int, comparison: str) -> list[dict[str, Any]]:
    values = frame[field].tolist()
    pivots = []
    for index in range(radius, len(frame) - radius):
        center = values[index]
        neighbours = values[index - radius:index] + values[index + 1:index + radius + 1]
        if (comparison == "low" and all(center < value for value in neighbours)) or (comparison == "high" and all(center > value for value in neighbours)):
            pivots.append({"date": str(frame.iloc[index].date), "value": round(float(center), 4)})
    return pivots


def input_error(code: str, name: str, date: str, reason: str, missing: list[str]) -> dict[str, Any]:
    return {"code": code, "name": name, "date": date, "trend_score": None, "raw_trend_score": None, "upper_shadow_penalty": None, "ma_score": None,
            "structure_score": None, "persistence_score": None, "stability_score": None, "volume_score": None,
            "reason": reason, "missing_data": missing, "evidence": {}}


def make_reason(evidence: dict[str, Any], scores: dict[str, float]) -> str:
    phrases = []
    if scores["ma"] >= 18:
        phrases.append("均线关系与中短期均线斜率整体向上")
    elif scores["ma"] >= 10:
        phrases.append("部分均线条件保持向上")
    if evidence["structure"]["higher_lows"]:
        phrases.append("确认波段低点抬升")
    if evidence["structure"]["higher_highs"]:
        phrases.append("确认波段高点抬升")
    if evidence["persistence"]["return_20d"] > 0 and scores["persistence"] >= 12:
        phrases.append("近20日涨幅与站上MA10天数显示上涨具有持续性")
    if scores["stability"] >= 14:
        phrases.append("回撤及均线收复表现较稳定")
    if scores["volume"] >= 7:
        phrases.append("上涨日量能相对更积极，未见连续放量下跌")
    if evidence["upper_shadow"]["total_penalty"] > 0:
        phrases.append(f"近三日上影线风险扣分{evidence['upper_shadow']['total_penalty']:.1f}分")
    return "，".join(phrases) + "。" if phrases else "均线、结构、持续性或回调稳定性证据不足，因此趋势评分较低。"


def json_scalar(value: Any) -> Any:
    """Convert pandas/numpy scalar evidence without changing its value."""
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"cannot serialize {type(value).__name__}")


def score_daily_bars(bars: pd.DataFrame, *, code: str, name: str = "", as_of_date: str | None = None, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Score normalized daily bars without observing rows after ``as_of_date``."""
    config = config or load_config()
    windows, weights, thresholds = config["windows"], config["weights"], config["thresholds"]
    code = normalize_code(code)
    frame = bars.copy()
    missing_columns = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    date = as_of_date or (str(frame["date"].max()) if "date" in frame else "")
    if missing_columns:
        return input_error(code, name, date, "缺少趋势评分所需的日K字段，未使用替代数据。", missing_columns)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["code"] = frame["code"].map(normalize_code)
    frame = frame[(frame.code == code) & frame.date.notna()]
    if as_of_date:
        frame = frame[frame.date <= pd.Timestamp(as_of_date)]
    frame = frame.sort_values("date").drop_duplicates("date", keep="last").tail(int(windows["analysis_days"]))
    date = str(frame.date.iloc[-1].date()) if not frame.empty else (as_of_date or "")
    numeric_columns = ["open", "high", "low", "close", "pre_close", "volume"]
    for column in numeric_columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    invalid = [column for column in numeric_columns if frame[column].isna().any() or (frame[column] <= 0).any()]
    if invalid:
        return input_error(code, name, date, "日K关键价格或成交量存在缺失/非法值，未使用虚构数据补齐。", invalid)
    if len(frame) < int(windows["minimum_history_days"]):
        return input_error(code, name, date, f"仅有 {len(frame)} 个交易日，少于均线斜率所需的 {windows['minimum_history_days']} 个交易日。", ["history"])

    frame = frame.assign(
        ma5=frame.close.rolling(5).mean(), ma10=frame.close.rolling(10).mean(), ma20=frame.close.rolling(20).mean(),
    )
    current = frame.iloc[-1]
    ma10_ago = frame.iloc[-1 - int(windows["ma_slope_days"])].ma10
    ma20_ago = frame.iloc[-1 - int(windows["ma_slope_days"])].ma20
    ma_parts = {
        "close_above_ma20": weights["ma"]["close_above_ma20"] if current.close > current.ma20 else 0,
        "ma5_above_ma10": weights["ma"]["ma5_above_ma10"] if current.ma5 > current.ma10 else 0,
        "ma10_above_ma20": weights["ma"]["ma10_above_ma20"] if current.ma10 > current.ma20 else 0,
        "ma10_rising": weights["ma"]["ma10_rising"] if current.ma10 > ma10_ago else 0,
        "ma20_rising": weights["ma"]["ma20_rising"] if current.ma20 > ma20_ago else 0,
        "close_above_ma5": weights["ma"]["close_above_ma5"] if current.close > current.ma5 else 0,
    }

    radius = int(windows["pivot_radius"])
    lows = confirmed_pivots(frame, "low", radius, "low")
    highs = confirmed_pivots(frame, "high", radius, "high")
    higher_lows = bool(len(lows) >= 2 and lows[-1]["value"] > lows[-2]["value"])
    higher_highs = bool(len(highs) >= 2 and highs[-1]["value"] > highs[-2]["value"])
    fallback_days = int(windows["structure_fallback_days"])
    before, recent = frame.iloc[-fallback_days * 2:-fallback_days], frame.iloc[-fallback_days:]
    fallback_low = bool(len(lows) < 2 and recent.low.min() > before.low.min())
    fallback_high = bool(len(highs) < 2 and recent.high.max() > before.high.max())
    recent_high = frame.high.tail(int(windows["persistence_days"])).max()
    near_high = bool(current.close >= recent_high * (1 - float(thresholds["near_recent_high_pct"])))
    structure_parts = {
        "higher_lows": weights["structure"]["higher_lows"] if higher_lows else (weights["structure"]["fallback_low"] if fallback_low else 0),
        "higher_highs": weights["structure"]["higher_highs"] if higher_highs else (weights["structure"]["fallback_high"] if fallback_high else 0),
        "recent_high": weights["structure"]["recent_high"] if near_high else 0,
    }

    persistence_days = int(windows["persistence_days"])
    latest20 = frame.tail(persistence_days)
    return20 = percentage_change(float(latest20.close.iloc[-1]), float(latest20.close.iloc[0]))
    above_ma10_days = int((latest20.close > latest20.ma10).sum())
    return5 = percentage_change(float(frame.close.iloc[-1]), float(frame.close.iloc[-int(windows["short_return_days"]) ]))
    return10 = percentage_change(float(frame.close.iloc[-1]), float(frame.close.iloc[-int(windows["medium_return_days"]) ]))
    persistence_parts = {
        "return_20d": threshold_score(return20, thresholds["return_20d"]),
        "above_ma10": weights["persistence"]["above_ma10"] * above_ma10_days / persistence_days,
        "return_5d": weights["persistence"]["return_5d"] if return5 > 0 else 0,
        "return_10d": weights["persistence"]["return_10d"] if return10 > 0 else 0,
    }

    max_drawdown = maximum_drawdown(latest20.close)
    latest10 = frame.tail(int(windows["drawdown_daily_days"]))
    max_daily_loss = max(0.0, float((1 - latest10.close / latest10.pre_close).max()))
    ma10_window = frame.tail(int(windows["ma10_recovery_days"]))
    below_ma10 = ma10_window.index[ma10_window.close < ma10_window.ma10].tolist()
    if not below_ma10:
        ma10_recovery = weights["stability"]["ma10_recovery"]
    elif current.close >= current.ma10 and len(ma10_window) - 1 - ma10_window.index.get_loc(below_ma10[-1]) <= int(thresholds["ma10_recovery_within_days"]):
        ma10_recovery = weights["stability"]["ma10_recovered"]
    else:
        ma10_recovery = 0
    ma20_window = frame.tail(int(windows["ma20_hold_days"]))
    ma20_below_days = int((ma20_window.close < ma20_window.ma20).sum())
    ma20_hold = weights["stability"]["ma20_hold"] if ma20_below_days == 0 else (weights["stability"]["ma20_recovered"] if current.close >= current.ma20 else 0)
    stability_parts = {
        "max_drawdown": threshold_score(max_drawdown, thresholds["max_drawdown"]),
        "max_daily_loss": threshold_score(max_daily_loss, thresholds["max_daily_loss"]),
        "ma10_recovery": ma10_recovery,
        "ma20_hold": ma20_hold,
    }

    volume_window = frame.tail(int(windows["volume_days"]))
    up_volume = volume_window.loc[volume_window.close > volume_window.pre_close, "volume"]
    down_volume = volume_window.loc[volume_window.close < volume_window.pre_close, "volume"]
    if up_volume.empty or down_volume.empty:
        return input_error(code, name, date, "最近20日缺少上涨日或下跌日，无法比较成交量配合。", ["volume_direction_sample"])
    volume_ratio = float(up_volume.mean() / down_volume.mean())
    pressure_window = frame.tail(int(windows["volume_pressure_days"]))
    heavy_down = []
    baseline_days = int(windows["volume_baseline_days"])
    for position in range(baseline_days, len(pressure_window)):
        bar = pressure_window.iloc[position]
        baseline = pressure_window.volume.iloc[position - baseline_days:position].mean()
        heavy_down.append(bool(bar.close < bar.pre_close and bar.volume > baseline * float(thresholds["volume_spike_multiple"])))
    consecutive = max((len(list(group)) for value, group in __import__("itertools").groupby(heavy_down) if value), default=0)
    volume_parts = {
        "up_down_ratio": threshold_score(volume_ratio, thresholds["up_down_volume_ratio"]),
        "downside_pressure": 0 if consecutive >= int(thresholds["consecutive_heavy_down_days"]) else (weights["volume"]["downside_pressure_individual"] if any(heavy_down) else weights["volume"]["downside_pressure"]),
    }

    scores = {"ma": sum(ma_parts.values()), "structure": sum(structure_parts.values()), "persistence": sum(persistence_parts.values()), "stability": sum(stability_parts.values()), "volume": sum(volume_parts.values())}
    shadow_penalty, shadow_evidence = upper_shadow_penalty(frame, config)
    evidence = {
        "price_basis": config["data"]["price_basis"], "observed_days": len(frame),
        "ma": {"ma5": round(float(current.ma5), 4), "ma10": round(float(current.ma10), 4), "ma20": round(float(current.ma20), 4), "ma10_5d_ago": round(float(ma10_ago), 4), "ma20_5d_ago": round(float(ma20_ago), 4), "parts": ma_parts},
        "structure": {"confirmed_lows": lows, "confirmed_highs": highs, "higher_lows": higher_lows, "higher_highs": higher_highs, "fallback_low": fallback_low, "fallback_high": fallback_high, "recent_high": round(float(recent_high), 4), "near_recent_high": near_high, "parts": structure_parts},
        "persistence": {"return_20d": round(return20, 6), "above_ma10_days": above_ma10_days, "return_5d": round(return5, 6), "return_10d": round(return10, 6), "parts": persistence_parts},
        "stability": {"max_drawdown": round(max_drawdown, 6), "max_daily_loss": round(max_daily_loss, 6), "ma10_below_days": len(below_ma10), "ma20_below_days": ma20_below_days, "parts": stability_parts},
        "volume": {"up_day_average_volume": round(float(up_volume.mean()), 4), "down_day_average_volume": round(float(down_volume.mean()), 4), "up_down_volume_ratio": round(volume_ratio, 6), "max_consecutive_heavy_down_days": consecutive, "parts": volume_parts},
        "upper_shadow": shadow_evidence,
    }
    raw_score = sum(scores.values())
    return {"code": code, "name": name, "date": date, "trend_score": round(max(0.0, raw_score - shadow_penalty), 2), "raw_trend_score": round(raw_score, 2), "upper_shadow_penalty": round(shadow_penalty, 2), "ma_score": round(scores["ma"], 2), "structure_score": round(scores["structure"], 2), "persistence_score": round(scores["persistence"], 2), "stability_score": round(scores["stability"], 2), "volume_score": round(scores["volume"], 2), "reason": make_reason(evidence, scores), "missing_data": [], "evidence": evidence}


def available_snapshot_files(root: Path, end_date: str, count: int, dates: list[str] | None = None) -> list[Path]:
    if dates is not None:
        if len(dates) != count or dates != sorted(set(dates)) or dates[-1] != end_date:
            raise ValueError("趋势评分交易日窗口必须是截至评分日的完整、有序且不重复日期序列")
        files = [root / "5分钟数据" / date[:4] / f"{date.replace('-', '')}.parquet" for date in dates]
        missing = [str(file) for file in files if not file.is_file()]
        if missing:
            raise FileNotFoundError(f"趋势评分缺少交易日快照：{', '.join(missing)}")
        return files
    files = []
    for year in sorted((root / "5分钟数据").glob("[0-9][0-9][0-9][0-9]")):
        files.extend(path for path in year.glob("*.parquet") if path.stem <= end_date.replace("-", ""))
    return sorted(files, key=lambda path: path.stem)[-count:]


def load_local_daily_bars(root: Path, end_date: str, days: int, codes: set[str] | None = None, config: dict[str, Any] | None = None, dates: list[str] | None = None) -> pd.DataFrame:
    files = available_snapshot_files(root, end_date, days, dates)
    if not files:
        raise FileNotFoundError(f"截至 {end_date} 没有本地 5 分钟 Parquet 快照")
    daily = []
    for file in files:
        raw = pd.read_parquet(file, columns=["code", "trade_time", "close", "open", "high", "low", "vol", "amount", "pre_close"])
        raw["code"] = raw.code.map(normalize_code)
        if codes:
            raw = raw[raw.code.isin(codes)]
        if raw.empty:
            continue
        raw["trade_time"] = raw.trade_time.astype(str)
        raw = raw.sort_values(["code", "trade_time"])
        grouped = raw.groupby("code", sort=False)
        bars = grouped.agg(open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last"), pre_close=("pre_close", "first"), volume=("vol", "last"), amount=("amount", "last")).reset_index()
        bars["date"] = f"{file.stem[:4]}-{file.stem[4:6]}-{file.stem[6:]}"
        daily.append(bars)
    result = pd.concat(daily, ignore_index=True) if daily else pd.DataFrame(columns=REQUIRED_COLUMNS)
    if result.empty:
        return result
    # Price fields never come from local five-minute snapshots: a later
    # corporate action can make their raw series disagree with the qfq chart.
    # A stock needs a complete verified qfq window; otherwise it receives no
    # score rather than a silently mixed-price score.
    drop_positions = []
    for stock_code, positions in result.groupby("code").groups.items():
        for index in positions:
            date = str(result.at[index, "date"])
            quote_path = root / "data" / "historical_qfq_quote_audits" / date / f"{stock_code}.json"
            try:
                audit = json.loads(quote_path.read_text(encoding="utf-8"))
                quote = audit.get("consensus", {})
                if audit.get("version") != "1.0" or audit.get("verification") != "two_source_qfq_ohlc_agreement" or audit.get("date") != date or normalize_code(audit.get("code")) != stock_code:
                    raise ValueError("unverified qfq quote")
                values = {field: float(quote[field]) for field in ("open", "high", "low", "close", "pre_close")}
                if not all(math.isfinite(value) and value > 0 for value in values.values()) or values["high"] < max(values["open"], values["close"]) or values["low"] > min(values["open"], values["close"]):
                    raise ValueError("invalid qfq quote")
                for field, value in values.items(): result.at[index, field] = value
            except (OSError, KeyError, ValueError, TypeError, json.JSONDecodeError):
                drop_positions.extend(positions)
                break
    if drop_positions:
        result = result.drop(index=set(drop_positions)).reset_index(drop=True)
    if result.empty:
        return result
    # This source is the reported historical turnover rate, not a calculation
    # from local 5-minute volume.  Reading only the final eight dates bounds
    # the I/O to the three assessed candles plus their five-day baselines.
    result["turnover_rate"] = float("nan")
    windows = (config or load_config(root / "data" / "uptrend_score_config.json"))["windows"]
    required_days = int(windows["upper_shadow_recent_days"]) + int(windows["upper_shadow_turnover_baseline_days"])
    for stock_code, positions in result.groupby("code").groups.items():
        recent_positions = result.loc[list(positions)].sort_values("date").tail(required_days).index
        for index in recent_positions:
            date = str(result.at[index, "date"])
            record_path = root / "data" / "daily_turnover_rate" / date / f"{stock_code}.json"
            try:
                record = json.loads(record_path.read_text(encoding="utf-8"))
                rate = float(record.get("turnover_rate"))
                if record.get("date") == date and normalize_code(record.get("code")) == stock_code and math.isfinite(rate) and rate > 0:
                    result.at[index, "turnover_rate"] = rate
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                pass
    return result


def stock_names(root: Path) -> dict[str, str]:
    with (root / "data" / "stock_name_map.json").open(encoding="utf-8") as handle:
        payload = json.load(handle)
    return {normalize_code(code): str(name) for code, name in payload.get("names", {}).items()}


def score_market(root: Path, date: str, *, code: str | None = None, codes: set[str] | None = None, config: dict[str, Any] | None = None, dates: list[str] | None = None) -> list[dict[str, Any]]:
    config = config or load_config(root / "data" / "uptrend_score_config.json")
    requested = {normalize_code(code)} if code else ({normalize_code(value) for value in codes} if codes else None)
    bars = load_local_daily_bars(root, date, int(config["windows"]["analysis_days"]), requested, config, dates)
    names = stock_names(root)
    rows = [score_daily_bars(group, code=stock_code, name=names.get(stock_code, ""), as_of_date=date, config=config) for stock_code, group in bars.groupby("code")]
    return sorted(rows, key=lambda row: (row["trend_score"] is None, -(row["trend_score"] or 0), row["code"]))


def load_input_bars(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        return pd.DataFrame(payload.get("bars", payload) if isinstance(payload, dict) else payload)
    raise ValueError("--input 仅支持 CSV、JSON 或 Parquet 日K文件")


def score_input(bars: pd.DataFrame, date: str, *, code: str | None = None, config: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    selected = {normalize_code(code)} if code else set(bars.get("code", pd.Series(dtype=str)).map(normalize_code))
    rows = []
    for stock_code in sorted(selected):
        group = bars[bars["code"].map(normalize_code) == stock_code] if "code" in bars else bars
        name = str(group["name"].dropna().iloc[-1]) if "name" in group and not group["name"].dropna().empty else ""
        rows.append(score_daily_bars(group, code=stock_code, name=name, as_of_date=date, config=config))
    return sorted(rows, key=lambda row: (row["trend_score"] is None, -(row["trend_score"] or 0), row["code"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="评分截止日，YYYY-MM-DD")
    parser.add_argument("--dates", help="可选：逗号分隔的已核验交易日窗口；提供时必须与评分截止日对齐")
    parser.add_argument("--code", help="可选：仅计算一只六位股票代码")
    parser.add_argument("--codes", help="可选：以逗号分隔的多只六位股票代码；与 --code 互斥")
    parser.add_argument("--input", type=Path, help="可选：CSV、JSON 或 Parquet 格式的标准日K输入；不提供时读取本地5分钟归档")
    parser.add_argument("--config", type=Path, help="可选评分配置 JSON")
    parser.add_argument("--output", type=Path, help="可选输出文件；默认输出 stdout")
    parser.add_argument("--limit", type=int, default=0, help="可选：只输出排名前 N 名")
    args = parser.parse_args()
    if args.code and args.codes:
        parser.error("--code 与 --codes 不能同时使用")
    config = load_config(args.config) if args.config else load_config()
    codes = {normalize_code(value) for value in args.codes.split(",") if value.strip()} if args.codes else None
    dates = [value.strip() for value in args.dates.split(",") if value.strip()] if args.dates else None
    result = score_input(load_input_bars(args.input), args.date, code=args.code, config=config) if args.input else score_market(ROOT, args.date, code=args.code, codes=codes, config=config, dates=dates)
    if args.limit > 0:
        result = result[:args.limit]
    payload = {"version": config["version"], "date": args.date, "price_basis": config["data"]["price_basis"], "results": result}
    text = json.dumps(payload, ensure_ascii=False, indent=2, default=json_scalar)
    if args.output:
        args.output.write_text(f"{text}\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
