import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from uptrend_score import available_snapshot_files, load_config, score_daily_bars, score_input


def bars(direction=0.004, count=60):
    closes = [10.0]
    for index in range(1, count):
        # Include ordinary counter-trend days so volume comparison is a
        # complete input, rather than manufacturing an all-up sequence.
        fluctuation = -0.01 if index % 7 == 0 else (0.006 if index % 11 == 0 else 0.002)
        closes.append(closes[-1] * (1 + direction + fluctuation))
    return pd.DataFrame({
        "date": pd.bdate_range("2026-01-02", periods=count), "code": ["600001"] * count,
        "open": closes, "high": [value * 1.01 for value in closes], "low": [value * .99 for value in closes],
        "close": closes, "pre_close": [closes[0]] + closes[:-1], "volume": [1_000_000 + index * 10_000 for index in range(count)],
    })


class UptrendScoreTests(unittest.TestCase):
    def test_configured_component_weights_sum_to_one_hundred(self):
        config = load_config()
        weights = config["weights"]
        self.assertEqual(sum(weights["ma"].values()), 25)
        self.assertEqual(weights["structure"]["higher_lows"] + weights["structure"]["higher_highs"] + weights["structure"]["recent_high"], 25)
        self.assertEqual(sum(weights["persistence"].values()), 20)
        self.assertEqual(weights["stability"]["max_drawdown"] + weights["stability"]["max_daily_loss"] + weights["stability"]["ma10_recovery"] + weights["stability"]["ma20_hold"], 20)
        self.assertEqual(weights["volume"]["up_down_ratio"] + weights["volume"]["downside_pressure"], 10)

    def test_persistent_uptrend_scores_higher_than_downtrend(self):
        config = load_config()
        up = score_daily_bars(bars(.005), code="600001", name="上升样本", as_of_date="2026-03-26", config=config)
        down = score_daily_bars(bars(-.003), code="600001", name="下降样本", as_of_date="2026-03-26", config=config)
        self.assertGreater(up["trend_score"], down["trend_score"])
        self.assertGreaterEqual(up["ma_score"], 18)
        self.assertIsNotNone(up["evidence"]["structure"])

    def test_as_of_date_does_not_use_future_bars(self):
        config = load_config()
        source = bars(.002)
        source["turnover_rate"] = 2.0
        cutoff = str(source.date.iloc[39].date())
        baseline = score_daily_bars(source, code="600001", as_of_date=cutoff, config=config)
        future = source.copy()
        future.loc[40:, ["open", "high", "low", "close"]] *= 4
        future.loc[40:, "turnover_rate"] = 100.0
        self.assertEqual(baseline, score_daily_bars(future, code="600001", as_of_date=cutoff, config=config))

    def test_missing_volume_is_marked_not_imputed(self):
        source = bars(.003).drop(columns=["volume"])
        result = score_daily_bars(source, code="600001", as_of_date="2026-03-26", config=load_config())
        self.assertIsNone(result["trend_score"])
        self.assertIn("volume", result["missing_data"])

    def test_batch_input_is_ranked_by_total_score(self):
        source = pd.concat([bars(.005), bars(-.003).assign(code="600002")], ignore_index=True)
        rows = score_input(source, "2026-03-26", config=load_config())
        self.assertEqual([row["code"] for row in rows], ["600001", "600002"])

    def test_recent_upper_wicks_are_penalized_more_when_turnover_expands(self):
        config = load_config()
        calm = bars(.003)
        calm["turnover_rate"] = 2.0
        wick = calm.copy()
        # The final three observed bars are all above the configured 35% wick
        # threshold.  Their closing prices remain unchanged so only the new
        # risk rule explains the difference.
        for index in wick.index[-3:]:
            wick.loc[index, "high"] = wick.loc[index, "close"] * 1.10
        quiet_wick = score_daily_bars(wick, code="600001", as_of_date="2026-03-26", config=config)
        active_wick = wick.copy()
        active_wick.loc[active_wick.index[-3:], "turnover_rate"] = 4.0
        active = score_daily_bars(active_wick, code="600001", as_of_date="2026-03-26", config=config)
        baseline = score_daily_bars(calm, code="600001", as_of_date="2026-03-26", config=config)
        self.assertGreater(quiet_wick["upper_shadow_penalty"], 0)
        self.assertGreater(active["upper_shadow_penalty"], quiet_wick["upper_shadow_penalty"])
        self.assertLess(active["trend_score"], quiet_wick["trend_score"])
        self.assertLess(quiet_wick["trend_score"], baseline["trend_score"])
        self.assertEqual(len(active["evidence"]["upper_shadow"]["observations"]), 3)

    def test_explicit_trading_window_uses_only_the_audited_dates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / "5分钟数据" / "2026" / f"{date.replace('-', '')}.parquet" for date in ["2026-01-02", "2026-01-05"]]
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            selected = available_snapshot_files(root, "2026-01-05", 2, ["2026-01-02", "2026-01-05"])
            self.assertEqual(selected, paths)
            with self.assertRaises(ValueError):
                available_snapshot_files(root, "2026-01-05", 2, ["2026-01-05", "2026-01-02"])


if __name__ == "__main__":
    unittest.main()
