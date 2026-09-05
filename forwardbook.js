/* Forward Book renderer.
 *
 * The board answers "what is the multiplier right now". This answers the
 * question the thesis actually rests on: what is coming, how long is the
 * lead, and what does it cost if nobody is guarding.
 *
 * Four states, in descending order of how much they should worry an LP:
 *   ON_CHAIN        the chain has scheduled the step. Public. No edge left.
 *   ANNOUNCED_ONLY  issuer announced, chain silent. This is the lead window.
 *   UNKNOWN         we could not check. Never rendered as safe.
 *   PROJECTED       cadence guess, badged as a guess, never a call.
 *   CLEAR           nothing announced, nothing pending.
 */
(function () {
  'use strict';

  var STATE_META = {
    ON_CHAIN:       { label: 'scheduled on chain', cls: 'fb-onchain' },
    ANNOUNCED_ONLY: { label: 'announced, not on chain', cls: 'fb-announced' },
    UNKNOWN:        { label: 'could not verify', cls: 'fb-unknown' },
    PROJECTED:      { label: 'projected', cls: 'fb-projected' },
    CLEAR:          { label: 'clear', cls: 'fb-clear' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;',
               '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '·';
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: dp, maximumFractionDigits: dp
    });
  }

  function leadText(d) {
    if (d === null || d === undefined) return '·';
    if (d < 0) return 'landed';
    if (d < 1) return Math.round(d * 24) + 'h';
    return d.toFixed(1) + 'd';
  }

  function money(v) {
    if (v === null || v === undefined || isNaN(v)) return '·';
    return '$' + Number(v).toLocaleString('en-US', {
      minimumFractionDigits: 0, maximumFractionDigits: 0
    });
  }

  function render(d) {
    var rows = (d && d.rows) || [];
    var body = document.getElementById('fb-rows');
    var meta = document.getElementById('fb-meta');
    var lede = document.getElementById('fb-lede');
    if (!body) return;

    // Only the rows that mean something get a table line. Twenty "clear"
    // rows is noise, and the count already says how many there are.
    var shown = rows.filter(function (r) {
      return r.state === 'ON_CHAIN' || r.state === 'ANNOUNCED_ONLY' ||
             r.state === 'UNKNOWN' || r.state === 'PROJECTED';
    });

    if (!shown.length) {
      body.innerHTML = '<div class="fb-empty">Nothing announced and nothing ' +
        'pending across all ' + rows.length + ' tokens. The book is empty, ' +
        'which is what most days look like.</div>';
    } else {
      body.innerHTML = shown.map(function (r) {
        var m = STATE_META[r.state] || STATE_META.CLEAR;
        var isProj = r.state === 'PROJECTED';
        var isUnk = r.state === 'UNKNOWN';
        var big = r.isSplit;

        var link = r.addr
          ? '<a class="fb-tick" href="https://robinhoodchain.blockscout.com/address/' +
            esc(r.addr) + '" target="_blank" rel="noopener">' + esc(r.ticker) + '</a>'
          : '<span class="fb-tick">' + esc(r.ticker) + '</span>';

        return '<div class="fb-row' + (big ? ' fb-big' : '') + '">' +
          '<div>' + link + '</div>' +
          '<div class="fb-name">' + esc(r.name || '') + '</div>' +
          '<div><span class="pill ' + m.cls + '">' + esc(m.label) + '</span></div>' +
          '<div class="fb-detail">' + (isUnk ? 'upstream lookup failed'
                                             : esc(r.detail || '·')) + '</div>' +
          '<div class="num">' + (r.date ? esc(r.date) : '·') + '</div>' +
          '<div class="num">' + leadText(r.leadDays) + '</div>' +
          '<div class="num' + (big ? ' fb-alarm' : '') + '">' +
            (isProj || isUnk ? '·' : num(r.bps, 2)) + '</div>' +
          '<div class="num">' + (isProj || isUnk ? '·' : num(r.ppm, 0)) + '</div>' +
          '<div class="num">' + (isProj || isUnk ? '·' : money(r.leak100k)) + '</div>' +
        '</div>';
      }).join('');
    }

    var c = d.counts || {};
    if (lede) {
      var inbound = d.inbound || 0;
      lede.textContent = inbound === 0
        ? 'No corporate action is inbound on any of the ' + rows.length +
          ' tokenized equities tracked. Most days read exactly like this.'
        : inbound + ' action' + (inbound === 1 ? '' : 's') + ' inbound across ' +
          rows.length + ' tokenized equities. Everything below is either ' +
          'already scheduled on chain or announced by the issuer and not yet ' +
          'scheduled. The second kind is the only one where anyone still has time.';
    }

    if (meta) {
      var parts = [];
      Object.keys(STATE_META).forEach(function (k) {
        if (c[k]) parts.push(c[k] + ' ' + STATE_META[k].label);
      });
      var when = d.generatedAt
        ? new Date(d.generatedAt * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
        : 'unknown';
      var line = parts.join(' · ') + ' · horizon ' + (d.horizonDays || 180) +
                 'd · built ' + when;
      if (d.degraded && d.degraded.length) {
        line += ' · could not verify: ' + d.degraded.join(', ');
      }
      meta.textContent = line;
    }
  }

  function boot() {
    fetch('forward.json?t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        var body = document.getElementById('fb-rows');
        if (body) {
          body.innerHTML = '<div class="fb-empty">Forward book unavailable. ' +
            'Rather than show a stale calendar, it shows nothing.</div>';
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
