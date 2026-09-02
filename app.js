const $ = s => document.querySelector(s);

/* ---------- per-scenario provenance: why each row is real ---------- */
const EXPLORER = 'https://robinhoodchain.blockscout.com';   // official, per Robinhood's own network docs

const WHY = {
  S1: {
    kind: 'onchain', tag: 'observed on-chain',
    claim: 'This row is a replay of an event that actually happened.',
    body: `Carnival's tokenized share paid a dividend on Robinhood Chain 4663. The token
      did not move anyone's balance. It raised <span class="num">uiMultiplier()</span> from
      <span class="num">1.000000000000000000</span> to <span class="num">1.021486444855206408</span>
      in a single call. That is the entire corporate action, and it is a public state change
      anybody can read back.`,
    ev: [
      ['contract', '0x9651342cea770ae9a2969ba2a52611523146aef9', 'CCL, chain 4663', EXPLORER + '/address/0x9651342cea770ae9a2969ba2a52611523146aef9'],
      ['event', 'UIMultiplierUpdated @ block 50,955,407', 'read from the chain, not constructed', EXPLORER + '/block/50955407'],
      ['multiplier', '1.000000 → 1.021486444855206408', 'exact uint, no rounding'],
      ['fed into', 'MockScaledUIToken.applyRebase(1021486444855206408)', 'same integer, unmodified']
    ],
    works: `The hook was not told the answer. It read the multiplier itself, measured the pool's
      price against it, and sized the discontinuity at <span class="num">15.733505</span> stock. It then
      quoted <span class="num">2.352%</span> against the extracting direction only. Two identical
      300e18 swaps through the real PoolManager, before and after the rebase, came out at
      <span class="num">282.217735</span> and <span class="num">246.913356</span>, the gap the guard priced.`,
    caveat: `The correction worth stating: this is a small number. The arber nets $10.26 on a $125k pool,
      0.8 bps. A dividend is a rounding error, not a scandal. We said otherwise at first and were wrong.`
  },
  S2: {
    kind: 'onchain', tag: 'observed on-chain',
    claim: 'A second real event, deliberately kept in because it is boring.',
    body: `A smaller dividend on the same chain, roughly a fifth the size of CCL's. It is here as a
      control: if the guard only behaved sensibly on the one event we designed around, that would
      be curve-fitting. The multiplier here also does not start at parity, it sits at
      <span class="num">1.0029815</span>, proving the guard reads the <em>step</em>, not the absolute value.`,
    ev: [
      ['event', 'UIMultiplierUpdated @ block 51,269,236', 'chain 4663', EXPLORER + '/block/51269236'],
      ['multiplier', '1.0029815193467666 → 1.005101770003215', 'a 0.21% step off a non-parity base'],
      ['surcharge', '2,114 ppm (0.21%)', 'scales with the step, not hardcoded'],
      ['LP outcome', 'positive in both columns', 'nothing to defend, so almost nothing charged']
    ],
    works: `The surcharge came out at <span class="num">0.21%</span>, an order of magnitude below CCL's
      2.35%, tracking the size of the step. The unguarded arber already <span class="serif-em">loses</span>
      money here, so there was no leak to recapture and the hook stayed nearly out of the way.
      A guard that charges when there is nothing to defend is a tax; this one didn't.`,
    caveat: `Honest reading: this row proves proportionality, not protection. Nothing was at risk.`
  },
  S3: {
    kind: 'synthetic', tag: 'constructed, not observed',
    claim: 'This one did NOT happen on-chain. We built it, and it is the most important row.',
    body: `No 4-for-1 split has occurred on chain 4663 in the window we scanned. Two multiplier
      events in 2M blocks, both dividends. So the multiplier here is set by hand to
      <span class="num">4.0</span>. We include it because a split is the failure mode that actually
      threatens an LP, and leaving it out because it hasn't happened yet would be the dishonest choice.`,
    ev: [
      ['multiplier', '1.0 → 4.0', 'chosen by us, this is the synthetic part'],
      ['pool + solver', 'identical to S1 and S2', 'same bisection, same fee arithmetic'],
      ['surcharge', 'clamps at the 20% ceiling', 'the cap binds, the hook cannot charge more'],
      ['fork test', 'test_split_surchargeClampsAtCeiling, passing', '6/6 suite against real v4-core']
    ],
    works: `It works, and then it stops working, which is the point. The surcharge recovers
      <span class="num">45%</span> of the loss and no more, because a 4-for-1 is a 99.7% price
      dislocation and 20% of flow cannot cover it. The LP still finishes
      <span class="num">−$67,533</span>. The number the guard preserves,
      <span class="num">$56,715</span>, is the whole reason the token became a keeper bond
      rather than a revenue claim.`,
    caveat: `Split defence rests entirely on the pre-rebase window firing. If nothing was watching
      effectiveAt(), the surcharge is a backstop that recovers under half. Do not read this row as protection.`
  }
};

