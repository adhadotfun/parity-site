/* ============================================================
   vault.js — Parity × Vynex YieldShares.

   Deposit a pool asset into a Vynex vault, hold a tradeable
   ERC-20, redeem any block. No lockup, no queue, no epoch.

   Reads go straight to Robinhood Chain over public RPC (both
   nodes send Access-Control-Allow-Origin: *, verified before
   this was written) and are batched through Multicall3, so
   listing 45 vaults is one round trip rather than ~180.

   Writes go through the user's own wallet. Nothing here
   custodies anything: deposit() and redeem() are called by the
   user's own address against Vynex's contracts, and this page
   never holds a key or asks for a signature it did not name.
   ============================================================ */
(() => {
'use strict';

const CHAIN = {
  id: 4663,
  hex: '0x1237',
  name: 'Robinhood Chain',
  rpcs: ['https://robinhood-rpc.publicnode.com',
         'https://rpc.mainnet.chain.robinhood.com'],
  explorer: 'https://robinhoodchain.blockscout.com',
  currency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
};

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const FACTORY    = '0x6d48643d2438EbB75BB80cc6683360C1B9fC4C7b';
const LEGACY     = '0xee57E1B9B87Ca4318E046FAE2C45923f61d8D199';
const ROUTED     = '0x01680b41d61253a61c4c55e897a05d10f280cd2a';
const RETIRED    = {
  '0x1085f66e4d7f0b0fcb0445d10e75909ba6b1307e':
    'Superseded by the routed USDG vault. It still redeems; it is not somewhere to deposit.'
};
const ZERO = '0x0000000000000000000000000000000000000000';

/* Selectors, each verified present in the deployed bytecode before use. */
const S = {
  allVaults:      '0x063effeb',
  asset:          '0x38d52e0f',
  totalAssets:    '0x01e1d114',
  totalSupply:    '0x18160ddd',
  decimals:       '0x313ce567',
  symbol:         '0x95d89b41',
  pricePerShare:  '0x99530b06',
  feeBps:         '0x24a9d853',
  harvester:      '0x4bdaeac1',
  balanceOf:      '0x70a08231',
  allowance:      '0xdd62ed3e',
  approve:        '0x095ea7b3',
  deposit:        '0x6e553f65',   // deposit(uint256,address)
  redeem:         '0xba087652',   // redeem(uint256,address,address)
  previewRedeem:  '0x4cdad506',
  aggregate3:     '0x82ad56cb'
};

/* ---------- minimal ABI codec (no library) ---------- */
const strip   = h => String(h).replace(/^0x/, '');
const pad     = h => strip(h).padStart(64, '0');
const encAddr = a => pad(a.toLowerCase());
const encUint = n => pad(BigInt(n).toString(16));
const hexBig  = h => (!h || h === '0x') ? 0n : BigInt(h);

function decodeString(hex) {
  const h = strip(hex);
  if (h.length < 128) return '';
  const len = parseInt(h.slice(64, 128), 16);
  if (!len || len > 256) return '';
  let s = '';
  const body = h.slice(128, 128 + len * 2);
  for (let i = 0; i < body.length; i += 2) {
    s += String.fromCharCode(parseInt(body.substr(i, 2), 16));
  }
  return s.replace(/\0/g, '');
}

function decodeAddrArray(hex) {
  const h = strip(hex);
  if (h.length < 128) return [];
  const n = parseInt(h.slice(64, 128), 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push('0x' + h.slice(128 + i * 64 + 24, 128 + (i + 1) * 64));
  }
  return out;
}

/* aggregate3((address target, bool allowFailure, bytes callData)[]).
   Every element is dynamic because of the trailing bytes, so the array
   body is a run of offsets followed by the structs themselves. */
function encodeAggregate3(calls) {
  const n = calls.length;
  const structs = calls.map(c => {
    const data = strip(c.data);
    const len  = data.length / 2;
    const body = data.padEnd(Math.ceil(len / 32) * 64, '0');
    return encAddr(c.to) + encUint(1) + encUint(96) + encUint(len) + body;
  });
  let heads = '', tails = '', cursor = n * 32;
  structs.forEach(s => {
    heads += encUint(cursor);
    cursor += s.length / 2;
    tails += s;
  });
  return S.aggregate3 + encUint(32) + encUint(n) + heads + tails;
}

function decodeAggregate3(hex) {
  const h = strip(hex);
  const n = parseInt(h.slice(64, 128), 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const off   = parseInt(h.slice(128 + i * 64, 128 + (i + 1) * 64), 16) * 2;
    const base  = 128 + off;
    const ok    = parseInt(h.slice(base, base + 64), 16) === 1;
    const dOff  = parseInt(h.slice(base + 64, base + 128), 16) * 2;
    const dBase = base + dOff;
    const dLen  = parseInt(h.slice(dBase, dBase + 64), 16);
    out.push({ ok, data: '0x' + h.slice(dBase + 64, dBase + 64 + dLen * 2) });
  }
  return out;
}

/* ---------- transport ---------- */
let rpcIdx = 0, reqId = 0;

async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < CHAIN.rpcs.length; i++) {
    const url = CHAIN.rpcs[(rpcIdx + i) % CHAIN.rpcs.length];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++reqId, method, params })
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      rpcIdx = (rpcIdx + i) % CHAIN.rpcs.length;
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all RPC nodes unreachable');
}

