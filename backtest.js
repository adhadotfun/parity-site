/* Backtest renderer.
 *
 * The proof table is three scenarios chosen by us. This is 123 events chosen
 * by the market, replayed at the real close on the real ex-date.
 *
 * It reports two recovery rates, never one. Blending them hides the finding
 * that actually matters: the surcharge ceiling recovers everything on a
 * dividend and almost nothing on a 10-for-1 split.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;',
               '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '·';
    return '$' + Number(v).toLocaleString('en-US', {
      minimumFractionDigits: dp === undefined ? 0 : dp,
      maximumFractionDigits: dp === undefined ? 0 : dp
    });
  }

  function num(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '·';
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: dp, maximumFractionDigits: dp
    });
  }

  function row(e) {
    var kind = e.kind === 'split' ? 'bt-split' : 'bt-div';
    var recPct = e.leak > 0 ? (e.recovered / e.leak * 100) : null;
    return '<div class="bt-grid bt-row">' +
      '<div class="num">' + esc(e.ticker) + '</div>' +
      '<div class="bt-name">' + esc(e.name || '') + '</div>' +
      '<div><span class="bt-tag ' + kind + '">' + esc(e.kind) + '</span></div>' +
      '<div class="bt-detail">' + esc(e.detail || '') + '</div>' +
      '<div class="num">' + esc(e.date) + '</div>' +
      '<div class="num">' + num(e.bps, 1) + '</div>' +
      '<div class="num">' + money(e.leak, 0) + '</div>' +
      '<div class="num">' + (recPct === null ? '·' : num(recPct, 1) + '%') + '</div>' +
    '</div>';
  }

  function render(d) {
    var s = d.summary || {};
    var rows = document.getElementById('bt-rows');
    var lede = document.getElementById('bt-lede');
    var meta = document.getElementById('bt-meta');

    if (lede) {
      lede.innerHTML =
        'Every ex-date and every split these ' + num(23, 0) + ' tickers have ' +
        'actually lived through in the last three years, replayed at the real ' +
        'close on the real date. <span class="num">' + num(s.events, 0) +
        '</span> events. <span class="num">' + num(s.dividends, 0) +
        '</span> distributions, <span class="num">' + num(s.splits, 0) +
        '</span> splits. Nothing here is hypothetical except the pool.';
    }

    var stats = document.getElementById('bt-stats');
    if (stats) {
      stats.innerHTML =
        '<div class="card"><div class="n">distributions</div>' +
          '<h3>' + num(s.dividendRecoveryRate, 1) + '% recovered</h3>' +
          '<p>' + num(s.dividends, 0) + ' real ex-dates. Median step ' +
          '<span class="num">' + num(s.medianDividendBps, 2) + ' bps</span>. ' +
          'A step that small asks for a surcharge nowhere near the ceiling, so ' +
          'the guard charges exactly what the step is worth and the transfer ' +
          'stays with the LP. ' + money(s.dividendLeak, 0) + ' of leak, ' +
          money(s.dividendRecovered, 0) + ' held.</p></div>' +
        '<div class="card bt-bad"><div class="n">splits</div>' +
          '<h3>' + num(s.splitRecoveryRate, 1) + '% recovered</h3>' +
          '<p>Two 10-for-1 splits, NVDA and MSTR, both in 2024. A 9,000,000 ppm ' +
          'step against a 200,000 ppm ceiling recovers one part in forty-five. ' +
          money(s.splitLeak, 0) + ' of leak, ' + money(s.splitRecovered, 0) +
          ' held. The guard does not save you from a 10-for-1. It never could.</p></div>' +
        '<div class="card"><div class="n">the blended number</div>' +
          '<h3>' + num(s.recoveryRate, 1) + '% overall</h3>' +
          '<p>Quoting this alone would be dishonest in both directions. ' +
          money(s.worstLeak, 0) + ' of the ' + money(s.totalLeak, 0) +
          ' total is two split days. Strip them and three years of ' +
          'distributions leak ' + money(s.dividendLeak, 0) +
          ' per $100k, all of it recoverable.</p></div>';
    }

    if (rows) {
      var list = (d.top || []).slice(0, 16);
      rows.innerHTML = list.length
        ? list.map(row).join('')
        : '<div class="fb-empty">No events priced.</div>';
    }

    if (meta) {
      var line = 'Replayed ' + num(s.pricedEvents, 0) + ' of ' +
        num(s.events, 0) + ' events over ' + num(d.lookbackDays, 0) +
        ' days · leak quoted per ' + money(d.depth, 0) + ' of depth · ' +
        'surcharge ceiling ' + num(d.feeCeilingPpm, 0) + ' ppm (20%) · ' +
        'closes from TwelveData, walked back to the prior session on holidays';
      if (s.unpriced) line += ' · ' + s.unpriced + ' event(s) had no usable close and are counted but not priced';
      if (d.degraded && d.degraded.length) line += ' · could not fetch: ' + d.degraded.join(', ');
      meta.textContent = line;
    }
  }

  function boot() {
    fetch('backtest.json?t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        var rows = document.getElementById('bt-rows');
        if (rows) {
          rows.innerHTML = '<div class="fb-empty">Backtest unavailable. ' +
            'Rather than show invented history, it shows nothing.</div>';
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
