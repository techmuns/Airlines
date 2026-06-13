/* Airline Demand Monitor — Monthly Detail tab.
   A simplified mirror of the client's Goldman Sachs / IATA workbook: the same
   System / International / Domestic views, the same single-month vs 3-month
   rolling basis, the same regions/countries — presented as ONE clean,
   colour-coded month-by-month matrix (instead of a 120-column sheet), with a
   market-share strip and a one-click monthly CSV download. */
(function (global) {
  'use strict';
  var U = global.ADM.util, el = U.el, HM = global.ADM.heatmap;

  var VIEWS   = [['system', 'System'], ['international', 'International'], ['domestic', 'Domestic']];
  var METRICS = [['rpk', 'RPK', 'Passenger traffic'],
                 ['ask', 'ASK', 'Passenger capacity'],
                 ['plf', 'PLF', 'Load factor']];
  var BASES   = [['m', 'Monthly'], ['r', '3-mo avg']];
  var RANGES  = [['12', '12m'], ['24', '24m'], ['36', '36m'], ['0', 'All']];

  function mlabel(key) { var p = key.split('-'); return U.MON[Number(p[1]) - 1] + ' ' + p[0]; }
  function metricName(m) { return m === 'plf' ? 'Load factor, %' : (m.toUpperCase() + ' YoY, %'); }

  function rolling3(s) {
    return s.map(function (_, i) {
      if (i < 2) return null;
      var a = s[i], b = s[i - 1], c = s[i - 2];
      if (a == null || b == null || c == null) return null;
      return Math.round((a + b + c) / 3 * 10) / 10;
    });
  }

  function build(root, data) {
    var views = data.views;
    var state = { view: 'system', metric: 'rpk', basis: 'm', range: '24' };

    function seg(label, opts, cur, on) {
      return el('div', { class: 'gdm-seg' }, [
        el('span', { class: 'gdm-seg__label' }, [label]),
        el('div', { class: 'gdm-seg__btns' }, opts.map(function (o) {
          return el('button', {
            class: 'gdm-seg__btn' + (o[0] === cur ? ' is-active' : ''),
            type: 'button', onclick: function () { on(o[0]); }
          }, [o[1]]);
        }))
      ]);
    }

    function set(k, val) { state[k] = val; render(); }

    /* series for a group under the current metric + basis */
    function seriesFor(v, group) {
      var s = (v.groups[group] && v.groups[group][state.metric]) || [];
      return state.basis === 'r' ? rolling3(s) : s;
    }

    /* ---- CSV: the current view, every month, every region, all three metrics ---- */
    function exportCSV() {
      var v = views[state.view];
      var head = ['Month', 'Region', 'RPK YoY %', 'ASK YoY %', 'PLF %'];
      var lines = ['IATA monthly traffic detail (' + state.view + ') — source: Goldman Sachs / IATA',
                   head.join(',')];
      v.months.forEach(function (m, i) {
        v.order.forEach(function (g) {
          var grp = v.groups[g];
          function c(metric) { var x = grp[metric] && grp[metric][i]; return x == null ? '' : x; }
          lines.push([m, '"' + g + '"', c('rpk'), c('ask'), c('plf')].join(','));
        });
      });
      var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
      var a = el('a', { href: URL.createObjectURL(blob), download: 'iata-monthly-' + state.view + '.csv' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }

    /* ---- the month × region heatmap matrix ---- */
    function matrixCard() {
      var v = views[state.view];
      var months = v.months, order = v.order;
      var isPlf = state.metric === 'plf';
      var fill = isPlf ? HM.plfClass : HM.yoyClass;
      var fmt = isPlf ? function (x) { return U.fmtPctPlain(x); } : function (x) { return U.fmtPct(x); };

      // rows = most recent N months, newest first
      var n = Number(state.range) || months.length;
      var from = Math.max(0, months.length - n);

      var series = {};
      order.forEach(function (g) { series[g] = seriesFor(v, g); });

      var headCells = [el('th', { class: 'mlab' }, ['Month'])];
      order.forEach(function (g) {
        headCells.push(el('th', { class: 'val' + (g === 'Industry' ? ' is-ind' : '') }, [g]));
      });
      var thead = el('thead', {}, [el('tr', { class: 'sub' }, headCells)]);

      var body = [];
      for (var i = months.length - 1; i >= from; i--) {
        var cells = [el('td', { class: 'mlab' }, [mlabel(months[i])])];
        for (var j = 0; j < order.length; j++) {
          var val = series[order[j]][i];
          cells.push(el('td', {
            class: 'val ' + fill(val) + (order[j] === 'Industry' ? ' is-ind' : '')
          }, [fmt(val)]));
        }
        body.push(el('tr', {}, cells));
      }
      var table = el('table', { class: 'hm detail-mtx' }, [thead, el('tbody', {}, body)]);

      var title = el('div', { class: 'section-head__title' }, [
        el('span', { class: 'ico', html: U.ICONS.grid }),
        'Monthly Traffic Detail — ' + VIEWS.filter(function (x) { return x[0] === state.view; })[0][1]
      ]);
      var note = el('div', { class: 'gdm-sechead-note' }, [
        metricName(state.metric) + (state.basis === 'r' ? ' · 3-month rolling' : '') ]);
      var head = el('div', { class: 'section-head' }, [title, note]);

      return el('section', { class: 'card' }, [
        head, el('div', { class: 'detail-mtx-scroll' }, [table]),
        el('div', { class: 'matrix-note' }, [
          isPlf ? 'Each cell is that region’s passenger load factor for the month. Greener = fuller flights.'
                : 'Each cell is the year-on-year change for the month. Green = growth, red = decline.'
        ])
      ]);
    }

    /* ---- latest-month RPK market-share strip ---- */
    function shareCard() {
      var v = views[state.view];
      var share = v.share_rpk || {};
      var li = months_latest_idx(v);
      var rows = Object.keys(share)
        .filter(function (k) { return k !== 'Total'; })
        .map(function (k) { return { k: k, val: share[k][li] }; })
        .filter(function (r) { return r.val != null; })
        .sort(function (a, b) { return b.val - a.val; });
      if (!rows.length) return null;
      var max = rows[0].val || 1;

      var list = el('div', { class: 'detail-share' }, rows.map(function (r) {
        return el('div', { class: 'detail-share__row' }, [
          el('div', { class: 'detail-share__name' }, [r.k]),
          el('div', { class: 'detail-share__track' }, [
            el('div', { class: 'detail-share__bar', style: 'width:' + (r.val / max * 100) + '%' })
          ]),
          el('div', { class: 'detail-share__val num' }, [U.fmtPctPlain(r.val)])
        ]);
      }));

      var total = (share.Total && share.Total[li] != null) ? U.fmtPctPlain(share.Total[li]) : null;
      var title = el('div', { class: 'section-head__title' }, [
        el('span', { class: 'ico', html: U.ICONS.bars }),
        'Share of World RPK'
      ]);
      var note = el('div', { class: 'gdm-sechead-note' }, [
        mlabel(v.months[li]) + (total ? ' · view = ' + total + ' of world' : '') ]);
      return el('section', { class: 'card' }, [
        el('div', { class: 'section-head' }, [title, note]),
        el('div', { class: 'card__pad' }, [list])
      ]);
    }

    function months_latest_idx(v) { return v.months.length - 1; }

    /* ---- controls bar ---- */
    function controls() {
      var bar = el('div', { class: 'gdm-controls' }, [
        seg('View', VIEWS.map(function (x) { return [x[0], x[1]]; }), state.view, function (val) { set('view', val); }),
        seg('Metric', METRICS.map(function (x) { return [x[0], x[1]]; }), state.metric, function (val) { set('metric', val); }),
        seg('Basis', BASES, state.basis, function (val) { set('basis', val); }),
        seg('Range', RANGES, state.range, function (val) { set('range', val); })
      ]);
      var dl = el('button', { class: 'header-iconbtn', type: 'button',
        title: 'Download this view as a spreadsheet (CSV)', onclick: exportCSV }, [
        el('span', { class: 'ico', html: U.ICONS.trend }), 'Download CSV'
      ]);
      var meta = el('div', { class: 'gdm-controlbar__meta' }, [
        el('span', { class: 'ico', html: U.ICONS.calendar }),
        'Goldman Sachs / IATA · monthly'
      ]);
      return el('section', { class: 'card gdm-controlbar' }, [
        el('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap' }, [meta, dl]),
        bar
      ]);
    }

    function intro() {
      return el('div', { class: 'detail-intro' }, [
        el('div', { class: 'section-head__title' }, [
          el('span', { class: 'ico', html: U.ICONS.grid }), 'Monthly Detail'
        ]),
        el('div', { class: 'gdm-sechead-note' }, [
          'System · International · Domestic — the client view, month by month'
        ])
      ]);
    }

    function footer() {
      return el('div', { class: 'source-note' }, [
        el('span', {}, [el('b', {}, ['Source: ']), data._meta.source]),
        el('span', {}, [el('b', {}, ['Window: ']), data._meta.window_from + ' to ' + data._meta.latest]),
        el('span', {}, [el('b', {}, ['Updates: ']),
          'System refreshes automatically each month from the IATA report; ' +
          'International and Domestic come from the client workbook.']),
        el('span', {}, ['Russian domestic figures end Feb 2022 (no longer reported).'])
      ]);
    }

    function render() {
      root.innerHTML = '';
      var cards = [intro(), controls(), matrixCard(), shareCard(), footer()].filter(Boolean);
      root.appendChild(el('div', { class: 'gdm-stack' }, cards));
    }

    render();
    return { initCharts: function () {} };   // no Chart.js; nothing to (re)draw on activate
  }

  global.ADM = global.ADM || {};
  global.ADM.detail = { build: build };
})(window);
