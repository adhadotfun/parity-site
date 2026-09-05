import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forward as f
import unittest
from datetime import date, datetime, timezone


class TestStepBpsFromDividend(unittest.TestCase):
    def test_quarterly_dividend(self):
        self.assertAlmostEqual(f.step_bps_from_dividend(0.25, 230.36), 10.8526, places=3)

    def test_price_zero_returns_none(self):
        self.assertIsNone(f.step_bps_from_dividend(0.25, 0))

    def test_price_none_returns_none(self):
        self.assertIsNone(f.step_bps_from_dividend(0.25, None))

    def test_price_negative_returns_none(self):
        self.assertIsNone(f.step_bps_from_dividend(0.25, -10.0))

    def test_amount_none_returns_none(self):
        self.assertIsNone(f.step_bps_from_dividend(None, 230.36))

    def test_amount_negative_returns_none(self):
        self.assertIsNone(f.step_bps_from_dividend(-1.0, 230.36))

    def test_amount_zero_returns_zero_float(self):
        self.assertEqual(f.step_bps_from_dividend(0, 230.36), 0.0)


class TestStepBpsFromSplit(unittest.TestCase):
    def test_four_for_one_split(self):
        self.assertEqual(f.step_bps_from_split(4, 1), 30000.0)

    def test_ten_for_one_split(self):
        self.assertEqual(f.step_bps_from_split(10, 1), 90000.0)

    def test_one_for_two_reverse_split(self):
        self.assertEqual(f.step_bps_from_split(1, 2), -5000.0)

    def test_zero_from_factor_returns_none(self):
        self.assertIsNone(f.step_bps_from_split(0, 1))

    def test_zero_to_factor_returns_none(self):
        self.assertIsNone(f.step_bps_from_split(1, 0))

    def test_negative_factor_returns_none(self):
        self.assertIsNone(f.step_bps_from_split(-1, 1))

    def test_none_factor_returns_none(self):
        self.assertIsNone(f.step_bps_from_split(None, 1))

    def test_non_numeric_factor_returns_none(self):
        self.assertIsNone(f.step_bps_from_split("a", 1))


class TestStepBpsFromMultipliers(unittest.TestCase):
    def test_known_pair(self):
        m = 10 ** 18
        n = int(1.021486444855206408e18)
        self.assertAlmostEqual(f.step_bps_from_multipliers(m, n), 214.86, places=1)

    def test_equal_multipliers_returns_zero(self):
        m = 10 ** 18
        self.assertEqual(f.step_bps_from_multipliers(m, m), 0.0)

    def test_mult_zero_returns_none(self):
        self.assertIsNone(f.step_bps_from_multipliers(0, 10 ** 18))

    def test_mult_none_returns_none(self):
        self.assertIsNone(f.step_bps_from_multipliers(None, 10 ** 18))

    def test_new_mult_none_returns_none(self):
        self.assertIsNone(f.step_bps_from_multipliers(10 ** 18, None))


class TestFeePpm(unittest.TestCase):
    def test_known_value(self):
        self.assertEqual(f.fee_ppm(214.86), 21486.0)

    def test_none_returns_none(self):
        self.assertIsNone(f.fee_ppm(None))

    def test_negative_returns_positive(self):
        self.assertEqual(f.fee_ppm(-214.86), 21486.0)

    def test_zero_returns_zero(self):
        self.assertEqual(f.fee_ppm(0), 0)


class TestLeakPer100k(unittest.TestCase):
    def test_known_value(self):
        self.assertAlmostEqual(f.leak_per_100k(214.86), 1074.3, places=1)

    def test_none_returns_none(self):
        self.assertIsNone(f.leak_per_100k(None))

    def test_negative_uses_abs(self):
        self.assertAlmostEqual(f.leak_per_100k(-214.86), 1074.3, places=1)


class TestIsPendingOnchain(unittest.TestCase):
    def test_phantom_case_past_eff_no_divergence(self):
        # Same mult, eff in past -> NOT pending
        m = n = int(1.0000637086201245e18)
        self.assertFalse(f.is_pending_onchain(m, n, 1785769823, now=1788629000))

    def test_real_pending_future_eff_with_divergence(self):
        m = 10 ** 18
        n = int(1.02e18)
        now = 1000000000
        self.assertTrue(f.is_pending_onchain(m, n, now + 86400, now=now))

    def test_already_landed_past_eff(self):
        m = 10 ** 18
        n = int(1.05e18)
        now = 2000000000
        self.assertFalse(f.is_pending_onchain(m, n, now - 86400, now=now))

    def test_divergence_but_eff_zero(self):
        m = 10 ** 18
        n = int(1.02e18)
        now = 1500000000
        self.assertFalse(f.is_pending_onchain(m, n, 0, now=now))

    def test_future_eff_no_divergence(self):
        m = n = int(1.01e18)
        now = 1500000000
        self.assertFalse(f.is_pending_onchain(m, n, now + 86400, now=now))

    def test_mult_none_returns_false(self):
        self.assertFalse(f.is_pending_onchain(None, 10 ** 18, 2000000000, now=1500000000))

    def test_new_mult_none_returns_false(self):
        self.assertFalse(f.is_pending_onchain(10 ** 18, None, 2000000000, now=1500000000))


