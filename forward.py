"""Forward Book: the half of the thesis the site never shipped.

The board is reactive. It reads the chain and tells you what the multiplier IS.
But the whole pitch is that corporate actions are ANNOUNCED BEFORE THEY LAND,
on a calendar Nasdaq has published for a century. If that is true, then the
interesting question is not "what is the multiplier" but:

    is there an action already announced off-chain that the chain
    has not scheduled yet, and how long is the lead?

That gap is the alpha. It is the window in which an LP can still act, a keeper
can still wake up, and a guard can still be armed. Once effectiveAt() is set,
everyone can see it. Before that, only the issuer's press release exists.

So this pulls the announced calendar (TwelveData, sourced from the issuer),
reads effectiveAt()/newUIMultiplier() on chain 4663, and classifies every
tokenized equity into one of four states. For anything inbound it prices the
discontinuity: the multiplier step in bps, and the fee the guard would quote.

Honesty rules, because the site's credibility rests on them:
  * ANNOUNCED means a real published ex-date. Never inferred.
  * PROJECTED means we guessed from historical cadence. Always badged, never
    counted as a call, never written to the track record.
  * The cost line is "per $100k of pool depth" because there is no pool yet.
    Quoting a dollar loss on a pool that does not exist would be a lie.
"""

import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, "/data/workspace/skills/twelvedata")
sys.path.insert(0, "/data/workspace/output/rhrisk")

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY = os.path.join(HERE, "registry.json")
OUT = os.path.join(HERE, "forward.json")

ONE = 10 ** 18

# A cash distribution on a total-return token raises uiMultiplier by
# amount/price. A split raises it by the split ratio. Both are the same
# discontinuity to a pool: price moves in one block with no trade behind it.
#
# The guard quotes a fee equal to that discontinuity, which is where
# ppm = bps * 100 comes from. Verified against the CCL event already on the
# board: a 214.86 bps step produced a 21486 ppm quote.
BPS_TO_PPM = 100

# Above this the step is a split, not a distribution. Same threshold the
# scanner uses (engine.assess), kept in sync deliberately.
SPLIT_BPS = 500

STATES = ("ON_CHAIN", "ANNOUNCED_ONLY", "PROJECTED", "CLEAR", "UNKNOWN")


# ---------------------------------------------------------------- math ----

def step_bps_from_dividend(amount, price):
    """Multiplier step a cash distribution produces, in bps.

    A $0.25 dividend on a $230 share moves the multiplier 10.85 bps. That is
    small, and small is the point: it is under every alert threshold a human
    would set, and it still transfers real value out of the pool.
    """
    if not price or price <= 0 or amount is None or amount < 0:
        return None
    return (amount / price) * 10000.0


def step_bps_from_split(from_factor, to_factor):
    """Multiplier step a split produces, in bps.

    A 4-for-1 split is from_factor=4, to_factor=1: the multiplier quadruples,
    a 30000 bps step. This is the case the auction analysis showed losing by
    $27,956, so it is the one worth showing a number for.
    """
    try:
        f, t = float(from_factor), float(to_factor)
    except (TypeError, ValueError):
        return None
    if f <= 0 or t <= 0:
        return None
    return (f / t - 1.0) * 10000.0


def fee_ppm(bps):
    """Fee the guard quotes to price out the discontinuity."""
    if bps is None:
        return None
    return abs(bps) * BPS_TO_PPM


def leak_per_100k(bps):
    """Value that leaves a pool per $100k of depth, unguarded.

    The arber captures the step against stale reserves. Half the pool is the
    rebasing leg, so the first-order transfer is depth/2 * step. This is a
    first-order estimate and is labelled as one on the site: the exact figure
    depends on curve and tick, which the sim table already covers properly.
    """
    if bps is None:
        return None
    return 100000.0 / 2.0 * (abs(bps) / 10000.0)