const ethCall = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);

async function multicall(calls) {
  const res = await ethCall(MULTICALL3, encodeAggregate3(calls));
  return decodeAggregate3(res);
}

/* ---------- units ---------- */
function fmtUnits(v, dec, places) {
  v = BigInt(v); dec = Number(dec);
  const neg = v < 0n; if (neg) v = -v;
  const base = 10n ** BigInt(dec);
  let frac = (v % base).toString().padStart(dec, '0');
  if (places !== undefined) frac = frac.slice(0, places);
  frac = frac.replace(/0+$/, '');
  const ws = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + ws + (frac ? '.' + frac : '');
}

function parseUnits(str, dec) {
  const s = String(str == null ? '' : str).trim();
  if (!s || !/^\d*\.?\d*$/.test(s) || s === '.') return null;
  const [w = '0', f = ''] = s.split('.');
  return BigInt(w || '0') * 10n ** BigInt(dec)
       + BigInt((f + '0'.repeat(dec)).slice(0, dec) || '0');
}

const short = a => a.slice(0, 6) + '\u2026' + a.slice(-4);
const one   = d => 10n ** BigInt(d);


/* ============================================================
   state
   ============================================================ */
const st = {
  vaults: [], selected: null, account: null,
  chainOk: false, mode: 'deposit', busy: false, loaded: false
};

const $  = s => document.querySelector(s);
const el = (t, c, x) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (x !== undefined) n.textContent = x;
  return n;
};

function cleanErr(e) {
  const m = (e && (e.data?.message || e.message)) || String(e);
  if (/user rejected|user denied|4001/i.test(m)) return 'Cancelled in wallet.';
  if (/insufficient funds/i.test(m)) return 'Not enough ETH on chain 4663 for gas.';
  if (/execution reverted/i.test(m)) return 'The contract rejected it: ' + m.replace(/.*execution reverted:?/i, '').trim();
  return m.length > 180 ? m.slice(0, 180) + '\u2026' : m;
}

function note(msg, tone, hash) {
  const n = $('#vnote');
  if (!n) return;
  n.className = 'vnote ' + (tone || '');
  n.innerHTML = '';
  n.appendChild(el('span', null, msg));
  if (hash) {
    const a = el('a', null, 'View transaction');
    a.href = `${CHAIN.explorer}/tx/${hash}`;
    a.target = '_blank'; a.rel = 'noopener';
    n.appendChild(a);
  }
  n.hidden = false;
}

function busy(b) {
  st.busy = b;
  document.querySelectorAll('#vaultui button').forEach(x => { x.disabled = b; });
  const go = $('#vgo');
  if (go) go.classList.toggle('is-busy', b);
}

/* ============================================================
   load the market from chain
   ============================================================ */
