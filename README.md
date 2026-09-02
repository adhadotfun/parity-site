# Parity

Corporate-action defence for tokenized equity pools on Robinhood Chain (chain 4663).

A Uniswap v4 hook that prices the arbitrage a rebase creates and charges it back to the
arbitrageur instead of the LP. This repo is the public site: the live scan board, the
simulation proof table, the bid-auction counter-argument, and the stated limits.

## Run locally

    npm start        # http://localhost:3000

Zero dependencies; `server.js` is a static file server with range support for the
background video.

## Deploy

Railway builds this with Nixpacks (Node 18+) and runs `npm start`, binding `$PORT`.
Every push to `main` triggers a redeploy.

## Data

`data.json` holds the scan snapshot rendered by the board. On-chain rows link to
`robinhoodchain.blockscout.com`, the explorer named in Robinhood's own network docs.
Simulated rows are badged amber and link nowhere, because there is nothing to link to.

MIT licensed.
