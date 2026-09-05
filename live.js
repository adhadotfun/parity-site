/* live.js · Parity board, read live from chain 4663 on every page load.
 *
 * The board used to render a static snapshot committed at deploy time, which
 * went stale within hours while the copy claimed the numbers were reads. The
 * chain RPC serves access-control-allow-origin: *, so the browser can do the
 * whole scan itself. This file patches window.fetch so that app.js's existing
 * fetch('data.json') is answered by a live Multicall3 round trip instead.
 *
 * app.js is untouched. If anything here fails we fall through to the static
 * file, so the board degrades to the old behaviour rather than to nothing.
 *
 * Two of the three legs are on-chain and therefore live: the ERC-8056
 * multiplier state, and the Chainlink feed. The third leg, the real underlying
 * equity price, needs a keyed API and ships as a snapshot in registry.json.
 * window.PARITY_SPOT_AT carries its timestamp so the UI can say so honestly.
 */
(function () {
  'use strict';

  var RPCS = [
    'https://rpc.mainnet.chain.robinhood.com',
    'https://robinhood-rpc.publicnode.com'
  ];
  var MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
  var AGGREGATE3 = '0x82ad56cb';

  var SEL = {
    uiMultiplier:    '0xa60bf13d',
    newUIMultiplier: '0xdc767007',
    effectiveAt:     '0x97a4064f',
    oraclePaused:    '0x7706ba52',
    totalSupply:     '0x18160ddd',
    latestRoundData: '0xfeaf968c'
  };

  var TOKEN_CALLS = ['uiMultiplier', 'newUIMultiplier', 'effectiveAt', 'oraclePaused', 'totalSupply'];

  /* ---------- ABI helpers, lifted verbatim from vault.js ---------- */
  var strip   = function (h) { return String(h).replace(/^0x/, ''); };
  var pad     = function (h) { return strip(h).padStart(64, '0'); };
  var encAddr = function (a) { return pad(a.toLowerCase()); };
  var encUint = function (n) { return pad(BigInt(n).toString(16)); };

  function encodeAggregate3(calls) {
    var n = calls.length;
    var structs = calls.map(function (c) {
      var data = strip(c.data);
      var len  = data.length / 2;
      var body = data.padEnd(Math.ceil(len / 32) * 64, '0');
      return encAddr(c.to) + encUint(1) + encUint(96) + encUint(len) + body;
    });
    var heads = '', tails = '', cursor = n * 32;
    structs.forEach(function (s) {
      heads += encUint(cursor);
      cursor += s.length / 2;
      tails += s;
    });
    return AGGREGATE3 + encUint(32) + encUint(n) + heads + tails;
  }

  function decodeAggregate3(hex) {
    var h = strip(hex);
    var n = parseInt(h.slice(64, 128), 16);
    var out = [];
    for (var i = 0; i < n; i++) {
      var off   = parseInt(h.slice(128 + i * 64, 128 + (i + 1) * 64), 16) * 2;
      var base  = 128 + off;
      var ok    = parseInt(h.slice(base, base + 64), 16) === 1;
      var dOff  = parseInt(h.slice(base + 64, base + 128), 16) * 2;
      var dBase = base + dOff;
      var dLen  = parseInt(h.slice(dBase, dBase + 64), 16);
      out.push({ ok: ok, data: '0x' + h.slice(dBase + 64, dBase + 64 + dLen * 2) });
    }
    return out;
  }

  function word(hex, i) {
    var h = strip(hex);
    var chunk = h.slice(i * 64, (i + 1) * 64);
    return chunk.length === 64 ? BigInt('0x' + chunk) : null;
  }

  function signed(v) {
    if (v === null) return null;
    var LIM = 1n << 255n;
    return v >= LIM ? v - (1n << 256n) : v;
  }

  /* ---------- transport ---------- */
  var nativeFetch = window.fetch.bind(window);
  var reqId = 0;

  function rpcCall(to, data) {
    var body = JSON.stringify({
      jsonrpc: '2.0', id: ++reqId, method: 'eth_call',
      params: [{ to: to, data: data }, 'latest']
    });
    var attempt = function (i) {
      if (i >= RPCS.length) return Promise.reject(new Error('all RPC nodes unreachable'));
      return nativeFetch(RPCS[i], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body
      }).then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.error) throw new Error(j.error.message || 'rpc error');
          return j.result;
        })
        .catch(function () { return attempt(i + 1); });
    };
    return attempt(0);
  }

  /* Multicall3 in chunks. One 138 call batch works, but a chunked retry keeps
     us alive if a node caps response size. */
  function multicall(calls, size) {
    size = size || calls.length;
    var chunks = [];
    for (var i = 0; i < calls.length; i += size) chunks.push(calls.slice(i, i + size));
    return Promise.all(chunks.map(function (c) {
      return rpcCall(MULTICALL3, encodeAggregate3(c)).then(decodeAggregate3);
    })).then(function (parts) {
      return parts.reduce(function (a, b) { return a.concat(b); }, []);
    });
  }

  /* ---------- severity, ported from the server side scanner ---------- */
  function utc(ts) {
    if (!ts) return 'unset';
    return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }

  function classify(row) {
    var d = row.drift, m = row.mult;
    if (row.paused) {
      return ['critical', 'oraclePaused() is true. The feed is frozen at last known good while a corporate action processes, and pools keep trading against it.'];
    }
    if (row.pending && row.effectiveAt) {
      var pct = m ? (row.newMult / m - 1) * 100 : 0;
      return ['critical', 'Corporate action scheduled: multiplier moves ' + m.toFixed(6) +
        ' to ' + row.newMult.toFixed(6) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(3) +
        '%) at ' + utc(row.effectiveAt) + '.'];
    }
    if (Math.abs(d) >= 250) {
      var implied = (row.feed && row.real) ? row.feed / row.real : 0;
      return ['critical', 'Feed implies multiplier ' + implied.toFixed(6) + ' but chain reports ' +
        m.toFixed(6) + ', ' + (d >= 0 ? '+' : '') + d.toFixed(0) +
        ' bps apart. Feed price and multiplier are out of sync.'];
    }
    if (Math.abs(d) >= 50) {
      return ['warn', 'Feed and multiplier disagree by ' + (d >= 0 ? '+' : '') + d.toFixed(0) +
        ' bps. Inside tolerance, worth watching.'];
    }
    if (Math.abs(d) >= 30) {
      return ['info', 'Minor feed drift of ' + (d >= 0 ? '+' : '') + d.toFixed(0) +
        ' bps, consistent with quote timing.'];
    }
    return ['ok', 'Multiplier at parity (' + m.toFixed(6) + '), feed agrees within ' +
      Math.abs(d).toFixed(0) + ' bps.'];
  }

  /* ---------- the scan ---------- */
  function scan(base) {
    base = base || '';
    var registry, fallback;

    return Promise.all([
      nativeFetch(base + 'registry.json').then(function (r) { return r.json(); }),
      nativeFetch(base + 'data.json').then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function (both) {
      registry = both[0];
      fallback = both[1] || {};

      var toks = registry.tokens || [];
      var calls = [];
      toks.forEach(function (t) {
        TOKEN_CALLS.forEach(function (k) { calls.push({ to: t.addr, data: SEL[k] }); });
      });
      toks.forEach(function (t) {
        calls.push({ to: t.feed, data: SEL.latestRoundData });
      });

      return multicall(calls).catch(function () { return multicall(calls, 40); })
        .then(function (res) { return { toks: toks, res: res }; });
    }).then(function (o) {
      var toks = o.toks, res = o.res, n = toks.length;
      var spot = (registry.spot && registry.spot.px) || {};
      var rows = [];

      toks.forEach(function (t, i) {
        var g = function (k) {
          var r = res[i * TOKEN_CALLS.length + TOKEN_CALLS.indexOf(k)];
          return (r && r.ok && r.data && r.data !== '0x') ? word(r.data, 0) : null;
        };
        var mRaw = g('uiMultiplier');
        if (mRaw === null) return;

        var nRaw = g('newUIMultiplier');
        if (nRaw === null) nRaw = mRaw;
        var eff = g('effectiveAt');
        var pau = g('oraclePaused');
        var sup = g('totalSupply');

        var fr = res[n * TOKEN_CALLS.length + i];
        var feed = 0;
        if (fr && fr.ok && fr.data && fr.data !== '0x') {
          var ans = signed(word(fr.data, 1));
          if (ans !== null) feed = Number(ans) / Math.pow(10, t.feedDec || 8);
        }

        var mult = Number(mRaw) / 1e18;
        var newMult = Number(nRaw) / 1e18;
        var real = spot[t.ticker] || 0;
        var drift = (feed && real && mult) ? (feed / real / mult - 1) * 10000 : 0;

        var row = {
          ticker: t.ticker,
          name: t.name,
          sev: 'ok',
          mult: mult,
          newMult: newMult,
          pending: nRaw !== mRaw,
          effectiveAt: eff === null ? 0 : Number(eff),
          drift: drift,
          feed: feed,
          real: real,
          paused: pau === 1n,
          addr: t.addr,
          supply: sup === null ? 0 : Number(sup) / 1e18,
          msg: ''
        };
        var c = classify(row);
        row.sev = c[0];
        row.msg = c[1];
        rows.push(row);
      });

      var rank = { critical: 0, warn: 1, info: 2, ok: 3 };
      rows.sort(function (a, b) {
        return rank[a.sev] - rank[b.sev] || Math.abs(b.drift) - Math.abs(a.drift);
      });

      var counts = { critical: 0, warn: 0, info: 0, ok: 0 };
      rows.forEach(function (r) { counts[r.sev]++; });

      return {
        generatedAt: Math.floor(Date.now() / 1000),
        chainId: registry.chainId || 4663,
        scanned: rows.length,
        counts: counts,
        assets: rows,
        events: fallback.events || [],
        sim: fallback.sim || {},
        spotAt: (registry.spot && registry.spot.at) || 0
      };
    });
  }

  /* ---------- patch fetch so app.js gets live data with no change ---------- */
  window.PARITY_LIVE = null;

  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (!/(^|\/)data\.json(\?|$)/.test(url)) return nativeFetch(input, init);

    return scan().then(function (d) {
      if (!d.assets.length) throw new Error('live scan returned no assets');
      window.PARITY_LIVE = true;
      window.PARITY_SPOT_AT = d.spotAt;
      return { ok: true, status: 200, json: function () { return Promise.resolve(d); } };
    }).catch(function (e) {
      console.warn('Parity live scan failed, serving the committed snapshot:', e && e.message);
      window.PARITY_LIVE = false;
      return nativeFetch(input, init);
    });
  };

  window.PARITY_SCAN = scan;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { scan: scan, encodeAggregate3: encodeAggregate3, decodeAggregate3: decodeAggregate3 };
  }
})();