def is_pending_onchain(mult, new_mult, eff, now=None):
    """Is a corporate action actually SCHEDULED on chain right now?

    This is the trap that cost me three phantom rows on the first run.
    effectiveAt() is NOT "an action is coming". It is the timestamp of the
    LAST action to land, and it stays populated forever afterwards. DELL,
    AAPL and MU all carry a past effectiveAt with newUIMultiplier equal to
    uiMultiplier: nothing is pending, the multiplier already moved months ago.

    A genuine pending step needs BOTH:
      * newUIMultiplier() diverging from uiMultiplier(), and
      * effectiveAt() in the future.
    Treating either one alone as a schedule invents actions that do not exist.
    """
    now = now if now is not None else int(time.time())
    if not mult or not new_mult:
        return False
    return new_mult != mult and bool(eff) and eff > now


def classify(announced_ts, mult=None, new_mult=None, eff=None, now=None):
    """Which of the four states this token is in.

    On-chain scheduling wins when it is real, because once the chain has
    published the step the information is public and the lead time is gone.
    """
    now = now if now is not None else int(time.time())
    if is_pending_onchain(mult, new_mult, eff, now):
        return "ON_CHAIN"
    if announced_ts and announced_ts >= now:
        return "ANNOUNCED_ONLY"
    return "CLEAR"


def step_bps_from_multipliers(mult, new_mult):
    """Multiplier step the chain itself has already scheduled, in bps.

    Preferred over any off-chain estimate when available: this is the exact
    number the token will step by, not a derivation from price and amount.
    """
    if not mult or not new_mult or mult <= 0:
        return None
    return (new_mult / mult - 1.0) * 10000.0


def lead_days(ts, now=None):
    """Days until the action lands. Negative means it already did."""
    if not ts:
        return None
    now = now if now is not None else int(time.time())
    return (ts - now) / 86400.0


def cadence_days(ex_dates):
    """Median gap between historical ex-dates, for projection.

    Median not mean: one special dividend should not drag the estimate.
    Needs 3 dates to produce 2 gaps, below that a projection is noise.
    """
    ds = sorted(d for d in ex_dates if d)
    if len(ds) < 3:
        return None
    gaps = [(ds[i] - ds[i - 1]).days for i in range(1, len(ds))]
    gaps = [g for g in gaps if g > 0]
    if not gaps:
        return None
    gaps.sort()
    mid = len(gaps) // 2
    return gaps[mid] if len(gaps) % 2 else (gaps[mid - 1] + gaps[mid]) / 2.0


def _parse_date(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _to_ts(d):
    if not d:
        return None
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())


# ------------------------------------------------------------- sources ----

CACHE_FILE = os.path.join(HERE, ".forward_cache.json")

# Past ex-dates and split history are immutable once published, so re-fetching
# them every 15 minutes just burns quota and triggers the rate limiter that
# silently emptied an earlier run. Forward dividends DO change (that is the
# whole point of the tool), so they get a short TTL.
TTL = {"dividends_future": 3600, "history": 30 * 86400, "splits": 7 * 86400}


def _cache_load():
    try:
        return json.load(open(CACHE_FILE))
    except Exception:
        return {}


def _cache_save(c):
    try:
        json.dump(c, open(CACHE_FILE, "w"))
    except Exception:
        pass


def _cached(cache, leg, symbol, fetch):
    """Return cached value if fresh, else fetch and store.

    Raises whatever fetch raises when there is no usable cache entry, so a
    failure still reaches the caller and becomes an UNKNOWN row.
    """
    key = f"{leg}:{symbol}"
    ent = cache.get(key)
    now = int(time.time())
    if ent and (now - ent.get("at", 0)) < TTL.get(leg, 3600):
        return ent["val"]
    val = fetch()
    cache[key] = {"at": now, "val": val}
    return val


def _get_retry(endpoint, params, tries=3):
    """One upstream call, retried on transient failure.

    Raises on final failure. That is deliberate: the caller must be able to
    tell "no action announced" apart from "we could not find out". An earlier
    version swallowed every exception and returned an empty list for both,
    which made a failed fetch render as a confident all-clear. On a site whose
    entire argument is that it tells you uncomfortable truths, that is the
    worst bug available.
    """
    import exports
    last = None
    for i in range(tries):
        try:
            return exports._get(endpoint, params)
        except Exception as e:
            last = e
            msg = str(e).lower()
            # Rate limit: back off hard. Anything else: brief retry.
            time.sleep((4.0 if "rate limit" in msg or "429" in msg else 0.6)
                       * (i + 1))
    raise last