async function loadVaults() {
  const [a, b] = await Promise.all([
    ethCall(FACTORY, S.allVaults).catch(() => '0x'),
    ethCall(LEGACY,  S.allVaults).catch(() => '0x')
  ]);
  let addrs = [...decodeAddrArray(a), ...decodeAddrArray(b), ROUTED];
  addrs = [...new Set(addrs.map(x => x.toLowerCase()))];

  const fields = [S.asset, S.totalAssets, S.totalSupply, S.decimals,
                  S.symbol, S.pricePerShare, S.harvester, S.feeBps];
  const calls = [];
  addrs.forEach(v => fields.forEach(f => calls.push({ to: v, data: f })));

  // chunked so one oversized eth_call never trips a node's response cap
  const results = [];
  for (let i = 0; i < calls.length; i += 120) {
    results.push(...await multicall(calls.slice(i, i + 120)));
  }

  const vaults = [];
  addrs.forEach((v, i) => {
    const [asset, tA, tS, dec, sym, pps, harv, fee] =
      results.slice(i * fields.length, (i + 1) * fields.length);
    if (!asset || !asset.ok || asset.data === '0x') return;
    vaults.push({
      address: v,
      asset: '0x' + strip(asset.data).slice(24),
      totalAssets: tA.ok ? hexBig(tA.data) : 0n,
      totalSupply: tS.ok ? hexBig(tS.data) : 0n,
      decimals: dec.ok ? Number(hexBig(dec.data)) : 18,
      symbol: sym.ok ? decodeString(sym.data) : '?',
      pps: pps.ok ? hexBig(pps.data) : 0n,
      harvester: (harv.ok && harv.data !== '0x')
        ? '0x' + strip(harv.data).slice(24) : null,
      feeBps: (fee.ok && fee.data !== '0x') ? Number(hexBig(fee.data)) : null,
      routed: v === ROUTED,
      retired: !!RETIRED[v],
      myAsset: null, myShares: null, allow: null
    });
  });

  try {
    const ar = await multicall(vaults.map(v => ({ to: v.asset, data: S.symbol })));
    vaults.forEach((v, i) => {
      v.assetSymbol = (ar[i].ok && decodeString(ar[i].data)) || v.symbol.replace(/^ys-/, '');
    });
  } catch {
    vaults.forEach(v => { v.assetSymbol = v.symbol.replace(/^ys-/, ''); });
  }

  // earning first, then deepest, retired last
  vaults.sort((x, y) => {
    if (x.retired !== y.retired) return x.retired ? 1 : -1;
    const xe = x.pps > one(x.decimals), ye = y.pps > one(y.decimals);
    if (xe !== ye) return xe ? -1 : 1;
    return y.totalAssets > x.totalAssets ? 1 : -1;
  });

  st.vaults = vaults;
  st.loaded = true;
  return vaults;
}

/* ============================================================
   the socket panel — the reason these two protocols belong
   on the same page, counted live rather than asserted
   ============================================================ */
function renderSocket() {
  const box = $('#hsocket');
  if (!box) return;
  const equity = st.vaults.filter(v => !v.routed && !v.retired);
  const wired  = equity.filter(v => v.harvester && v.harvester !== ZERO);
  const virgin = equity.filter(v => v.pps === one(v.decimals));

  const rows = [
    ['Tokenized-equity vaults live', equity.length,
     'deployed by the Vynex factory on chain 4663', 'ink'],
    ['With a harvester wired in', wired.length,
     wired.length === 0
       ? 'harvester() returns the zero address on every one'
       : 'read from harvester() on each vault',
     wired.length ? 'green' : 'red'],
    ['Still priced at exactly 1.000000', virgin.length,
     'no fee income has ever reached them', 'ink']
  ];

  box.innerHTML = '';
  rows.forEach(([k, v, sub, tone]) => {
    const r = el('div', 'hs-row');
    r.appendChild(el('div', 'hs-k', k));
    r.appendChild(el('div', 'hs-v ' + tone, String(v)));
    r.appendChild(el('div', 'hs-s', sub));
    box.appendChild(r);
  });
}

/* ============================================================
   wallet
   ============================================================ */
const provider = () => window.ethereum || null;

async function checkChain() {
  const p = provider();
  if (!p) { st.chainOk = false; return false; }
  try {
    st.chainOk = parseInt(await p.request({ method: 'eth_chainId' }), 16) === CHAIN.id;
  } catch { st.chainOk = false; }
  return st.chainOk;
}

