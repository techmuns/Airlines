/* Airline Demand Monitor — TAB 2: Airline Traffic & Regional.
   IATA global & regional RPK / ASK / PLF (no TSA daily data here). */
(function (global) {
  'use strict';

  var U = global.ADM.util, C = global.ADM.calc, CH = global.ADM.charts,
      HM = global.ADM.heatmap, el = U.el, I = U.ICONS;

  function regionIcon(r) { return r === 'Industry' ? I.globe : I.pin; }

  function summarise(raw) {
    var s = {};
    raw.regions.forEach(function (r) {
      var plf = raw.series.plf[r];
      s[r] = {
        rpk: C.summarise(raw.series.rpk_yoy[r]),
        ask: C.summarise(raw.series.ask_yoy[r]),
        plf: { latest: C.lastValid(plf), m3: C.trailingMean(plf, 3), m12: C.trailingMean(plf, 12) },
        share: raw.market_share[r]
      };
    });
    return s;
  }

  // a coloured value cell
  function valCell(value, cls, opts) {
    opts = opts || {};
    var text = value == null ? '—'
      : (opts.pct ? U.fmtPctPlain(value, opts.dp) : value.toFixed(opts.dp == null ? 1 : opts.dp));
    return el('td', { class: 'val ' + cls + (opts.span ? '' : ''), colspan: opts.span || null, text: text });
  }

  function heroChart(title, sub, exhibit) {
    var canvas = el('canvas');
    var head = [];
    if (exhibit != null) head.push(el('div', { class: 'chart-eyebrow', text: 'Exhibit ' + exhibit }));
    head.push(el('div', { class: 'card-title' }, [el('span', { class: 'ico', html: I.globe }), title]));
    head.push(el('div', { class: 'card-sub', text: sub }));
    var card = el('div', { class: 'card chart-card hero-chart' }, [
      el('div', {}, head),
      el('div', { class: 'chart-card__canvas' }, [canvas])
    ]);
    return { card: card, canvas: canvas };
  }

  function insight(icon, title, body) {
    return el('div', { class: 'card insight' }, [
      el('div', { class: 'insight__icon', html: icon }),
      el('div', {}, [
        el('div', { class: 'insight__title', text: title }),
        el('div', { class: 'insight__body', html: body })
      ])
    ]);
  }

  function build(root, raw) {
    var months = raw.months;
    var monthLabels = months.map(U.fmtMonthShort);
    var S = summarise(raw);
    var rangeSub = U.fmtMonthLong(months[0]) + ' – ' + U.fmtMonthLong(months[months.length - 1]);

    /* ---- A. Hero charts ---- */
    var h1 = heroChart('IATA Global System Airline Traffic, YoY %', rangeSub, 1);
    var h2 = heroChart('IATA Global Airline Domestic & International Traffic, YoY %', rangeSub, 2);
    var heroCharts = el('div', { class: 'grid charts-2' }, [h1.card, h2.card]);

    /* ---- B. Regional Performance Snapshot ---- */
    var snapGrp = el('tr', { class: 'grp' }, [
      el('th', { class: 'spacer rowlab', text: 'Region' }),
      el('th', { colspan: 2, text: 'RPK (YoY %)' }),
      el('th', { colspan: 2, text: 'ASK (YoY %)' }),
      el('th', { colspan: 2, text: 'PLF (%)' }),
      el('th', { text: 'PLF 12M' })
    ]);
    var snapSub = el('tr', { class: 'sub' }, ['', 'Latest Month', '3M Rolling', 'Latest Month',
      '3M Rolling', 'Latest %', '3M Rolling %', '12-mo avg'].map(function (t, i) {
      return el('th', { class: i === 0 ? 'rowlab' : '', text: t });
    }));
    var snapBody = el('tbody');
    raw.regions.forEach(function (r) {
      var d = S[r];
      var row = el('tr', { class: r === 'Industry' ? 'is-industry' : '' }, [
        el('td', { class: 'rowlab' }, [el('span', { class: 'ico', html: regionIcon(r) }), r]),
        valCell(d.rpk.latest, HM.yoyClass(d.rpk.latest), { pct: true }),
        valCell(d.rpk.m3, HM.yoyClass(d.rpk.m3), { pct: true }),
        valCell(d.ask.latest, HM.yoyClass(d.ask.latest), { pct: true }),
        valCell(d.ask.m3, HM.yoyClass(d.ask.m3), { pct: true }),
        valCell(d.plf.latest, HM.plfClass(d.plf.latest), { pct: true }),
        valCell(d.plf.m3, HM.plfClass(d.plf.m3), { pct: true }),
        valCell(d.plf.m12, HM.plfClass(d.plf.m12), { pct: true })
      ]);
      snapBody.appendChild(row);
    });
    var snapshot = el('div', { class: 'card' }, [
      el('div', { class: 'section-head' }, [
        el('div', { class: 'section-head__title' }, [el('span', { class: 'ico', html: I.bars }), 'Regional Performance Snapshot'])
      ]),
      el('div', { class: 'hm-wrap' }, [
        el('table', { class: 'hm' }, [el('thead', {}, [snapGrp, snapSub]), snapBody])
      ])
    ]);

    /* ---- C. Detailed Categorised Performance Matrix ---- */
    var mGrp = [el('th', { class: 'spacer rowlab', text: 'Metric' })];
    var mSub = [el('th', { class: 'rowlab', text: '' })];
    raw.regions.forEach(function (r) {
      mGrp.push(el('th', { colspan: 2, text: r }));
      mSub.push(el('th', { text: 'Latest %' }));
      mSub.push(el('th', { text: '3M Rolling' }));
    });
    var mBody = el('tbody');
    function metricRow(label, getPair, colorFn, pct) {
      var cells = [el('td', { class: 'rowlab', text: label })];
      raw.regions.forEach(function (r) {
        var p = getPair(S[r]);
        cells.push(valCell(p[0], colorFn(p[0]), { pct: pct }));
        cells.push(valCell(p[1], colorFn(p[1]), { pct: pct }));
      });
      mBody.appendChild(el('tr', {}, cells));
    }
    function spanRow(label, getVal, colorFn, pct) {       // one value per region (colspan 2)
      var cells = [el('td', { class: 'rowlab', text: label })];
      raw.regions.forEach(function (r) {
        var v = getVal(S[r]);
        cells.push(valCell(v, colorFn ? colorFn(v) : 'fill-none', { pct: pct, span: 2 }));
      });
      mBody.appendChild(el('tr', {}, cells));
    }
    metricRow('RPK (YoY %)', function (d) { return [d.rpk.latest, d.rpk.m3]; }, HM.yoyClass, true);
    metricRow('ASK (YoY %)', function (d) { return [d.ask.latest, d.ask.m3]; }, HM.yoyClass, true);
    metricRow('PLF (%)', function (d) { return [d.plf.latest, d.plf.m3]; }, HM.plfClass, true);
    spanRow('PLF (12M)', function (d) { return d.plf.m12; }, HM.plfClass, true);
    spanRow('RPK Market Share (%)', function (d) { return d.share; }, function () { return 'fill-none'; }, true);

    var matrix = el('div', { class: 'card' }, [
      el('div', { class: 'section-head' }, [
        el('div', { class: 'section-head__title' }, [el('span', { class: 'ico', html: I.grid }), 'Detailed Categorised Performance Matrix'])
      ]),
      el('div', { class: 'hm-scroll' }, [
        el('table', { class: 'hm' }, [el('thead', {}, [el('tr', { class: 'grp' }, mGrp), el('tr', { class: 'sub' }, mSub)]), mBody])
      ]),
      el('div', { class: 'matrix-note', text: 'RPK / ASK shown as year-over-year %. PLF shown as load-factor level %. 3M Rolling = trailing 3-month average. Scroll horizontally to see all regions.' })
    ]);

    /* ---- D. Insight cards (computed) ---- */
    var indRpk = raw.series.rpk_yoy.Industry;
    var lastMonth = U.fmtMonthLong(months[months.length - 1]);
    var streak = 0;
    for (var i = indRpk.length - 1; i >= 0 && indRpk[i] > 0; i--) streak++;
    var dom = C.lastValid(raw.global.domestic_rpk_yoy);
    var intl = C.lastValid(raw.global.international_rpk_yoy);

    var ranked = raw.regions.filter(function (r) { return r !== 'Industry'; })
      .map(function (r) { return { r: r, v: S[r].rpk.latest }; })
      .sort(function (a, b) { return b.v - a.v; });
    var strong = ranked.slice(0, 2).map(function (x) { return x.r; });
    var weak = ranked.slice(-2).map(function (x) { return x.r; });

    var takeaways = el('div', { class: 'grid insights' }, [
      insight(I.trend, 'Global traffic trend',
        'IATA Global System Airline Traffic was <b>' + U.fmtPctPlain(C.lastValid(indRpk)) +
        ' YoY</b> in <b>' + lastMonth + '</b>' +
        (streak > 1 ? ', extending the positive trend for the <b>' + streak + 'th consecutive month</b>.' : '.')),
      insight(I.globe, 'Domestic vs international',
        'International traffic grew <b>' + U.fmtPctPlain(intl) + ' YoY</b> versus domestic <b>' +
        U.fmtPctPlain(dom) + ' YoY</b> in ' + lastMonth + ', with international ' +
        (intl >= dom ? 'outpacing' : 'lagging') + ' domestic.'),
      insight(I.bars, 'Regional divergence',
        '<b>' + strong.join('</b> and <b>') + '</b> lead on RPK growth, while <b>' +
        weak.join('</b> and <b>') + '</b> remain under pressure.')
    ]);

    var footer = el('div', { class: 'source-note' }, [
      el('span', {}, [el('b', { text: 'Source: ' }), 'IATA Economics — Air Passenger Market Analysis.']),
      el('span', { text: 'YoY % compares the same period in the prior year.' }),
      el('span', { text: 'RPK = Revenue Passenger Kilometres · ASK = Available Seat Kilometres · PLF = Passenger Load Factor' })
    ]);

    root.appendChild(el('div', { class: 'stack' }, [heroCharts, snapshot, matrix, takeaways, footer]));

    /* ---- lazy chart init ---- */
    var done = false;
    function initCharts() {
      if (done) return; done = true;
      var pctY = function (v) { return v + '%'; };

      CH.barChart(h1.canvas, monthLabels, indRpk.map(function (v) { return v; }), {
        color: CH.INK.navy, yMin: 0, yMax: 25, yCallback: pctY, yTitle: 'YoY, %', maxBar: 22,
        barLabels: { display: true, size: 8.5, color: CH.INK.navy, formatter: function (v) { return v.toFixed(1); } },
        tooltip: { label: function (c) { return c.raw.toFixed(1) + '%'; } }
      });

      CH.groupedBarChart(h2.canvas, monthLabels, [
        { label: 'Domestic', data: raw.global.domestic_rpk_yoy, color: CH.INK.navy },
        { label: 'International', data: raw.global.international_rpk_yoy, color: CH.INK.blue }
      ], {
        yMin: -5, yMax: 30, yCallback: pctY, yTitle: 'YoY, %',
        barLabels: { display: true, size: 7.5, color: CH.INK.navy, formatter: function (v) { return v; } },
        legend: { display: true, position: 'bottom',
          labels: { boxWidth: 11, boxHeight: 11, padding: 16, color: '#9fb0c7',
                    font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: { label: function (c) { return c.dataset.label + ': ' + c.raw.toFixed(1) + '%'; } }
      });
    }

    return { initCharts: initCharts };
  }

  global.ADM.iata = { build: build };
})(window);
