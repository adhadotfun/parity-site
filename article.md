# Your pool has no idea the stock just split.

If you provide liquidity to a tokenized equity on Robinhood Chain, there is a day coming that you did not schedule and will not be consulted about. A company in New York declares a dividend, or a four-for-one split. The token you are quoting against changes value. Your balance does not move by a single wei.

That is not a bug in the token. It is the design. Robinhood's stock tokens follow ERC-8056: a corporate action never moves a balance, it moves a global `uiMultiplier()`. One number changes, and every holder's economic position changes with it.

The problem is that every AMM on the chain prices from `balanceOf()`. The reserves in your pool are byte-identical the block after the action. The curve quotes yesterday's price. The pool's value changed and the pool's math never noticed.

Somebody notices. They arbitrage the gap, and the difference comes out of the LP.

Parity is a Uniswap v4 hook that notices first.

## What the loss actually costs

We had this wrong at the start, so here is the corrected version.

We assumed a dividend drains LPs. Then we simulated it properly: constant-product arbitrage solved by bisection to the true post-rebase price, real fee arithmetic, no closed-form shortcuts. On a pool of 5,000 shares against $125,000, a dividend hands the arber $10.26. That is 0.8 basis points. A rounding error. Guarded, the same trade loses $18.84 and the LP finishes $51.96 up.

Dividends are not the emergency.

A four-for-one split is. Loss scales with the square of the multiplier jump, so a split is not twenty times worse than a dividend, it is four orders of magnitude worse: $124,624 extracted from a $125,000 pool in a single transaction. There is no middle case. You are either fine or you are gone.

Which makes the daily work look absurd. Three hundred and sixty-odd days of nothing, in exchange for not being asleep on the one day that is not a dividend.

## The one thing that makes this defensible

The chain announces it.

ERC-8056 publishes `effectiveAt()` and `newUIMultiplier()` before the step lands. This is a scheduled, publicly visible discontinuity, with a timestamp, sitting in a public getter. It is the easiest event in the world to defend against, and no venue on the chain defends against it.

So the hook is four callbacks and one idea. Before the action, in the announced window, the pool reprices. After it, a surcharge is levied on flow crossing the curve until the divergence is closed. The pool is never made un-arbable, because a pool nobody can arb is a pool that stays mispriced. The arb is made to pay the LP for the privilege.

Base fee 30 bps. Surcharge ceiling 20%.

## A mechanism we designed, priced, and threw out

The obvious next move is an auction: sell the right to rebalance at base fee instead of the surcharge, winning bid paid to LPs. It sounds right. We built it, ran it through the same simulator that produced the numbers above, and it lost in every scenario, including the one it was designed for.

The reason is structural. The surcharge is a tax on the arber's gross flow, every token that crosses the curve while the budget is outstanding. An auction can only ever extract their net, because nobody rationally bids more than they expect to make. Profit is a fraction of flow, so the auction sells the same right for strictly less. On the four-for-one split, the surcharge collects roughly twice the most any bidder would offer.

What survives is the part the surcharge cannot reach: whether anyone notices `effectiveAt()` before it lands. Every figure on our site assumes the pre-rebase window fired. If no keeper is watching, the guard is inert and the LP eats the full unguarded loss. That is the gap something like a bond can price, sized so that missing an announced window costs the keeper more than skipping it saves. There is no token. This is mechanism design shown failing and being replaced, which felt more useful to publish than the version where we only show you the one that worked.

## The boring half: watching all of them

There are 52 tokenized equities on chain 4663. Each one can pay a dividend or split on a calendar you do not control.

Our board cross-checks three legs live: on-chain multiplier state, the Chainlink feed, and the real equity price. The invariant that must hold is `feed = spot × uiMultiplier`. Every break is a live mispricing flowing into any vault or lending market reading that feed.

It resolves 35 of the 52. The other 17 have no canonical feed to cross-check against, which means the invariant cannot be evaluated for them at all. Those should not be curve collateral until they have one.

One more thing worth knowing: issuers expose `oraclePaused()` during corporate actions, and Robinhood's own documentation says the flag is advisory and not enforced on-chain. A paused feed still returns a price. Every venue keeps trading on it.

## Where the fee goes

A hook that charges a surcharge is producing income, and income needs somewhere to sit.

The place already exists on the same chain: an ERC-4626 vault whose share price rises as fees arrive. Deposit the asset, hold a tradeable share, redeem any block. No lockup, no queue, no epoch. We shipped a page for it at useparity.tech/yield.html that reads every vault live and lets you deposit and redeem from your own wallet.

The interesting number on that page is a zero.

Every vault on 4663 exposes a `harvester()`: the one account allowed to push fee income in and lift the share price. We read all of them. 44 tokenized-equity vaults live, 0 with a harvester wired in, 44 still priced at exactly 1.000000.

Nothing is broken. That empty slot is the correct default, and it is the whole argument for building the hook first. Push raw swap fees from an unguarded equity pool into a vault and you are not compounding yield, you are compounding the leak: the arber takes the corporate action, the LP eats it, and the vault dutifully reports a higher share price on a pool that just lost more than it earned. Wiring the second thing to the first before the first exists is how you build a machine that compounds a loss.

So the vault sits empty on purpose, until there is a fee worth harvesting.

## What this does not fix

Each of these is a reason to distrust the pitch. They are here because a defence you cannot audit is a defence you should not use.

The surcharge only recovers 45% on a split. The 20% ceiling is a deliberate safety valve; uncapped, it would brick the pool on a large action. If an action arrives unannounced, the guard degrades to partial recovery.

It is not audited. It compiles clean under solc 0.8.26, passes 6 of 6 fork tests against the canonical Uniswap v4 PoolManager on an Ethereum mainnet fork with genuine unlock and callback accounting, and models the economics exactly. That is not an audit. The hook address also still needs salt-mining so its low bits encode the permission flags.

The ERC-8056 token in that fork test is a mock. No tokenized-equity token exists on Ethereum mainnet, and chain 4663 has the tokens but no v4 deployment. Both halves are real. They are not yet real in the same place, which means Parity is guarding exactly zero dollars today.

No vault on the yield page earns anything yet. Depositing today buys a share priced at one, redeemable for one. The vaults are unaudited live contracts on a young chain.

And a guarded pool is still an equity position. Parity defends against the accounting discontinuity. It does nothing about the underlying going down.

Contracts, simulator and the full write-up of what is guaranteed and what is not are on the site. All MIT.

useparity.tech