async function ensureChain() {
  const p = provider();
  if (!p) return false;
  if (await checkChain()) return true;
  try {
    await p.request({ method: 'wallet_switchEthereumChain',
                      params: [{ chainId: CHAIN.hex }] });
  } catch (e) {
    if (e && (e.code === 4902 || /unrecognized|not been added/i.test(e.message || ''))) {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN.hex, chainName: CHAIN.name,
          nativeCurrency: CHAIN.currency,
          rpcUrls: [CHAIN.rpcs[0]],
          blockExplorerUrls: [CHAIN.explorer]
        }]
      });
    } else throw e;
  }
  return checkChain();
}

function onAccounts(a) {
  st.account = (a && a[0]) ? a[0].toLowerCase() : null;
  refreshAccount().then(render);
}
function onChain() { checkChain().then(render); }

async function connect() {
  const p = provider();
  if (!p) {
    note('No injected wallet found. MetaMask, Rabby, or any EIP-1193 wallet works.', 'warn');
    return;
  }
  try {
    const accs = await p.request({ method: 'eth_requestAccounts' });
    st.account = (accs && accs[0]) ? accs[0].toLowerCase() : null;
    await ensureChain();
    p.removeListener?.('accountsChanged', onAccounts);
    p.removeListener?.('chainChanged', onChain);
    p.on?.('accountsChanged', onAccounts);
    p.on?.('chainChanged', onChain);
    await refreshAccount();
    render();
  } catch (e) { note(cleanErr(e), 'warn'); }
}

async function refreshAccount() {
  const v = st.selected;
  if (!v) return;
  if (!st.account) { v.myAsset = v.myShares = v.allow = null; return; }
  const A = encAddr(st.account);
  try {
    const r = await multicall([
      { to: v.asset,   data: S.balanceOf + A },
      { to: v.address, data: S.balanceOf + A },
      { to: v.asset,   data: S.allowance + A + encAddr(v.address) }
    ]);
    v.myAsset  = r[0].ok ? hexBig(r[0].data) : 0n;
    v.myShares = r[1].ok ? hexBig(r[1].data) : 0n;
    v.allow    = r[2].ok ? hexBig(r[2].data) : 0n;
  } catch { /* leave nulls; the UI shows a dash */ }
}

async function reloadSelected() {
  const v = st.selected;
  if (!v) return;
  try {
    const r = await multicall([
      { to: v.address, data: S.totalAssets },
      { to: v.address, data: S.totalSupply },
      { to: v.address, data: S.pricePerShare }
    ]);
    if (r[0].ok) v.totalAssets = hexBig(r[0].data);
    if (r[1].ok) v.totalSupply = hexBig(r[1].data);
    if (r[2].ok) v.pps         = hexBig(r[2].data);
  } catch {}
  await refreshAccount();
  render();
}


/* ============================================================
   writes
   ============================================================ */
async function sendTx(to, data, label) {
  const p = provider();
  if (!p) throw new Error('No wallet connected.');
  if (!await ensureChain()) throw new Error('Wrong network. Switch to chain 4663.');
  note(`${label}: confirm in your wallet\u2026`, 'wait');
  const hash = await p.request({
    method: 'eth_sendTransaction',
    params: [{ from: st.account, to, data }]
  });
  note(`${label}: submitted, waiting for the chain\u2026`, 'wait', hash);
  const rec = await waitFor(hash);
  if (hexBig(rec.status) !== 1n) throw new Error(`${label} reverted on-chain.`);
  note(`${label}: confirmed in block ${Number(hexBig(rec.blockNumber))}.`, 'ok', hash);
  return rec;
}

async function waitFor(hash, tries = 90) {
  for (let i = 0; i < tries; i++) {
    const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (r) return r;
    await new Promise(s => setTimeout(s, 2000));
  }
  throw new Error('Timed out waiting for the receipt. The transaction may still land.');
}

