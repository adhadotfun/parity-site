# $PARITY — a token whose value accrues on a published corporate calendar

## The name is the invariant

`uiMultiplier() == 1e18` is **parity**. Every tokenized equity on Robinhood Chain
starts there. Every corporate action breaks it — and the break is where LPs bleed.

CCL sits at `1.021486444855206408` right now. It will never be 1.0 again. The
protocol is named after the number it defends.

> **Parity is 1.000000. Everything else is a trade.**

---

## What is actually scarce here

Not information — `effectiveAt` is a public on-chain uint. I read CCL's live:
`0x6a959962` = 1788189026. Anyone can see it coming.

Not yield — there's no float to lend.

**The scarce thing is the right to be the one who rebalances the pool.**

When a multiplier steps, *somebody must trade the pool back to fair price*. That
trade is necessary, it is profitable, and it is scheduled on a calendar published
by Nasdaq a century before any of this existed. Today it goes to whoever's bot is
fastest, for free. The guard just proved it can price that instead:

```
identical 300e18 swaps through the real Uniswap v4 PoolManager
  pre-rebase   282.217735 stock out
  post-rebase  246.913356 stock out
  leakBudget   15.733505 stock     <- guard's own measure of the discontinuity
  fee quoted   23,520 ppm (2.352%) <- routed to LPs, not to the first bot
```

That 15.73 is a real, recurring, calendar-scheduled prize. **$PARITY is the
clearing medium for it.**

---

## The auction is dead — I priced it and it loses

The original pitch here was a sealed-bid auction: sell the right to rebalance at
base fee instead of the 2.352% surcharge, denominated in $PARITY, winning bid paid
to LPs. I ran it through the same simulator that produced the proof table.

It fails in all three scenarios, including the one it was designed for:

| scenario | max a bidder rationally pays | bid LPs need to match the surcharge | gap |
|---|---|---|---|
| CCL dividend | $10.26 | $58.20 | −$47.94 |
| small dividend | $0.00 | $0.56 | −$0.56 |
| **4-for-1 split** | **$28,758.48** | **$56,715.04** | **−$27,956.56** |

The reason is structural and cannot be tuned away:

> **The surcharge taxes the arber's gross flow. An auction can only extract their
> net profit.** Profit is a fraction of flow, so the auction always sells the same
> right for strictly less than the mechanism already shipped.

On the split the surcharge collects roughly 2× what any rational bidder would
offer. Worse, the bidder's fallback is not "don't trade" — on a split they still
net $95,865 paying the full surcharge, so their willingness to pay is only the
*difference* between the two paths, not their whole profit.

This is live on the site as an interactive panel. You can move the slider and
watch it fail to clear. Shipping the disproof is worth more than shipping the
pitch — it is the same instinct as publishing the executor wallet on HookLaunch.

## What survives: the keeper bond

The surcharge cannot reach exactly one thing, and it is the thing every number on
the site quietly assumes: **whether anyone notices `effectiveAt()` before it lands.**

If no keeper is watching, the guard never arms, the pre-rebase window never opens,
and the LP eats the full unguarded loss. That is not a fee-design problem — no
surcharge rate defends against a mechanism that stayed asleep. It is a liveness
problem, and liveness is the one thing a bond prices correctly.

**Post $PARITY to run a keeper. Get slashed to the LPs of any pool where you
missed an announced window.**

Minimum incentive-compatible bond, per guarded pool:

```
gdLp − ungLp  on the 4-for-1 split  =  $56,715.04
```

Below that, letting the window lapse is profitable. Above it, it isn't. The number
is not a governance parameter someone picks — it falls out of the simulation, and
it rises with pool size, which means bond demand scales with guarded TVL.

The other three supports still stand, unchanged: a hold-tier exemption on the
residual surcharge tail, treasury accrual **in stock tokens** (so it compounds
through `uiMultiplier` — paid by the thing it protects you from), and fixed supply
with zero emissions.

But the honest headline is narrower than the one I started with: **$PARITY is a
liveness bond, not a claim on arbitrage revenue.** The arbitrage revenue already
has a better owner — the LPs, via a fee the hook charges directly.

## The narrative hook the audit just handed us

Selector audit of the shared ERC-8056 implementation
(`0xb35490d6…c5ae2`, one implementation behind all 52 tokens):

- **Corporate actions are one call.** `updateMultiplier(uint256)` and
  `updateMultiplier(uint256,uint256)` — the two-arg form is the scheduled version.
- **`adminBurn(address,uint256)` exists.** Balances can be clawed back.
- **The beacon holds the real power.** `0xe10b6f6b…151b00` exposes
  `upgradeTo(address)`, `blockAccounts(address[])`, `unblockAccounts(address[])`,
  `pause()`. One beacon, 52 tokens.
- **Role hashes are not discoverable.** `hasRole(bytes32,address)` is live on every
  token, but the implementation exposes **zero** `*_ROLE()` constants. You cannot
  enumerate who is allowed to do any of the above from on-chain data alone.
- 15 of 59 selectors still don't resolve against a 2,000-signature dictionary or
  4byte. Unknown surface.

**52 tokenized equities. One beacon. One `upgradeTo()` call. Non-enumerable roles.**

Somebody should be watching that. That's the launch tweet, and it's true.

---

## Launch shape

- **Fixed supply, zero emissions.** Emissions would contradict mechanism 1 —
  you cannot claim "the arb pays the LP" while also paying the LP out of inflation.
- **Launch on Pons**, which already shipped stock-paired launches on Aug 4 and
  already owns this chain's launchpad flow. Don't rebuild the venue.
- **Pair it against a stock token, not the gas token** — $PARITY/CCL is the
  self-referential joke that happens to also be the correct collateral: the pool
  that pays for corporate-action defence is itself exposed to a corporate action,
  and it's the one pool guaranteed to be guarded.
- **Ship the ex-div countdown as the front page** (already live). The product is a
  clock. A token with a clock beats a token with a roadmap.

---

## What's uncomfortable and should be said anyway

- **The event rate is thin.** Two `UIMultiplierUpdated` events in the last 2M
  blocks. Quarterly dividends across 52 tokens is maybe 40–100 events/year at full
  coverage. That is the honest TAM of the auction — it is not a perpetual DEX.
- **Dividends are small; splits are the real prize.** A 2.15% dividend produced a
  15.73-token leak on a mid-size pool. A 4-for-1 split is a 99.7% LP wipeout. The
  auction is worth little most quarters and enormous occasionally. Traders should
  size it as a lottery on a known calendar, not as a coupon.
- **`oraclePaused()` is advisory, not enforced on-chain.** The guard narrows the
  leak, it cannot close it.
- **Keepers can collude.** A keeper cartel that deliberately misses a window turns
  a guarded pool into an unguarded one for that block. Slashing is a deterrent,
  not a proof.
- **We do not control the underlying.** $PARITY's usage scales with tokenized-equity
  TVL on chain 4663, which is Robinhood's decision, not ours.
- **Nothing is deployed to 4663 yet.** The guard is proven on a mainnet fork against
  real PoolManager bytecode with a mocked ERC-8056 token. No audit. Say that on the
  site until it stops being true.