function whyHTML(s, w) {
  const ev = (w.ev || []).map(([k, v, n, url]) => {
    const val = url
      ? `<a class="evv num exlink" href="${url}" target="_blank" rel="noopener noreferrer">${v}<span class="exi">↗</span></a>`
      : `<div class="evv num">${v}</div>`;
    return `<div class="evr"><div class="evk">${k}</div>${val}<div class="evn">${n}</div></div>`;
  }).join('');
  const foot = w.kind === 'onchain'
    ? `<div class="exfoot">Links open <b>robinhoodchain.blockscout.com</b>, the explorer named in Robinhood's own network documentation for chain 4663. Verify the multiplier yourself; don't take the row's word for it.</div>`
    : `<div class="exfoot syn">No explorer links on this row: there is nothing on-chain to link to. The multiplier was chosen by us.</div>`;
  return `<div class="whybox">
    <div class="whygrid">
      <div>
        <div class="whyclaim ${w.kind}">${w.claim || ''}</div>
        <p class="whyp">${w.body || ''}</p>
        <div class="whyh">why this shows the hook working</div>
        <p class="whyp">${w.works || ''}</p>
        <div class="whycav"><b>caveat</b> ${w.caveat || ''}</div>
      </div>
      <div class="evbox"><div class="whyh" style="margin-top:0">verifiable inputs</div>${ev}${foot}</div>
    </div>
  </div>`;
}

function toggleWhy(row) {
  const id = row.dataset.w;
  const det = document.querySelector('#why-' + id);
  const open = !det.hidden;
  document.querySelectorAll('.whyrow').forEach(d => d.hidden = true);
  document.querySelectorAll('.simrow').forEach(r => { r.classList.remove('open'); r.setAttribute('aria-expanded', 'false'); });
  if (!open) { det.hidden = false; row.classList.add('open'); row.setAttribute('aria-expanded', 'true'); }
}

const fmt = (n, d = 2) => n == null ? '·' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = n => n == null ? '·' : (n < 0 ? '−$' : '$') + fmt(Math.abs(n));
const pad2 = n => String(n).padStart(2, '0');

let DATA = null, filter = 'all', cdTimer = null;

fetch('data.json').then(r => r.json()).then(d => { DATA = d; render(); });

/* ---------- ex-div countdown ---------- */
function nextAction() {
  const now = Date.now() / 1000;
  const pend = DATA.assets
    .filter(a => a.pending && a.effectiveAt > now)
    .sort((a, b) => a.effectiveAt - b.effectiveAt);
  return pend[0] || null;
}

function ago(ts) {
  const d = (Date.now() / 1000 - ts) / 86400;
  if (d < 1) return `${Math.round(d * 24)}h ago`;
  return `${Math.round(d)}d ago`;
}