def fetch_announced(symbol, horizon_days=180, cache=None):
    """Announced future actions for one symbol. Hard data only.

    Returns (dividends, splits, history, errors) where history is past
    ex-dates used for cadence and errors is a list of leg names that failed.
    A non-empty errors list means this row's verdict is NOT trustworthy.
    """
    today = date.today()
    end = today + timedelta(days=horizon_days)
    divs, splits, hist, errors = [], [], [], []
    cache = {} if cache is None else cache

    try:
        r = _cached(cache, "dividends_future", symbol, lambda: _get_retry(
            "dividends", {
                "symbol": symbol,
                "start_date": str(today),
                "end_date": str(end),
            }))
        for d in (r.get("dividends") or []):
            ex = _parse_date(d.get("ex_date"))
            if ex and ex >= today:
                divs.append({"ex_date": str(ex), "amount": d.get("amount")})
    except Exception as e:
        errors.append(f"dividends: {str(e)[:80]}")

    try:
        r = _cached(cache, "history", symbol, lambda: _get_retry(
            "dividends", {
                "symbol": symbol,
                "start_date": str(today - timedelta(days=1100)),
                "end_date": str(today),
            }))
        for d in (r.get("dividends") or []):
            ex = _parse_date(d.get("ex_date"))
            if ex:
                hist.append(ex)
    except Exception as e:
        errors.append(f"history: {str(e)[:80]}")

    try:
        r = _cached(cache, "splits", symbol, lambda: _get_retry(
            "splits", {
                "symbol": symbol,
                "start_date": str(today),
                "end_date": str(end),
            }))
        for s in (r.get("splits") or []):
            dt = _parse_date(s.get("date"))
            if dt and dt >= today:
                splits.append({
                    "date": str(dt),
                    "from_factor": s.get("from_factor"),
                    "to_factor": s.get("to_factor"),
                    "description": s.get("description"),
                })
    except Exception as e:
        errors.append(f"splits: {str(e)[:80]}")

    return divs, splits, hist, errors


def read_chain(tokens):
    """effectiveAt()/newUIMultiplier()/uiMultiplier() for every token."""
    import engine
    out = {}
    for t in tokens:
        addr = t.get("addr")
        st = {"uiMultiplier": None, "newUIMultiplier": None, "effectiveAt": None}
        if addr:
            for k in ("uiMultiplier", "newUIMultiplier", "effectiveAt"):
                st[k] = engine.as_int(engine.rpc_call(addr, engine.SEL[k]))
        out[t["ticker"]] = st
    return out


# --------------------------------------------------------------- build ----

