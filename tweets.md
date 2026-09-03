# Parity — ready-to-post tweets

Voice: plain sentences, one idea per break, real numbers, limits stated out loud.
No emoji, no hashtags, no hype verbs. Every number below is verified against the
live site or chain 4663 reads.

---

## 1 · Pin this one

Tokenized stocks split and pay dividends. The pool has no idea.

When the multiplier updates, the price inside the pool is stale for one block. The first arber takes the difference, and the LP pays for it.

Parity is a Uniswap v4 hook that prices the event before it lands.

useparity.tech

---

## 2 · The correction (post this early, it earns more trust than any feature)

We got our own number wrong, so here it is corrected.

We assumed a dividend drains LPs. Then we simulated it properly: on a $125k pool the arber nets $10.26. That is 0.8 bps. A rounding error.

Guarded, the same trade loses money.

Dividends are not the emergency. Splits are.

---

## 3 · The limit, said first

A 4-for-1 split is the real one. Price moves 75% in a single multiplier update.

Our surcharge clamps at its 20% ceiling and recovers 45% of the loss.

45%, not 100%. Split defence rests on the pre-rebase window firing. The surcharge is the backstop, not the fix.

---

## 4 · The scan

We read every tokenized-equity vault on chain 4663.

44 live.
0 with a harvester wired in.
44 still priced at exactly 1.000000.

Nothing is broken. There is just no fee source yet.

That is the gap.

---

## 5 · The invariant

One line decides whether a tokenized-equity pool is safe:

feed = spot × uiMultiplier

While it holds, the pool is priced correctly. When the multiplier moves first, it does not, and someone is about to get paid for noticing before you do.

We scan it live: useparity.tech

---

## 6 · Straight answer

The question we keep getting, answered plainly:

Parity is not guarding a single dollar today. Uniswap v4 is not on Robinhood Chain yet, so the hook has nowhere to attach.

What exists: the contract, 6/6 fork tests passing against real v4, the simulator, and a live scan of the chain.

All MIT. All readable.

---

## 7 · By the numbers

Parity so far. All of it checkable.

44 equity vaults scanned on 4663
0 with a fee source wired in
6/6 fork tests passing against real v4
30 bps base fee, 20% surcharge ceiling
45% of a 4-for-1 split recovered
$10.26 of arb profit on a dividend, 0.8 bps
0 lines of it closed source

---

## 8 · gm post

gm.

Robinhood Chain has 44 tokenized-equity vaults live and not one of them earns anything yet.

That is not a criticism. A vault should stay empty until there is a fee worth harvesting.

We are building the part that makes the fee worth harvesting.

---

## 9 · Short

Every corporate action on a tokenized stock is a quiet transfer from LPs to whoever is watching the block.

Nobody is stealing. The pool simply is not told.

A hook can tell it.

---

## 10 · Shortest

Your LPs shouldn't pay the dividend.

Parity is the hook that notices.

---

## 11 · Yield page

Parity Yield is live.

Deposit into an ERC-4626 vault on chain 4663, hold a tradeable share, redeem any block. No lockup, no queue, no epoch.

Every number on the page is read from the chain. Every transaction is signed by your wallet, not ours.

useparity.tech/yield.html

---

## Suggested order

Pin 1. Then 2 (the correction) within the first day, it sets the tone.
Then 4, 3, 5 across the week. Hold 6 for the first "is this vapourware" reply.
7 as a weekly recap. 10 as a quote-tweet or reply filler.