class TestClassify(unittest.TestCase):
    def test_real_pending_on_chain(self):
        now = 1000000000
        self.assertEqual(
            f.classify(None, mult=10 ** 18, new_mult=int(1.02e18),
                       eff=now + 86400, now=now),
            "ON_CHAIN"
        )

    def test_phantom_past_eff_no_announcement(self):
        now = 1788629000
        self.assertEqual(
            f.classify(None, mult=int(1.0000637086201245e18),
                       new_mult=int(1.0000637086201245e18),
                       eff=1785769823, now=now),
            "CLEAR"
        )

    def test_future_announced_no_chain(self):
        now = 1000000000
        self.assertEqual(f.classify(now + 86400, now=now), "ANNOUNCED_ONLY")

    def test_past_announced_no_chain(self):
        now = 2000000000
        self.assertEqual(f.classify(now - 86400, now=now), "CLEAR")

    def test_on_chain_pending_wins_over_future_announced(self):
        now = 1000000000
        self.assertEqual(
            f.classify(now + 86400, mult=10 ** 18, new_mult=int(1.02e18),
                       eff=now + 172800, now=now),
            "ON_CHAIN"
        )

    def test_all_returns_in_states(self):
        # Spot-check several scenarios; every return must be in f.STATES
        now = 1000000000
        scenarios = [
            (None, None, None, None, now),
            (now + 86400, None, None, None, now),
            (now - 86400, None, None, None, now),
            (None, 10 ** 18, int(1.02e18), now + 86400, now),
        ]
        for ann, m, n, eff, nw in scenarios:
            self.assertIn(f.classify(ann, mult=m, new_mult=n, eff=eff, now=nw), f.STATES)


class TestLeadDays(unittest.TestCase):
    def test_one_day_in_future(self):
        now = 1000000000
        self.assertEqual(f.lead_days(now + 86400, now=now), 1.0)

    def test_past_ts_negative(self):
        now = 2000000000
        self.assertLess(f.lead_days(now - 86400, now=now), 0)

    def test_none_returns_none(self):
        self.assertIsNone(f.lead_days(None))


class TestCadenceDays(unittest.TestCase):
    def test_quarterly_about_91(self):
        dates = [date(2024, 1, 15), date(2024, 4, 15),
                 date(2024, 7, 15), date(2024, 10, 15)]
        result = f.cadence_days(dates)
        self.assertIsNotNone(result)
        self.assertAlmostEqual(result, 91, delta=3)

    def test_two_dates_returns_none(self):
        self.assertIsNone(f.cadence_days([date(2024, 1, 1), date(2024, 4, 1)]))

    def test_empty_list_returns_none(self):
        self.assertIsNone(f.cadence_days([]))

    def test_identical_dates_returns_none(self):
        self.assertIsNone(f.cadence_days([date(2024, 1, 1)] * 4))


class TestParseAndToTs(unittest.TestCase):
    def test_parse_iso_date(self):
        self.assertEqual(f._parse_date("2026-09-10"), date(2026, 9, 10))

    def test_parse_garbage_returns_none(self):
        self.assertIsNone(f._parse_date("not a date"))

    def test_parse_none_returns_none(self):
        self.assertIsNone(f._parse_date(None))

    def test_to_ts_none_returns_none(self):
        self.assertIsNone(f._to_ts(None))

    def test_to_ts_round_trip(self):
        d = date(2026, 9, 10)
        ts = f._to_ts(d)
        self.assertIsInstance(ts, int)
        self.assertGreater(ts, 0)
        self.assertEqual(datetime.utcfromtimestamp(ts).date(), d)


class TestConstants(unittest.TestCase):
    def test_bps_to_ppm(self):
        self.assertEqual(f.BPS_TO_PPM, 100)

    def test_split_bps(self):
        self.assertEqual(f.SPLIT_BPS, 500)

    def test_states_count(self):
        self.assertEqual(len(f.STATES), 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
