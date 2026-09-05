"""Tests for the corporate action backtest.

The point of contention is guard_recovery. Everything else is arithmetic;
that function is where the 20% surcharge ceiling either gets modelled or
gets quietly dropped, and dropping it would make the site claim full
recovery on splits. Most of these tests exist to make that impossible.
"""

import sys
import os
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest as b


def ev(ticker="AAA", kind="dividend", day="2025-01-15", leak=100.0,
       recovered=100.0, bps=10.0, priced=True):
    return {"ticker": ticker, "name": ticker, "kind": kind, "date": day,
            "detail": "x", "px": 100.0, "bps": bps, "leak": leak,
            "recovered": recovered, "priced": priced}


class TestStepBps(unittest.TestCase):
    def test_real_dividend(self):
        self.assertAlmostEqual(b.step_bps(0.25, 230.36), 10.8526, places=3)

    def test_zero_amount_is_zero_not_none(self):
        self.assertEqual(b.step_bps(0, 100.0), 0.0)

    def test_scales_with_amount(self):
        self.assertAlmostEqual(b.step_bps(2.0, 100.0), 2 * b.step_bps(1.0, 100.0))

    def test_price_zero(self):
        self.assertIsNone(b.step_bps(1.0, 0))

    def test_price_none(self):
        self.assertIsNone(b.step_bps(1.0, None))

    def test_price_negative(self):
        self.assertIsNone(b.step_bps(1.0, -5.0))

    def test_amount_none(self):
        self.assertIsNone(b.step_bps(None, 100.0))

    def test_amount_negative(self):
        self.assertIsNone(b.step_bps(-1.0, 100.0))


class TestSplitBps(unittest.TestCase):
    def test_four_for_one(self):
        self.assertEqual(b.split_bps(4, 1), 30000.0)

    def test_ten_for_one(self):
        self.assertEqual(b.split_bps(10, 1), 90000.0)

    def test_reverse_split_is_negative(self):
        self.assertEqual(b.split_bps(1, 2), -5000.0)

    def test_one_for_one_is_zero(self):
        self.assertEqual(b.split_bps(1, 1), 0.0)

    def test_zero_factor(self):
        self.assertIsNone(b.split_bps(0, 1))
        self.assertIsNone(b.split_bps(1, 0))

    def test_negative_factor(self):
        self.assertIsNone(b.split_bps(-4, 1))

    def test_none_and_garbage(self):
        self.assertIsNone(b.split_bps(None, 1))
        self.assertIsNone(b.split_bps("abc", 1))


class TestUnguardedLeak(unittest.TestCase):
    def test_known_value(self):
        self.assertAlmostEqual(b.unguarded_leak(214.86), 1074.3, places=1)

    def test_none(self):
        self.assertIsNone(b.unguarded_leak(None))

    def test_negative_bps_gives_positive_leak(self):
        self.assertGreater(b.unguarded_leak(-500.0), 0)

    def test_sign_symmetry(self):
        self.assertEqual(b.unguarded_leak(-500.0), b.unguarded_leak(500.0))

    def test_depth_scales_linearly(self):
        self.assertAlmostEqual(b.unguarded_leak(100.0, 200000.0),
                               2 * b.unguarded_leak(100.0, 100000.0), places=9)


class TestGuardRecovery(unittest.TestCase):
    """The ceiling is the whole argument. These tests defend it."""

    def test_small_dividend_recovers_fully(self):
        # wanted_ppm = 1085, far below the 200000 clamp
        self.assertAlmostEqual(b.guard_recovery(10.85),
                               b.unguarded_leak(10.85), places=6)

    def test_big_split_does_not_recover_fully(self):
        self.assertLess(b.guard_recovery(90000.0), b.unguarded_leak(90000.0))

    def test_big_split_ratio_is_the_ceiling_ratio(self):
        ratio = b.guard_recovery(90000.0) / b.unguarded_leak(90000.0)
        self.assertAlmostEqual(ratio, 200000.0 / 9000000.0, places=6)

    def test_exactly_at_ceiling_recovers_fully(self):
        # bps 2000 -> wanted_ppm 200000 == FEE_CEILING_PPM
        self.assertAlmostEqual(b.guard_recovery(2000.0),
                               b.unguarded_leak(2000.0), places=6)

    def test_just_above_ceiling_is_clamped(self):
        self.assertLess(b.guard_recovery(2001.0), b.unguarded_leak(2001.0))

    def test_zero_bps_is_zero_not_error(self):
        self.assertEqual(b.guard_recovery(0), 0.0)

    def test_none(self):
        self.assertIsNone(b.guard_recovery(None))

    def test_never_exceeds_leak(self):
        for bps in (1, 10, 100, 1000, 2000, 5000, 30000, 90000):
            self.assertLessEqual(b.guard_recovery(float(bps)),
                                 b.unguarded_leak(float(bps)) + 1e-9,
                                 msg=f"recovery beat leak at {bps} bps")

    def test_recovery_is_monotone_in_depth(self):
        self.assertGreater(b.guard_recovery(90000.0, 200000.0),
                           b.guard_recovery(90000.0, 100000.0))


