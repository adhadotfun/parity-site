"""Backtest: every real corporate action these 23 tokens have already lived through.

The proof table has three scenarios. Three is enough to show the mechanism
works and nowhere near enough to answer the question an LP actually asks:

    how often does this happen to me, and what does a year of it cost?

Every one of these tickers has a public corporate action history going back
years. Each past ex-date and each past split is a discontinuity that WOULD
have hit a pool, had the pool existed. So replay them: pull the actual close
on the actual ex-date, compute the actual multiplier step, and price it.

The output is not a simulation of a hypothetical. It is an arithmetic replay
of events that really happened, on the equities that really back these tokens.

Honesty rules, same as the forward book:
  * Every event is a real published ex-date or split. Nothing is invented.
  * Prices are the real close on that date. Where the close is missing, the
    event is counted but its cost is left null rather than guessed.
  * Cost is per $100k of pool depth, because there is still no pool.
  * The recovery figure uses the SAME 20% surcharge ceiling as the proof
    table, which is why splits recover partially and dividends recover fully.
    Claiming full recovery on a split would contradict our own limits page.
"""

import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, "/data/workspace/skills/twelvedata")

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY = os.path.join(HERE, "registry.json")
OUT = os.path.join(HERE, "backtest.json")
PRICE_CACHE = os.path.join(HERE, ".backtest_prices.json")

LOOKBACK_DAYS = 1100          # ~3 years
DEPTH = 100000.0              # notional pool depth the costs are quoted against
FEE_CEILING_PPM = 200000      # 20%, the surcharge clamp from the proof table
BPS_TO_PPM = 100
SPLIT_BPS = 500               # above this a step is a split, not a distribution


# ---------------------------------------------------------------- math ----

def step_bps(amount, price):
    """Multiplier step a cash distribution produces, in bps."""
    if not price or price <= 0 or amount is None or amount < 0:
        return None
    return (amount / price) * 10000.0


def split_bps(from_factor, to_factor):
    """Multiplier step a split produces, in bps."""
    try:
        f, t = float(from_factor), float(to_factor)
    except (TypeError, ValueError):
        return None
    if f <= 0 or t <= 0:
        return None
    return (f / t - 1.0) * 10000.0


def unguarded_leak(bps, depth=DEPTH):
    """Value that leaves the pool to the arber, first order.

    Half the pool is the rebasing leg, so the transfer scales with
    depth/2 x step. Same first-order estimate the forward book quotes, kept
    identical on purpose: two different numbers for the same quantity on one
    site is worse than one imperfect number.
    """
    if bps is None:
        return None
    return depth / 2.0 * (abs(bps) / 10000.0)


def guard_recovery(bps, depth=DEPTH, ceiling_ppm=FEE_CEILING_PPM):
    """What the surcharge actually claws back, ceiling included.

    The fee the guard WANTS to charge is the full step. Above the 20% clamp
    it cannot, which is exactly why the proof table says a 4-for-1 recovers
    only 45%. Modelling the ceiling is the difference between a backtest and
    a brochure.
    """
    if bps is None:
        return None
    leak = unguarded_leak(bps, depth)
    wanted_ppm = abs(bps) * BPS_TO_PPM
    applied_ppm = min(wanted_ppm, ceiling_ppm)
    if wanted_ppm <= 0:
        return 0.0
    return leak * (applied_ppm / wanted_ppm)


def classify_event(bps):
    return "split" if (bps is not None and abs(bps) > SPLIT_BPS) else "dividend"