async function doDeposit() {
  const v = st.selected;
  const amt = parseUnits($('#vamount').value, v.decimals);
  if (amt === null || amt <= 0n) return note('Enter an amount.', 'warn');
  if (v.retired) return note('This vault is retired. Redeem only.', 'warn');
  if (v.myAsset !== null && amt > v.myAsset) {
    return note(`You hold ${fmtUnits(v.myAsset, v.decimals, 6)} ${v.assetSymbol}.`, 'warn');
  }
  busy(true);
  try {
    if (v.allow === null || v.allow < amt) {
      await sendTx(v.asset, S.approve + encAddr(v.address) + encUint(amt),
                   `Approve ${v.assetSymbol}`);
    }
    await sendTx(v.address, S.deposit + encUint(amt) + encAddr(st.account),
                 `Deposit ${fmtUnits(amt, v.decimals, 6)} ${v.assetSymbol}`);
    $('#vamount').value = '';
    await reloadSelected();
  } catch (e) { note(cleanErr(e), 'warn'); }
  busy(false);
}

async function doRedeem() {
  const v = st.selected;
  const amt = parseUnits($('#vamount').value, v.decimals);
  if (amt === null || amt <= 0n) return note('Enter a number of shares.', 'warn');
  if (v.myShares !== null && amt > v.myShares) {
    return note(`You hold ${fmtUnits(v.myShares, v.decimals, 6)} ${v.symbol}.`, 'warn');
  }
  busy(true);
  try {
    const A = encAddr(st.account);
    await sendTx(v.address, S.redeem + encUint(amt) + A + A,
                 `Redeem ${fmtUnits(amt, v.decimals, 6)} ${v.symbol}`);
    $('#vamount').value = '';
    await reloadSelected();
  } catch (e) { note(cleanErr(e), 'warn'); }
  busy(false);
}

/* ============================================================
   render
   ============================================================ */
function vaultLabel(v) {
  const earning = v.pps > one(v.decimals);
  return `${v.symbol}  ·  ${earning ? 'earning' : 'idle'}${v.retired ? '  ·  retired' : ''}`;
}

function renderPicker() {
  const sel = $('#vpick');
  if (!sel) return;
  sel.innerHTML = '';
  st.vaults.forEach(v => {
    const o = el('option', null, vaultLabel(v));
    o.value = v.address;
    sel.appendChild(o);
  });
  if (st.selected) sel.value = st.selected.address;
}

function renderVault() {
  const v = st.selected;
  if (!v) return;
  const D = v.decimals;
  const earning = v.pps > one(D);
  const drift = v.pps - one(D);

  const set = (id, txt, cls) => {
    const n = $(id);
    if (!n) return;
    n.textContent = txt;
    if (cls !== undefined) n.className = cls;
  };

  set('#vsym', v.symbol);
  set('#vasset', `1 share redeems ${fmtUnits(v.pps, D, 6)} ${v.assetSymbol}`);
  set('#vtvl', fmtUnits(v.totalAssets, D, 4) + ' ' + v.assetSymbol);
  set('#vsupply', fmtUnits(v.totalSupply, D, 4) + ' ' + v.symbol);
  set('#vpps', fmtUnits(v.pps, D, 6), 'vk-v num ' + (earning ? 'green' : ''));
  set('#vfee', v.feeBps === null ? 'n/a' : (v.feeBps / 100).toFixed(2) + '%');

  const hv = $('#vharv');
  if (hv) {
    const wired = v.harvester && v.harvester !== ZERO;
    hv.textContent = wired ? short(v.harvester) : 'not wired';
    hv.className = 'vk-v num ' + (wired ? 'green' : 'red');
  }

  const st1 = $('#vstatus');
  if (st1) {
    st1.textContent = v.retired
      ? RETIRED[v.address]
      : earning
        ? `This vault has accrued ${fmtUnits(drift, D, 8)} ${v.assetSymbol} of fee income per share since launch.`
        : 'This vault has never received a harvest. Its price per share is still exactly one, so depositing today earns nothing until a fee source is wired to it.';
    st1.className = 'vstatus ' + (v.retired ? 'warn' : earning ? 'ok' : 'idle');
  }

  const link = $('#vscan');
  if (link) link.href = `${CHAIN.explorer}/address/${v.address}`;

  // position
  const pos = $('#vpos');
  if (pos) {
    if (!st.account) {
      pos.innerHTML = '';
      pos.appendChild(el('div', 'vpos-empty',
        'Connect a wallet to see your balance, deposit, and redeem.'));
    } else {
      const redeemable = v.myShares !== null && v.totalSupply > 0n
        ? (v.myShares * v.totalAssets) / v.totalSupply
        : 0n;
      pos.innerHTML = '';
      [['Wallet', v.myAsset === null ? '\u2014' : fmtUnits(v.myAsset, D, 6) + ' ' + v.assetSymbol],
       ['Shares held', v.myShares === null ? '\u2014' : fmtUnits(v.myShares, D, 6) + ' ' + v.symbol],
       ['Redeemable now', v.myShares === null ? '\u2014' : fmtUnits(redeemable, D, 6) + ' ' + v.assetSymbol]
      ].forEach(([k, val]) => {
        const r = el('div', 'vpos-row');
        r.appendChild(el('span', 'vpos-k', k));
        r.appendChild(el('span', 'vpos-v num', val));
        pos.appendChild(r);
      });
    }
  }

  // action side
  const dep = st.mode === 'deposit';
  const inp = $('#vamount');
  if (inp) inp.placeholder = dep ? `Amount of ${v.assetSymbol}` : `Shares of ${v.symbol}`;
  const go = $('#vgo');
  if (go) go.textContent = dep ? 'Approve & deposit' : 'Redeem';
  $('#vmax') && ($('#vmax').hidden = !st.account);
  document.querySelectorAll('.vtab').forEach(t => {
    t.classList.toggle('on', (t.dataset.mode === 'deposit') === dep);
  });

  const prev = $('#vpreview');
  if (prev) {
    const amt = parseUnits(inp ? inp.value : '', D);
    if (amt && amt > 0n && v.pps > 0n) {
      prev.hidden = false;
      prev.textContent = dep
        ? `\u2248 ${fmtUnits(amt * one(D) / v.pps, D, 6)} ${v.symbol} minted`
        : `\u2248 ${fmtUnits(amt * v.pps / one(D), D, 6)} ${v.assetSymbol} returned`;
    } else prev.hidden = true;
  }

  if (dep && v.retired) {
    go && (go.disabled = true);
  }
}