class TestClassify(unittest.TestCase):
    def test_split(self):
        self.assertEqual(b.classify_event(90000.0), "split")

    def test_dividend(self):
        self.assertEqual(b.classify_event(10.85), "dividend")

    def test_boundary_is_dividend(self):
        self.assertEqual(b.classify_event(500.0), "dividend")

    def test_just_over_boundary_is_split(self):
        self.assertEqual(b.classify_event(501.0), "split")

    def test_none_is_dividend(self):
        self.assertEqual(b.classify_event(None), "dividend")


class TestCloseLookup(unittest.TestCase):
    S = {"2025-01-10": 100.0, "2025-01-13": 105.0}

    def test_exact_hit(self):
        self.assertEqual(b.close_on_or_before(self.S, "2025-01-13"), 105.0)

    def test_walks_back_over_weekend(self):
        # 11th and 12th are a weekend, should fall back to the 10th
        self.assertEqual(b.close_on_or_before(self.S, "2025-01-12"), 100.0)

    def test_gives_up_past_max_back(self):
        self.assertIsNone(b.close_on_or_before({"2025-01-01": 9.0},
                                               "2025-01-08", max_back=6))

    def test_empty_series(self):
        self.assertIsNone(b.close_on_or_before({}, "2025-01-13"))

    def test_bad_date(self):
        self.assertIsNone(b.close_on_or_before(self.S, "not-a-date"))


class TestParseDate(unittest.TestCase):
    def test_good(self):
        self.assertEqual(b._parse_date("2026-09-10"), date(2026, 9, 10))

    def test_garbage(self):
        self.assertIsNone(b._parse_date("hello"))

    def test_none(self):
        self.assertIsNone(b._parse_date(None))


class TestSummarise(unittest.TestCase):
    def setUp(self):
        # Two dividends recovering fully, one split recovering a quarter,
        # one unpriced event that must be ignored everywhere.
        self.events = [
            ev("AAA", "dividend", "2024-03-01", 100.0, 100.0),
            ev("BBB", "dividend", "2025-06-01", 300.0, 300.0),
            ev("CCC", "split", "2025-07-01", 4000.0, 1000.0, bps=90000.0),
            ev("DDD", "dividend", "2025-08-01", 0.0, 0.0, priced=False),
        ]
        self.s = b.summarise(self.events)

    def test_counts(self):
        self.assertEqual(self.s["events"], 4)
        self.assertEqual(self.s["pricedEvents"], 3)
        self.assertEqual(self.s["unpriced"], 1)

    def test_kind_counts_exclude_unpriced(self):
        self.assertEqual(self.s["dividends"], 2)
        self.assertEqual(self.s["splits"], 1)

    def test_totals_sum_priced_only(self):
        self.assertAlmostEqual(self.s["totalLeak"], 4400.0)
        self.assertAlmostEqual(self.s["totalRecovered"], 1400.0)

    def test_blended_rate(self):
        self.assertAlmostEqual(self.s["recoveryRate"], round(1400 / 4400 * 100, 1))

    def test_dividend_and_split_rates_are_separate(self):
        self.assertAlmostEqual(self.s["dividendRecoveryRate"], 100.0)
        self.assertAlmostEqual(self.s["splitRecoveryRate"], 25.0)
        self.assertNotEqual(self.s["dividendRecoveryRate"],
                            self.s["splitRecoveryRate"])

    def test_blended_rate_sits_between_the_two(self):
        self.assertLess(self.s["recoveryRate"], self.s["dividendRecoveryRate"])
        self.assertGreater(self.s["recoveryRate"], self.s["splitRecoveryRate"])

    def test_by_year_buckets(self):
        self.assertEqual(set(self.s["byYear"]), {"2024", "2025"})
        self.assertEqual(self.s["byYear"]["2024"]["events"], 1)
        self.assertEqual(self.s["byYear"]["2025"]["events"], 2)

    def test_worst_event(self):
        self.assertEqual(self.s["worstEvent"], "CCC")
        self.assertAlmostEqual(self.s["worstLeak"], 4000.0)

    def test_empty_input(self):
        s = b.summarise([])
        self.assertEqual(s["events"], 0)
        self.assertIsNone(s["recoveryRate"])
        self.assertIsNone(s["worstEvent"])

    def test_all_unpriced(self):
        s = b.summarise([ev(priced=False), ev(priced=False)])
        self.assertEqual(s["events"], 2)
        self.assertEqual(s["pricedEvents"], 0)
        self.assertIsNone(s["recoveryRate"])


class TestConstants(unittest.TestCase):
    def test_values(self):
        self.assertEqual(b.LOOKBACK_DAYS, 1100)
        self.assertEqual(b.DEPTH, 100000.0)
        self.assertEqual(b.FEE_CEILING_PPM, 200000)
        self.assertEqual(b.BPS_TO_PPM, 100)
        self.assertEqual(b.SPLIT_BPS, 500)

    def test_ceiling_matches_proof_table_20_percent(self):
        self.assertAlmostEqual(b.FEE_CEILING_PPM / 1000000.0, 0.20)


if __name__ == "__main__":
    unittest.main(verbosity=2)