def build_row(tok, chain_state, spot_px, announced, projected_ts):
    """One token's forward row. Pure: all IO already done by the caller."""
    ticker = tok["ticker"]
    divs, splits, _hist, errors = announced
    cs = chain_state or {}
    eff = cs.get("effectiveAt")
    mult = cs.get("uiMultiplier")
    new_mult = cs.get("newUIMultiplier")

    action = None
    if splits:
        s = splits[0]
        bps = step_bps_from_split(s.get("from_factor"), s.get("to_factor"))
        action = {
            "kind": "split",
            "date": s["date"],
            "ts": _to_ts(_parse_date(s["date"])),
            "detail": s.get("description") or "split",
            "bps": bps,
        }
    elif divs:
        d = divs[0]
        bps = step_bps_from_dividend(d.get("amount"), spot_px)
        action = {
            "kind": "dividend",
            "date": d["ex_date"],
            "ts": _to_ts(_parse_date(d["ex_date"])),
            "detail": f"${d.get('amount')} per share",
            "bps": bps,
        }

    state = classify(action["ts"] if action else None, mult, new_mult, eff)

    # The chain has scheduled a real step. Its own numbers beat any off-chain
    # estimate: exact size from the multiplier pair, exact date from
    # effectiveAt. Whatever the calendar said is now redundant.
    if state == "ON_CHAIN":
        chain_bps = step_bps_from_multipliers(mult, new_mult)
        action = {
            "kind": "split" if (chain_bps is not None
                                and abs(chain_bps) > SPLIT_BPS) else "dividend",
            "date": datetime.fromtimestamp(eff, timezone.utc).date().isoformat(),
            "ts": eff,
            "detail": "scheduled on chain",
            "bps": chain_bps,
        }

    # No announcement but a regular payer: offer a projection, badged.
    if state == "CLEAR" and projected_ts:
        state = "PROJECTED"
        action = {
            "kind": "dividend",
            "date": datetime.fromtimestamp(projected_ts, timezone.utc)
                            .date().isoformat(),
            "ts": projected_ts,
            "detail": "cadence estimate",
            "bps": None,
        }

    # A failed lookup must never render as a confident all-clear.
    fwd_failed = any(e.startswith(("dividends", "splits")) for e in errors)
    if fwd_failed and state in ("CLEAR", "PROJECTED"):
        state = "UNKNOWN"
        action = None

    bps = action.get("bps") if action else None
    row = {
        "ticker": ticker,
        "name": tok.get("name"),
        "addr": tok.get("addr"),
        "state": state,
        "kind": action["kind"] if action else None,
        "date": action["date"] if action else None,
        "ts": action["ts"] if action else None,
        "detail": action["detail"] if action else None,
        "leadDays": lead_days(action["ts"]) if action else None,
        "bps": bps,
        "ppm": fee_ppm(bps),
        "leak100k": leak_per_100k(bps),
        "isSplit": bool(bps is not None and abs(bps) > SPLIT_BPS),
        "onChainEffectiveAt": eff or 0,
        "spot": spot_px,
        "errors": errors,
    }
    return row


def main():
    reg = json.load(open(REGISTRY))
    tokens = reg["tokens"]
    spot = (reg.get("spot") or {}).get("px") or {}

    chain = read_chain(tokens)
    cache = _cache_load()

    rows = []
    for t in tokens:
        sym = t["ticker"]
        try:
            divs, splits, hist, errors = fetch_announced(sym, cache=cache)
        except Exception as e:
            divs, splits, hist, errors = [], [], [], [f"fatal: {str(e)[:80]}"]

        proj_ts = None
        if not divs and not splits and hist:
            cad = cadence_days(hist)
            if cad:
                last = max(hist)
                nxt = last + timedelta(days=int(round(cad)))
                if nxt >= date.today():
                    proj_ts = _to_ts(nxt)

        rows.append(build_row(t, chain.get(sym), spot.get(sym),
                              (divs, splits, hist, errors), proj_ts))
        time.sleep(0.15)

    _cache_save(cache)

    order = {"ON_CHAIN": 0, "ANNOUNCED_ONLY": 1, "UNKNOWN": 2,
             "PROJECTED": 3, "CLEAR": 4}
    rows.sort(key=lambda r: (order.get(r["state"], 9),
                             r["leadDays"] if r["leadDays"] is not None else 1e9))

    counts = {s: sum(1 for r in rows if r["state"] == s) for s in STATES}
    degraded = [r["ticker"] for r in rows if r.get("errors")]
    inbound = [r for r in rows if r["state"] in ("ON_CHAIN", "ANNOUNCED_ONLY")]

    out = {
        "generatedAt": int(time.time()),
        "chainId": reg.get("chainId", 4663),
        "horizonDays": 180,
        "counts": counts,
        "inbound": len(inbound),
        "degraded": degraded,
        "rows": rows,
    }
    json.dump(out, open(OUT, "w"), indent=1)
    print(f"forward.json: {len(rows)} tokens, {len(inbound)} inbound, "
          f"counts={counts}")
    if degraded:
        print(f"  DEGRADED ({len(degraded)}): {', '.join(degraded)}")
        for r in rows:
            for e in (r.get("errors") or [])[:1]:
                print(f"    {r['ticker']:6} {e}")
    for r in inbound:
        print(f"  {r['state']:15} {r['ticker']:6} {r['date']} "
              f"{r['bps'] and round(r['bps'], 2)} bps  "
              f"lead {r['leadDays'] and round(r['leadDays'], 1)}d  {r['detail']}")
    return out


if __name__ == "__main__":
    main()