function renderWallet() {
  const b = $('#vconnect');
  if (!b) return;
  if (!st.account) {
    b.textContent = 'Connect wallet';
    b.className = 'btn btn-p';
  } else {
    b.textContent = st.chainOk ? short(st.account) : 'Switch to chain 4663';
    b.className = 'btn ' + (st.chainOk ? 'btn-s' : 'btn-p');
  }
}

function render() { renderPicker(); renderVault(); renderWallet(); renderSocket(); }

/* ============================================================
   init
   ============================================================ */
async function init() {
  const root = $('#vaultui');
  if (!root) return;

  $('#vconnect').onclick = () => (st.account && st.chainOk) ? null : connect();
  document.querySelectorAll('.vtab').forEach(t => {
    t.onclick = () => { st.mode = t.dataset.mode; note('', ''); $('#vnote').hidden = true; render(); };
  });
  $('#vamount').addEventListener('input', renderVault);
  $('#vmax').onclick = () => {
    const v = st.selected; if (!v) return;
    const amt = st.mode === 'deposit' ? v.myAsset : v.myShares;
    if (amt !== null) { $('#vamount').value = fmtUnits(amt, v.decimals); renderVault(); }
  };
  $('#vgo').onclick = () => {
    if (!st.account) return connect();
    return st.mode === 'deposit' ? doDeposit() : doRedeem();
  };
  $('#vpick').onchange = async e => {
    st.selected = st.vaults.find(v => v.address === e.target.value) || null;
    $('#vnote').hidden = true;
    render();
    await refreshAccount();
    render();
  };

  try {
    await loadVaults();
    if (!st.vaults.length) throw new Error('registry returned no vaults');
    st.selected = st.vaults[0];
    root.classList.remove('is-loading');
    render();
  } catch (e) {
    root.classList.remove('is-loading');
    note('Could not reach Robinhood Chain: ' + cleanErr(e)
       + ' The vault list and your balances are read live, so nothing is shown rather than showing something stale.', 'warn');
  }

  // reconnect silently if the wallet is already authorised
  const p = provider();
  if (p) {
    try {
      const accs = await p.request({ method: 'eth_accounts' });
      if (accs && accs[0]) {
        st.account = accs[0].toLowerCase();
        await checkChain();
        p.on?.('accountsChanged', onAccounts);
        p.on?.('chainChanged', onChain);
        await refreshAccount();
        render();
      }
    } catch {}
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else init();

})();