def _parse_date(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------- sources ----

def _get_retry(endpoint, params, tries=3):
    import exports
    last = None
    for i in range(tries):
        try:
            return exports._get(endpoint, params)
        except Exception as e:
            last = e
            msg = str(e).lower()
            time.sleep((4.0 if "rate limit" in msg or "429" in msg else 0.6) * (i + 1))
    raise last


def load_price_series(symbol, cache):
    """Daily closes for one symbol, keyed by ISO date.

    Cached on disk: historical closes never change, so re-fetching them on
    every run is pure waste and the exact behaviour that tripped the upstream
    rate limiter while the forward book was being built.
    """
    key = f"px:{symbol}"
    if key in cache:
        return cache[key]
    r = _get_retry("time_series", {
        "symbol": symbol,
        "interval": "1day",
        "outputsize": 5000,
        "start_date": str(date.today() - timedelta(days=LOOKBACK_DAYS)),
        "end_date": str(date.today()),
    })
    series = {}
    for v in (r.get("values") or []):
        d = _parse_date(v.get("datetime"))
        try:
            c = float(v.get("close"))
        except (TypeError, ValueError):
            continue
        if d:
            series[str(d)] = c
    cache[key] = series
    return series


def close_on_or_before(series, iso_day, max_back=6):
    """Close on the ex-date, or the last session before it.

    Ex-dates land on holidays and weekends. Walking back a few sessions is
    correct; inventing a price is not, so this gives up after a week.
    """
    d = _parse_date(iso_day)
    if not d or not series:
        return None
    for i in range(max_back + 1):
        got = series.get(str(d - timedelta(days=i)))
        if got:
            return got
    return None


def fetch_actions(symbol, cache):
    """Past dividends and splits for one symbol, from cache when possible."""
    today = date.today()
    start = today - timedelta(days=LOOKBACK_DAYS)
    out = {"dividends": [], "splits": []}

    dk, sk = f"div:{symbol}", f"spl:{symbol}"
    if dk in cache:
        out["dividends"] = cache[dk]
    else:
        r = _get_retry("dividends", {"symbol": symbol,
                                     "start_date": str(start),
                                     "end_date": str(today)})
        out["dividends"] = [
            {"ex_date": str(_parse_date(d.get("ex_date"))), "amount": d.get("amount")}
            for d in (r.get("dividends") or []) if _parse_date(d.get("ex_date"))
        ]
        cache[dk] = out["dividends"]

    if sk in cache:
        out["splits"] = cache[sk]
    else:
        r = _get_retry("splits", {"symbol": symbol,
                                  "start_date": str(start),
                                  "end_date": str(today)})
        out["splits"] = [
            {"date": str(_parse_date(s.get("date"))),
             "from_factor": s.get("from_factor"), "to_factor": s.get("to_factor"),
             "description": s.get("description")}
            for s in (r.get("splits") or []) if _parse_date(s.get("date"))
        ]
        cache[sk] = out["splits"]

    return out


# --------------------------------------------------------------- build ----

def build_events(ticker, name, actions, series):
    """Replay one ticker's history into priced events."""
    evs = []

    for d in actions["dividends"]:
        px = close_on_or_before(series, d["ex_date"])
        b = step_bps(d.get("amount"), px)
        evs.append({
            "ticker": ticker, "name": name, "kind": "dividend",
            "date": d["ex_date"], "detail": f"${d.get('amount')} per share",
            "px": px, "bps": b,
            "leak": unguarded_leak(b), "recovered": guard_recovery(b),
            "priced": b is not None,
        })

    for s in actions["splits"]:
        b = split_bps(s.get("from_factor"), s.get("to_factor"))
        evs.append({
            "ticker": ticker, "name": name, "kind": "split",
            "date": s["date"], "detail": s.get("description") or "split",
            "px": close_on_or_before(series, s["date"]), "bps": b,
            "leak": unguarded_leak(b), "recovered": guard_recovery(b),
            "priced": b is not None,
        })

    return evs


def summarise(events):
    priced = [e for e in events if e["priced"]]
    leak = sum(e["leak"] for e in priced)
    rec = sum(e["recovered"] for e in priced)

    by_year = defaultdict(lambda: {"events": 0, "leak": 0.0, "recovered": 0.0})
    for e in priced:
        y = e["date"][:4]
        by_year[y]["events"] += 1
        by_year[y]["leak"] += e["leak"]
        by_year[y]["recovered"] += e["recovered"]

    years = sorted(by_year)
    splits = [e for e in priced if e["kind"] == "split"]
    divs = [e for e in priced if e["kind"] == "dividend"]

    # One 10-for-1 split can be 99% of three years of leak, which makes a
    # single blended recovery rate useless in both directions: quote it alone
    # and the mechanism looks broken, hide it and the mechanism looks perfect.
    # So report both populations separately and let the reader see the tail.
    d_leak = sum(e["leak"] for e in divs)
    d_rec = sum(e["recovered"] for e in divs)
    s_leak = sum(e["leak"] for e in splits)
    s_rec = sum(e["recovered"] for e in splits)

    return {
        "dividendLeak": round(d_leak, 2),
        "dividendRecovered": round(d_rec, 2),
        "dividendRecoveryRate": round(d_rec / d_leak * 100, 1) if d_leak else None,
        "splitLeak": round(s_leak, 2),
        "splitRecovered": round(s_rec, 2),
        "splitRecoveryRate": round(s_rec / s_leak * 100, 1) if s_leak else None,
        "events": len(events),
        "pricedEvents": len(priced),
        "unpriced": len(events) - len(priced),
        "dividends": len(divs),
        "splits": len(splits),
        "totalLeak": round(leak, 2),
        "totalRecovered": round(rec, 2),
        "recoveryRate": round(rec / leak * 100, 1) if leak else None,
        "worstEvent": max(priced, key=lambda e: e["leak"])["ticker"] if priced else None,
        "worstLeak": round(max(e["leak"] for e in priced), 2) if priced else None,
        "medianDividendBps": round(sorted(e["bps"] for e in divs)[len(divs) // 2], 2)
                             if divs else None,
        "byYear": {y: {"events": v["events"],
                       "leak": round(v["leak"], 2),
                       "recovered": round(v["recovered"], 2)}
                   for y, v in ((y, by_year[y]) for y in years)},
    }


def main():
    reg = json.load(open(REGISTRY))
    tokens = reg["tokens"]

    try:
        cache = json.load(open(PRICE_CACHE))
    except Exception:
        cache = {}

    events, degraded = [], []
    for t in tokens:
        sym = t["ticker"]
        try:
            actions = fetch_actions(sym, cache)
            series = load_price_series(sym, cache)
            events.extend(build_events(sym, t.get("name"), actions, series))
        except Exception as e:
            degraded.append(f"{sym}: {str(e)[:70]}")
        time.sleep(0.1)

    try:
        json.dump(cache, open(PRICE_CACHE, "w"))
    except Exception:
        pass

    events.sort(key=lambda e: (e["date"], e["ticker"]), reverse=True)
    summary = summarise(events)

    out = {
        "generatedAt": int(time.time()),
        "lookbackDays": LOOKBACK_DAYS,
        "depth": DEPTH,
        "feeCeilingPpm": FEE_CEILING_PPM,
        "summary": summary,
        "degraded": degraded,
        # Full list is long and the page only shows the biggest. Keep the top
        # 40 by leak plus everything from the last 12 months.
        "top": sorted([e for e in events if e["priced"]],
                      key=lambda e: e["leak"], reverse=True)[:40],
        "recent": [e for e in events
                   if e["date"] >= str(date.today() - timedelta(days=365))][:60],
    }
    json.dump(out, open(OUT, "w"), indent=1)

    s = summary
    print(f"backtest.json: {s['events']} events across {len(tokens)} tokens "
          f"({s['dividends']} dividends, {s['splits']} splits, {s['unpriced']} unpriced)")
    print(f"  unguarded leak  ${s['totalLeak']:,.2f} per $100k of depth")
    print(f"  guard recovers  ${s['totalRecovered']:,.2f}  ({s['recoveryRate']}%)")
    print(f"  worst single    {s['worstEvent']} ${s['worstLeak']:,.2f}")
    print(f"  median dividend {s['medianDividendBps']} bps")
    for y, v in s["byYear"].items():
        print(f"    {y}: {v['events']:3} events  leak ${v['leak']:>10,.2f}  "
              f"recovered ${v['recovered']:>10,.2f}")
    if degraded:
        print(f"  DEGRADED: {'; '.join(degraded)}")
    return out


if __name__ == "__main__":
    main()