function countdown() {
  const nxt = nextAction();
  const el = $('#cdunits');
  if (!el) return;

  if (!nxt) {
    el.innerHTML = ['·', '·', '·', '·'].map((v, i) =>
      `<div class="cd-u"><div class="n">${v}</div><div class="l">${['days', 'hrs', 'min', 'sec'][i]}</div></div>`).join('');
    el.classList.add('idle');
    return;
  }
  el.classList.remove('idle');
  let s = Math.max(0, Math.floor(nxt.effectiveAt - Date.now() / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  el.innerHTML = [[d, 'days'], [pad2(h), 'hrs'], [pad2(m), 'min'], [pad2(s), 'sec']]
    .map(([v, l]) => `<div class="cd-u"><div class="n">${v}</div><div class="l">${l}</div></div>`).join('');
}

function watchboard() {
  const nxt = nextAction();
  const armed = !nxt;

  const head = armed
    ? { cls: 'armed', state: 'armed · no action pending', title: 'Nothing scheduled across 35 tokens.',
        sub: 'The guard is watching <span class="num">effectiveAt()</span> on every ERC-8056 token with a canonical feed. The moment an issuer announces a dividend or split, this counts down and the pool enters its pre-rebase window 30 minutes out.' }
    : { cls: 'hot', state: `action pending · ${nxt.ticker}`, title: `${nxt.ticker} rebases to ${nxt.newMult.toFixed(8)}`,
        sub: `Multiplier steps from <span class="num">${nxt.mult.toFixed(8)}</span> to <span class="num">${nxt.newMult.toFixed(8)}</span>, a <span class="num">${((nxt.newMult / nxt.mult - 1) * 10000).toFixed(2)} bps</span> discontinuity with no balance movement. Pre-rebase window opens 30 minutes before.` };

  const log = DATA.events.map(e => `
    <div class="wl">
      <div class="ago">${ago(e.ts)}</div>
      <div>
        <div class="tk">${e.ticker}${e.name ? ` <span style="color:var(--faint);font-weight:400">${e.name}</span>` : ''}</div>
        <div class="det">blk ${e.block.toLocaleString('en-US')} · ${e.from.slice(0, 10)}… → ${e.to.slice(0, 10)}…</div>
      </div>
      <div class="bp">+${e.bps} bps</div>
    </div>`).join('');

  $('#watchboard').innerHTML = `
    <div class="watch">
      <div class="watch-hero">
        <div>
          <div class="watch-state ${head.cls}"><i class="led"></i>${head.state}</div>
          <div class="watch-title">${head.title}</div>
          <p class="watch-sub">${head.sub}</p>
        </div>
        <div class="cd" id="cdunits"></div>
      </div>
      <div class="watch-log">
        <div class="wl-head">
          <div class="t">corporate actions observed on chain</div>
          <div class="fine mono">${DATA.scanned} tokens monitored</div>
        </div>
        ${log}
      </div>
    </div>`;

  countdown();
  if (cdTimer) clearInterval(cdTimer);
  cdTimer = setInterval(countdown, 1000);
}

/* ---------- flow ---------- */
const STEPS = [
  { cb: 'beforeInitialize', h: 'Register the pool', p: 'Detects the ERC-8056 side of the pair, records the multiplier at birth, and refuses any pool that is not dynamic-fee, because the surcharge needs that switch.' },
  { cb: 'beforeAddLiquidity', h: 'Fence the window', p: 'No new liquidity inside an announced pre-rebase window. Loading the pool seconds before a known step is the JIT variant of the same attack.' },
  { cb: 'beforeSwap', h: 'Meter and charge', p: 'Compares the live multiplier to the last one seen. On a step it books <span class="num">reserve × (m₁/m₀ − 1)</span> as a leak budget and surcharges the extracting direction. Reverts outright while <span class="num">oraclePaused()</span>.' },
  { cb: 'afterSwap', h: 'Retire the budget', p: 'Measures what the surcharge actually collected and pays down the budget. Once repaid, fees drop back to base and the pool returns to normal on its own.' }
];

/* ---------- main ---------- */
function render() {
  $('#events').innerHTML = DATA.events.map(e => `
    <div class="evt">
      <div class="evt-top"><span class="evt-tk">${e.ticker}</span><span class="evt-bps">+${e.bps} bps</span></div>
      <div class="evt-sub">block ${e.block.toLocaleString('en-US')} · ${ago(e.ts)}</div>
      <div class="evt-flow">${e.from.slice(0, 12)}… → <b>${e.to.slice(0, 12)}…</b></div>
    </div>`).join('');

  watchboard();

  const worst = DATA.assets.reduce((a, b) => Math.abs(b.drift ?? 0) > Math.abs(a.drift ?? 0) ? b : a);
  $('#rail-drift').textContent = `${worst.drift > 0 ? '+' : '−'}${fmt(Math.abs(worst.drift), 0)} bps · ${worst.ticker}`;
  $('#rail-drift').classList.add('neg');

  $('#flowsteps').innerHTML = STEPS.map((s, i) => `
    <div class="fs">
      <div class="cb">${s.cb}</div>
      <h4>${s.h}</h4>
      <p>${s.p}</p>
      ${i < STEPS.length - 1 ? '<div class="arw">→</div>' : ''}
    </div>`).join('');

  $('#simbody').innerHTML = DATA.sim.map(s => {
    const w = WHY[s.id] || {};
    return `
    <tr class="simrow" data-w="${s.id}" tabindex="0" role="button" aria-expanded="false">
      <td><span class="chev">›</span>${s.id} · ${s.label.split('(')[0].trim()}
        <span class="lbl-sub num">m ${s.m0.toFixed(4)} → ${s.m1.toFixed(4)}</span>
        <span class="prov ${w.kind}">${w.tag || ''}</span></td>
      <td>${fmt(s.ppm / 10000, 2)}%</td>
      <td class="${s.ungArb > 0 ? 'neg' : 'pos'}">${usd(s.ungArb)}</td>
      <td class="${s.gdArb > 0 ? 'neg' : 'pos'}">${usd(s.gdArb)}</td>
      <td class="${s.ungLp >= 0 ? 'pos' : 'neg'}">${usd(s.ungLp)}</td>
      <td class="${s.gdLp >= 0 ? 'pos' : 'neg'}">${usd(s.gdLp)}</td>
    </tr>
    <tr class="whyrow" id="why-${s.id}" hidden><td colspan="6">${whyHTML(s, w)}</td></tr>`;
  }).join('');

  $('#simbody').querySelectorAll('.simrow').forEach(r => {
    const go = () => toggleWhy(r);
    r.onclick = go;
    r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });

  const order = ['all', 'critical', 'warn', 'info', 'ok'];
  $('#filters').innerHTML = order.map(k => {
    const n = k === 'all' ? DATA.assets.length : (DATA.counts[k] || 0);
    return `<button class="filt ${k === filter ? 'on' : ''}" data-f="${k}">${k}<span class="c">${n}</span></button>`;
  }).join('');
  $('#filters').querySelectorAll('.filt').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });

  const rank = { critical: 0, warn: 1, info: 2, ok: 3 };
  $('#rows').innerHTML = DATA.assets
    .filter(a => filter === 'all' || a.sev === filter)
    .sort((a, b) => (rank[a.sev] - rank[b.sev]) || (Math.abs(b.drift ?? 0) - Math.abs(a.drift ?? 0)))
    .map(a => {
      const d = a.drift;
      const dTxt = d == null ? '·' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d), 0)}`;
      const off = a.mult && Math.abs(a.mult - 1) > 1e-9;
      return `<div class="trow" title="${(a.msg || '').replace(/"/g, "'")}">
        <div><span class="tk">${a.ticker}</span></div>
        <div class="nm">${a.name || ''}</div>
        <div class="num" style="${off ? 'color:var(--green-lit)' : 'color:var(--faint)'}">${a.mult ? a.mult.toFixed(8) : '·'}</div>
        <div class="num">${a.feed ? '$' + fmt(a.feed) : '·'}</div>
        <div class="num" style="color:var(--mute)">${a.real ? '$' + fmt(a.real) : '·'}</div>
        <div style="text-align:right"><span class="pill p-${a.sev}">${dTxt}</span></div>
      </div>`;
    }).join('');

  const when = new Date(DATA.generatedAt * 1000).toISOString().replace('T', ' ').slice(0, 16);
  $('#scanmeta').textContent = `chain ${DATA.chainId} · ${DATA.scanned} tokens with a canonical feed · scanned ${when} UTC · drift in bps against feed = spot × uiMultiplier`;
  $('#foot').textContent = `chain ${DATA.chainId} · scan ${when} UTC`;

  auction();
  bgLoop();
  license();
  dayLine();
  io();
}

/* ---------- auction, priced against the same simulator ---------- */
let scn = 'S3';

function auction() {
  const el = document.querySelector('#aucscn');
  if (!el) return;

  el.innerHTML = DATA.sim.map(s => {
    const short = s.id === 'S3' ? '4-for-1 split'
      : s.id === 'S1' ? 'CCL dividend' : 'small dividend';
    return `<button class="scnb ${s.id === scn ? 'on' : ''}" data-s="${s.id}">${short}</button>`;
  }).join('');
  el.querySelectorAll('.scnb').forEach(b => b.onclick = () => { scn = b.dataset.s; auction(); });

  const sl = document.querySelector('#bidsl');
  sl.oninput = paint;
  paint();
}

function paint() {
  const s = DATA.sim.find(x => x.id === scn);
  const maxBid = Math.max(0, s.ungArb - Math.max(s.gdArb, 0));  // winner's willingness to pay
  const need   = s.gdLp - s.ungLp;                              // bid that matches the surcharge for LPs
  const pct    = Number(document.querySelector('#bidsl').value) / 100;

  // slider spans the space a rational bidder could occupy, up to what LPs need
  const span = Math.max(maxBid, need, 1);
  const bid  = pct * span;

  const fallback = Math.max(s.gdArb, 0);        // what the bidder makes anyway, paying the surcharge
  const wNet  = (s.ungArb - bid) - fallback;    // edge over simply not bidding
  const lpAuc = s.ungLp + bid;

  $('#bidval').textContent = usd(bid);
  $('#wnet').textContent   = usd(wNet);
  $('#wnet').className     = 'v ' + (wNet >= 0 ? 'pos' : 'neg');
  $('#lpauc').textContent  = usd(lpAuc);
  $('#lpauc').className    = 'v ' + (lpAuc >= s.gdLp ? 'pos' : 'neg');
  $('#lpsur').textContent  = usd(s.gdLp);
  $('#maxbid').textContent = usd(maxBid);
  $('#wsub').textContent   = bid > maxBid
    ? 'negative: they do better paying the surcharge and not bidding'
    : 'edge over their fallback: trade anyway and pay the surcharge';

  const v = $('#verdict'), vh = $('#vh'), vp = $('#vp');
  const viable = maxBid > need;
  v.className = 'verdict ' + (viable ? 'good' : 'bad');
  if (viable) {
    vh.textContent = 'auction clears';
    vp.innerHTML = `A bidder would pay up to <span class="num">${usd(maxBid)}</span> and LPs need <span class="num">${usd(need)}</span> to be no worse off than the surcharge. There is a clearing range.`;
  } else {
    vh.textContent = 'no clearing price exists';
    vp.innerHTML = `LPs need <span class="num">${usd(need)}</span> to match the surcharge. No bidder rationally pays more than <span class="num">${usd(maxBid)}</span>, that is their entire profit. The gap is <span class="num">${usd(need - maxBid)}</span>, and it cannot be closed by tuning: the surcharge taxes gross flow, a bid can only ever come out of net profit.`;
  }

  const tot = Math.max(need, maxBid) || 1;
  $('#gapbar').innerHTML =
    `<i class="a" style="width:${(Math.min(maxBid, need) / tot * 100).toFixed(1)}%"></i>` +
    `<i class="b" style="width:${(Math.abs(need - maxBid) / tot * 100).toFixed(1)}%"></i>`;
  $('#gaplab').innerHTML = `<span class="num">${usd(maxBid)}</span> the auction can raise · ` +
    `<span class="num">${usd(Math.max(0, need - maxBid))}</span> it falls short by · scenario ${s.id}`;

  const split = DATA.sim.find(x => x.id === 'S3');
  $('#bondnum').textContent = usd(split.gdLp - split.ungLp);
}

function io() {
  const obs = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('in')), { threshold: .06 });
  document.querySelectorAll('section > .wrap > *, .card, .fs, .closebox').forEach(el => {
    if (!el.classList.contains('reveal')) { el.classList.add('reveal'); obs.observe(el); }
  });
}


/* ---------- seamless crossfaded forest loop ----------
   Two <video> elements playing the same clip offset in time: while A plays out
   its final seconds, B restarts underneath and fades in. Removes the hard cut
   a plain loop attribute leaves behind, without re-encoding the source. */
function bgLoop() {
  const SRC = 'assets/forest-loop.mp4', FADE = 1.6;
  const wrap = document.getElementById('bgvid');
  if (!wrap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.matchMedia('(max-width: 760px)').matches) return;

  const a = document.getElementById('bgA'), b = document.getElementById('bgB');
  [a, b].forEach(v => { v.src = SRC; v.muted = true; v.playsInline = true; });

  a.addEventListener('loadeddata', () => {
    document.body.classList.add('hasvid');
    a.classList.add('vis');
    a.play().catch(() => {});
    let cur = a, nxt = b, armed = false;

    setInterval(() => {
      const d = cur.duration;
      if (!d || isNaN(d)) return;
      if (d - cur.currentTime <= FADE && !armed) {
        armed = true;
        nxt.currentTime = 0;
        nxt.play().catch(() => {});
        nxt.classList.add('vis');
        cur.classList.remove('vis');
        setTimeout(() => { cur.pause(); const t = cur; cur = nxt; nxt = t; armed = false; }, FADE * 1000);
      }
    }, 120);
  }, { once: true });
}


/* ---------- license sheet ---------- */
function license() {
  const btn = document.getElementById('licbtn'), wrap = document.getElementById('licwrap');
  const x = document.getElementById('licx'), pre = document.getElementById('lictext');
  const cp = document.getElementById('liccopy');
  if (!btn || !wrap) return;
  let txt = '';
  fetch('LICENSE').then(r => r.text()).then(t => { txt = t; pre.textContent = t; })
    .catch(() => { pre.textContent = 'LICENSE file unavailable.'; });

  const open = () => { wrap.hidden = false; document.body.style.overflow = 'hidden'; x.focus(); };
  const shut = () => { wrap.hidden = true; document.body.style.overflow = ''; btn.focus(); };
  btn.onclick = open;
  x.onclick = shut;
  wrap.onclick = e => { if (e.target === wrap) shut(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !wrap.hidden) shut(); });
  cp.onclick = () => {
    navigator.clipboard?.writeText(txt).then(() => {
      cp.textContent = 'Copied'; setTimeout(() => cp.textContent = 'Copy license text', 1600);
    }).catch(() => {});
  };
}


/* ---------- weekday-aware eyebrow ----------
   Corporate actions land on trading days, so the weekend gets its own line
   rather than pretending Saturday is a day anything can happen to you. */
function dayLine() {
  const el = document.getElementById('dayeyebrow');
  if (!el) return;
  const d = new Date();
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const wk = d.getDay();
  el.textContent = (wk === 0 || wk === 6)
    ? `Why this matters before ${day} ends`
    : `Why this matters on an ordinary ${day}`;
}
