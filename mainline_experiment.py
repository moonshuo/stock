#!/usr/bin/env python3
"""Evidence-first, isolated experiment for dynamic market-mainline detection.

The program deliberately does not infer a theme from a stock name, static industry,
or concept label.  A stock is grouped only when its input has an explicit
``dynamic_theme`` or a documented ``limit_reason``.  Missing evidence produces an
``insufficient_data`` result instead of a guess.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = {
    "weights": {"breadth": 20, "structure": 20, "continuity": 20,
                "capital_capacity": 15, "profit_effect": 15, "resilience": 10},
    "thresholds": {"confirmed_score": 75, "candidate_score": 50,
                   "strong_branch_score": 35, "min_confirmed_active_days": 2,
                   "min_confirmed_limit_ups": 2, "single_stock_amount_cap": 6,
                   "large_amount": 1_000_000_000, "high_gain_pct": 5,
                   "twenty_pct_limit": 19.5, "limit_up_pct": 9.8},
}


def number(value: Any) -> float | None:
    try:
        result = float(value)
        return result if result == result else None
    except (TypeError, ValueError):
        return None


def first_text(*values: Any) -> str:
    return next((str(x).strip() for x in values if isinstance(x, str) and x.strip()), "")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def load_config(path: str | None) -> dict[str, Any]:
    config = deepcopy(DEFAULT_CONFIG)
    if not path:
        return config
    supplied = load_json(Path(path))
    for section in ("weights", "thresholds"):
        if isinstance(supplied.get(section), dict):
            config[section].update(supplied[section])
    return config


def resolve_input(input_dir: Path, date: str) -> tuple[dict[str, Any], list[str]]:
    """Read the preferred normalized file, or safely adapt existing daily_themes.

    Legacy daily_themes data has reasons and stock membership but no price/amount
    metrics, so the adapter preserves that limitation rather than inventing them.
    """
    candidates = [input_dir / f"{date}.json", input_dir / "daily_themes" / f"{date}.json"]
    for candidate in candidates:
        if candidate.exists():
            raw = load_json(candidate)
            if isinstance(raw, dict):
                if "limit_ups" in raw or "stocks" in raw or "market_summary" in raw:
                    return raw, []
                if isinstance(raw.get("themes"), list):
                    stocks = []
                    for item in raw["themes"]:
                        if not isinstance(item, dict):
                            continue
                        theme = first_text(item.get("name"))
                        reason = first_text(item.get("reason"))
                        source = first_text(item.get("source"))
                        for code in item.get("stocks", []):
                            stocks.append({"code": str(code), "dynamic_theme": theme,
                                           "limit_reason": reason, "evidence": [source] if source else []})
                    return {"date": raw.get("date", date), "limit_ups": stocks}, [
                        "legacy_daily_themes_adapter: price, amount, board and confirmation fields are absent"
                    ]
    raise FileNotFoundError(f"No input found for {date}; expected {candidates[0]} or {candidates[1]}")


def stock_theme_mappings(stocks: list[dict[str, Any]]) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    uncertain = []
    for raw in stocks:
        if not isinstance(raw, dict):
            continue
        primary = first_text(raw.get("primary_dynamic_theme"), raw.get("dynamic_theme"), raw.get("limit_reason"))
        secondary = raw.get("secondary_dynamic_themes", [])
        if isinstance(secondary, str):
            secondary = [secondary]
        themes = [primary] + [str(x).strip() for x in secondary if str(x).strip()]
        themes = list(dict.fromkeys(x for x in themes if x))
        evidence = raw.get("evidence", [])
        if isinstance(evidence, str):
            evidence = [evidence]
        # A label without a contemporaneous reason/evidence cannot be trusted.
        if not themes or not (first_text(raw.get("limit_reason"), raw.get("theme_reason")) or evidence):
            uncertain.append({"code": str(raw.get("code", "")), "mapping_status": "uncertain",
                              "possible_themes": themes, "reason": "missing explicit same-day trading reason or evidence"})
            continue
        for theme in themes:
            item = dict(raw)
            item["_primary"] = theme == primary
            groups[theme].append(item)
    return groups, uncertain


def role_structure(stocks: list[dict[str, Any]]) -> dict[str, list[str]]:
    ordered = sorted(stocks, key=lambda s: (number(s.get("consecutive_limit_days")) or 0,
                                            number(s.get("amount")) or 0), reverse=True)
    codes = lambda rows: [str(s.get("code", "")) for s in rows if s.get("code")]
    leader = ordered[:1]
    highest = [s for s in ordered if (number(s.get("consecutive_limit_days")) or 0) == (number(leader[0].get("consecutive_limit_days")) or 0)] if leader else []
    capacity = sorted([s for s in stocks if number(s.get("amount")) is not None], key=lambda s: number(s.get("amount")) or 0, reverse=True)[:1]
    return {"leader": codes(leader), "height_stocks": codes(highest), "capacity_core": codes(capacity),
            "high_elasticity_stocks": codes([s for s in stocks if (number(s.get("change_pct")) or 0) >= 19.5]),
            "frontline_stocks": codes(ordered[:3]), "follow_up_stocks": codes(ordered[3:]),
            "low_position_stocks": codes([s for s in stocks if (number(s.get("consecutive_limit_days")) or 0) <= 1])}


def score_theme(stocks: list[dict[str, Any]], source: dict[str, Any], config: dict[str, Any]) -> tuple[dict[str, int], dict[str, Any], list[str]]:
    w, t = config["weights"], config["thresholds"]
    missing: list[str] = []
    pcts = [number(s.get("change_pct")) for s in stocks]
    pcts = [x for x in pcts if x is not None]
    amounts = [number(s.get("amount")) for s in stocks]
    amounts = [x for x in amounts if x is not None]
    limits = sum(x >= t["limit_up_pct"] for x in pcts)
    high = sum(x >= t["high_gain_pct"] for x in pcts)
    twenty = sum(x >= t["twenty_pct_limit"] for x in pcts)
    if not pcts: missing.append("stock.change_pct")
    if not amounts: missing.append("stock.amount")
    breadth = min(w["breadth"], round(w["breadth"] * min(limits / 5, 1))) if pcts else 0
    structure_count = sum(bool(x) for x in role_structure(stocks).values())
    structure = min(w["structure"], round(w["structure"] * structure_count / 7)) if pcts or amounts else 0
    active_days = number(source.get("active_days"))
    if active_days is None: missing.append("active_days/history")
    continuity = min(w["continuity"], round(w["continuity"] * min((active_days or 0) / 3, 1))) if active_days is not None else 0
    capital = min(w["capital_capacity"], round(w["capital_capacity"] * min(sum(amounts) / (t["large_amount"] * 2), 1))) if amounts else 0
    feedback = source.get("next_day") or source.get("confirmation") or {}
    close_return = number(feedback.get("average_close_pct") if isinstance(feedback, dict) else None)
    if close_return is None: missing.append("next_day.average_close_pct")
    profit = w["profit_effect"] if close_return is not None and close_return > 0 else 0
    resilience_value = number(source.get("resilience_score"))
    if resilience_value is None: missing.append("resilience_score")
    resilience = round(w["resilience"] * max(0, min(resilience_value or 0, 1))) if resilience_value is not None else 0
    details = {"breadth": breadth, "structure": structure, "continuity": continuity,
               "capital_capacity": capital, "profit_effect": profit, "resilience": resilience}
    evidence = {"limit_up_count": limits, "high_gain_count": high, "twenty_pct_limit_count": twenty,
                "total_amount": sum(amounts), "active_days": active_days, "next_day_average_close_pct": close_return,
                "available_change_pct_records": len(pcts), "available_amount_records": len(amounts)}
    return details, evidence, missing


def classify(score: int, stocks: list[dict[str, Any]], evidence: dict[str, Any], missing: list[str], config: dict[str, Any]) -> str:
    t = config["thresholds"]
    if not stocks: return "insufficient_data"
    if len(stocks) == 1: return "independent_stock" if not missing else "insufficient_data"
    # Data needed to call any mainline is intentionally strict.
    critical = {"stock.change_pct", "stock.amount", "active_days/history", "next_day.average_close_pct"}
    if critical.intersection(missing): return "insufficient_data"
    if (score >= t["confirmed_score"] and evidence["active_days"] >= t["min_confirmed_active_days"]
            and evidence["limit_up_count"] >= t["min_confirmed_limit_ups"]
            and evidence["next_day_average_close_pct"] > 0):
        return "confirmed_mainline"
    if score >= t["candidate_score"]: return "candidate_mainline"
    if score >= t["strong_branch_score"]: return "strong_branch"
    return "rotation_theme"


def build_result(raw: dict[str, Any], date: str, config: dict[str, Any], inherited_warnings: list[str]) -> dict[str, Any]:
    stocks = raw.get("limit_ups") or raw.get("stocks") or []
    groups, uncertain = stock_theme_mappings(stocks if isinstance(stocks, list) else [])
    themes = []
    for name, members in groups.items():
        details, evidence, missing = score_theme(members, raw, config)
        score = sum(details.values())
        status = classify(score, members, evidence, missing, config)
        structure = role_structure(members)
        theme_stocks = []
        for s in members:
            role = "leader" if str(s.get("code", "")) in structure["leader"] else "follow_up"
            theme_stocks.append({"code": str(s.get("code", "")), "name": str(s.get("name", "")), "role": role,
                                 "theme_reason": first_text(s.get("theme_reason"), s.get("limit_reason")),
                                 "evidence": s.get("evidence", []), "mapping_confidence": 1.0 if s.get("_primary") else 0.8})
        conclusion = "Insufficient evidence for a defensible classification." if status == "insufficient_data" else "Score is based only on supplied same-day and follow-up evidence."
        themes.append({"name": name, "status": status, "score": score, "rank": 0,
                       "active_days": evidence["active_days"] or 0, "limit_up_count": evidence["limit_up_count"],
                       "high_gain_count": evidence["high_gain_count"], "twenty_pct_limit_count": evidence["twenty_pct_limit_count"],
                       "failed_limit_count": 0, "total_amount": evidence["total_amount"], "score_details": details,
                       "scoring_evidence": evidence, "structure": structure, "stocks": theme_stocks,
                       "confirmation": {"same_day_result": "evaluated", "next_day_result": "positive" if evidence["next_day_average_close_pct"] and evidence["next_day_average_close_pct"] > 0 else "insufficient_data",
                                        "third_day_result": "insufficient_data", "positive_signals": [], "negative_signals": [], "missing_data": missing},
                       "conclusion_reason": conclusion})
    themes.sort(key=lambda x: x["score"], reverse=True)
    for rank, theme in enumerate(themes, 1): theme["rank"] = rank
    market = raw.get("market_summary") if isinstance(raw.get("market_summary"), dict) else {}
    result = {"version": "1.0", "date": str(raw.get("date") or date),
              "market_summary": {"total_limit_up": market.get("total_limit_up", len(stocks)), "total_limit_down": market.get("total_limit_down", 0),
                                 "market_amount": market.get("market_amount", 0), "market_environment": market.get("market_environment", "neutral"),
                                 "highest_consecutive_limit": market.get("highest_consecutive_limit", 0)},
              "themes": themes,
              "mainline": {"confirmed": [x["name"] for x in themes if x["status"] == "confirmed_mainline"],
                           "candidates": [x["name"] for x in themes if x["status"] == "candidate_mainline"],
                           "strong_branches": [x["name"] for x in themes if x["status"] == "strong_branch"]},
              "warnings": inherited_warnings + ([{"uncertain_mappings": uncertain}] if uncertain else [])}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--input", required=True, help="directory containing normalized JSON or daily_themes")
    parser.add_argument("--output", required=True, help="output JSON path")
    parser.add_argument("--config", help="optional JSON overrides for scoring weights and thresholds")
    args = parser.parse_args()
    try: datetime.strptime(args.date, "%Y-%m-%d")
    except ValueError as exc: raise SystemExit("--date must be YYYY-MM-DD") from exc
    raw, warnings = resolve_input(Path(args.input), args.date)
    result = build_result(raw, args.date, load_config(args.config), warnings)
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
