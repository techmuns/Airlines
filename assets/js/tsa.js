/* Airline Demand Monitor — TAB 1: TSA Overview.
   TSA checkpoint passenger throughput only (no IATA / regional data here). */
(function (global) {
  'use strict';

  var U = global.ADM.util, C = global.ADM.calc, CH = global.ADM.charts,
      HM = global.ADM.heatmap, el = U.el, I = U.ICONS;

  function isoWeek(iso) {
    var d = U.parseISO(iso), day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    var firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - firstThu) / 864e5 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  }
  function priorYear(iso) { return (Number(iso.slice(0, 4)) - 1) + iso.slice(4); }
  function rangeDaily(arr, getDate) {
    return U.fmtDateLong(getDate(arr[0])) + ' – ' + U.fmtDateLong(getDate(arr[arr.length - 1]));
  }

  function kpi(opts) {
    var inner = [];
    if (opts.icon) {
      inner.push(el('div', { class: 'kpi__tile', html: opts.icon }));
    }
    inner.push(el('div', {}, [
      el('div', { class: 'kpi__label', text: opts.label }),
      el('div', { class: 'kpi__value num ' + (opts.tone || ''), text: opts.value }),
      el('div', { class: 'kpi__sub num', text: opts.sub })
    ]));
    return el('div', { class: 'kpi' }, inner);
  }

  function chartCard(title, sub, icon, exhibit) {
    var canvas = el('canvas');
    var head = [];
    if (exhibit != null) head.push(el('div', { class: 'chart-eyebrow', text: 'Exhibit ' + exhibit }));
    head.push(el('div', { class: 'card-title' }, [el('span', { class: 'ico', html: icon || I.bars }), title]));
    head.push(el('div', { class: 'card-sub', text: sub }));
    var card = el('div', { class: 'card chart-card' }, [
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
    var data = C.enrichTSA(raw.days.slice());
    var days = data.days;
    var latest = days[days.length - 1];
    var prev = days[days.length - 2];

    /* provenance: which days are real TSA figures vs synthetic sample */
    var REAL = {};
    ((raw._meta && raw._meta.real_days) || []).forEach(function (d) { REAL[d] = true; });
    var realCount = Object.keys(REAL).length;
    var realFrom = raw._meta && raw._meta.real_from;
    var srcLabel = realCount
      ? (realCount + ' of ' + days.length + ' days are real TSA data'
         + (realFrom ? ' (from ' + U.fmtDateLong(realFrom) + ')' : ''))
      : 'sample data';

    /* ---- A. Hero KPI strip ---- */
    var heroRow = el('div', { class: 'hero__row' }, [
      kpi({ icon: I.people, label: 'Latest Passenger Count',
            value: U.fmtInt(latest.throughput), sub: U.fmtDateLong(latest.date) }),
      kpi({ label: 'Day-over-Day (DoD)', value: U.fmtPct(latest.dod),
            tone: U.signClass(latest.dod), sub: 'vs ' + U.fmtDateLong(prev.date) }),
      kpi({ label: 'Week-over-Week (WoW)', value: U.fmtPct(latest.wow),
            tone: U.signClass(latest.wow), sub: 'vs ' + U.fmtDateLong(data.shift(latest.date, -7)) }),
      kpi({ label: 'Year-over-Year (YoY)', value: U.fmtPct(latest.yoy),
            tone: U.signClass(latest.yoy), sub: 'vs ' + U.fmtDateLong(priorYear(latest.date)) }),
      kpi({ icon: I.check, label: '7-Day Moving Average (7DMA)',
            value: U.fmtInt(latest.sevenDMA), sub: 'trailing 7 days' })
    ]);
    var hero = el('div', { class: 'card hero' }, [
      heroRow,
      el('div', { class: 'hero__note' }, [
        el('span', { class: 'tsa-src-badge ' + (realCount ? 'is-real' : 'is-sample'), text: srcLabel }),
        el('span', { class: 'ico', html: I.calendar }),
        'Updated daily from TSA.gov; holiday weeks may be delayed.'
      ])
    ]);

    /* ---- B. Charts (prepare data; instantiate lazily) ---- */
    // Monthly BAR exhibits show a trailing window so the per-bar value labels
    // stay legible; the full daily history still powers the line charts and is
    // the year-on-year baseline. ~30 months ≈ the client's Jan-2024-on range.
    var BAR_MONTHS = 30;
    var monthly = C.monthlyAverages(days).slice(-BAR_MONTHS);
    var ymAll = raw.yoy_monthly;         // published monthly YoY series (exhibit)
    var ym = { months: ymAll.months.slice(-BAR_MONTHS), values: ymAll.values.slice(-BAR_MONTHS) };
    var dmaYoY = raw.yoy_7dma_daily;     // 7DMA-basis YoY series (exhibit)

    var c1 = chartCard('TSA Passenger Throughput, YoY %',
      U.fmtMonthLong(ym.months[0]) + ' – ' + U.fmtMonthLong(ym.months[ym.months.length - 1]), I.bars, 3);
    var c2 = chartCard('TSA Passenger Throughput, YoY % — 7DMA Basis',
      '7DMA basis · ' + rangeDaily(dmaYoY, function (d) { return d.date; }), I.trend, 4);
    var c3 = chartCard('Daily TSA Passenger Count',
      '7-day moving average · ' + rangeDaily(days, function (d) { return d.date; }), I.trend, 5);
    var c4 = chartCard('Monthly Average TSA Passenger Count',
      U.fmtMonthLong(monthly[0].key) + ' – ' + U.fmtMonthLong(monthly[monthly.length - 1].key), I.bars, 6);

    var charts = el('div', { class: 'grid charts-2x2' }, [c1.card, c2.card, c3.card, c4.card]);

    /* ---- C. Daily table ---- */
    var head = el('tr', {}, ['Date','Passenger Numbers','DoD %','WoW %','YoY %','7DMA','Month','Week']
      .map(function (h) { return el('th', { text: h }); }));
    var tbody = el('tbody');
    days.slice().reverse().forEach(function (d) {
      function pctCell(v) { return el('td', { class: 'pct ' + U.signClass(v), text: U.fmtPct(v) }); }
      var isReal = !!REAL[d.date];
      tbody.appendChild(el('tr', { class: isReal ? 'is-real' : 'is-sample',
        title: isReal ? 'Real TSA figure' : 'Sample data' }, [
        el('td', { class: 'date' }, [
          el('span', { class: 'tsa-src-dot ' + (isReal ? 'is-real' : 'is-sample') }),
          U.fmtDateLong(d.date)
        ]),
        el('td', { class: 'strong num', text: U.fmtInt(d.throughput) }),
        pctCell(d.dod), pctCell(d.wow), pctCell(d.yoy),
        el('td', { class: 'num', text: U.fmtInt(d.sevenDMA) }),
        el('td', { text: U.fmtMonthShort(U.monthKeyOf(d.date)) }),
        el('td', { class: 'num', text: isoWeek(d.date) })
      ]));
    });
    var tableCard = el('div', { class: 'card' }, [
      el('div', { class: 'section-head' }, [
        el('div', { class: 'section-head__title' }, [el('span', { class: 'ico', html: I.bars }), 'TSA Checkpoint Travel Numbers (Daily)'])
      ]),
      el('div', { class: 'table-scroll' }, [
        el('table', { class: 'data' }, [el('thead', {}, [head]), tbody])
      ]),
      el('div', { class: 'table-foot' }, [
        el('span', {}, [el('b', { text: 'Source: ' }), 'TSA.gov']),
        el('span', { text: 'Note: Holiday weeks may be delayed. Data is for checkpoint travel only.' })
      ])
    ]);

    /* ---- D. Calendar heatmap ---- */
    var legend = el('div', { class: 'legend' }, [
      el('span', { class: 'legend__item' }, [legendSwatch('var(--hm-strong-pos)'), 'High']),
      el('span', { class: 'legend__item' }, [legendSwatch('var(--hm-neutral)'), 'Normal']),
      el('span', { class: 'legend__item' }, [legendSwatch('var(--hm-strong-neg)'), 'Low'])
    ]);
    var calCard = el('div', { class: 'card' }, [
      el('div', { class: 'section-head' }, [
        el('div', { class: 'section-head__title' }, [el('span', { class: 'ico', html: I.calendar }), 'TSA Passenger Traffic Heatmap (Daily)']),
        legend
      ]),
      HM.buildCalendar({ byDate: data.byDate, dates: days.map(function (d) { return d.date; }) })
    ]);

    var split = el('div', { class: 'grid tsa-split' }, [tableCard, calCard]);

    /* ---- E. Key takeaways ---- */
    var vs7 = C.pctChange(latest.throughput, latest.sevenDMA);
    var takeaways = el('div', { class: 'grid insights' }, [
      insight(I.people, 'Latest passenger level',
        'Checkpoint volume reached <b>' + U.fmtInt(latest.throughput) + '</b> on <b>' +
        U.fmtDateLong(latest.date) + '</b>, ' +
        (vs7 >= 0 ? 'above' : 'below') + ' its 7-day average of <b>' + U.fmtInt(latest.sevenDMA) + '</b>.'),
      insight(I.trend, 'Short-term trend',
        'Day-over-day <b>' + U.fmtPct(latest.dod) + '</b> and week-over-week <b>' + U.fmtPct(latest.wow) +
        '</b> versus the same weekday last week.'),
      insight(I.bars, '7DMA / YoY momentum',
        'Traffic is running <b>' + U.fmtPct(latest.yoy) + '</b> year-over-year, with the 7-day average at <b>' +
        U.fmtInt(latest.sevenDMA) + '</b>.')
    ]);

    var footer = el('div', { class: 'source-note' }, [
      el('span', {}, [el('b', { text: 'Source: ' }), 'TSA.gov checkpoint travel numbers.']),
      el('span', { text: 'DoD / WoW / YoY and 7-day moving average are derived from daily checkpoint counts.' })
    ]);

    root.appendChild(el('div', { class: 'stack' }, [hero, charts, split, takeaways, footer]));

    /* ---- lazy chart init (canvas must be visible to size correctly) ---- */
    var done = false;
    function initCharts() {
      if (done) return; done = true;
      var pctY = function (v) { return v + '%'; };
      var milY = function (v) { return (v / 1e6).toFixed(1); };
      var monthX = function (v) { return U.fmtMonthShort(this.getLabelForValue(v).slice(0, 7)); };
      var dayTitle = function (c) { return U.fmtDateLong(c[0].label); };

      // Exhibit: TSA Passenger Throughput, YoY % (monthly bars + value labels)
      CH.barChart(c1.canvas, ym.months.map(U.fmtMonthShort), ym.values, {
        color: CH.barColors(ym.values), yMin: -3, yMax: 10, yCallback: pctY, yTitle: 'YoY %', maxBar: 16,
        barLabels: { display: true, size: 8.5, color: CH.INK.label, formatter: function (v) { return v.toFixed(1); } },
        tooltip: { label: function (c) { return c.raw.toFixed(1) + '%'; } }
      });

      // Exhibit: same, 7DMA basis (daily line)
      CH.lineChart(c2.canvas, dmaYoY.map(function (d) { return d.date; }),
        dmaYoY.map(function (d) { return d.value; }), {
        color: CH.INK.blue, width: 1.9, yCallback: pctY, yTitle: 'YoY %', xCallback: monthX,
        tooltip: { title: dayTitle, label: function (c) { return c.raw == null ? '—' : c.raw.toFixed(1) + '%'; } }
      });

      CH.lineChart(c3.canvas, days.map(function (d) { return d.date; }),
        days.map(function (d) { return d.sevenDMA; }), {
        color: CH.INK.blue, fill: true, width: 2.2, yMin: 0,
        yCallback: milY, yTitle: 'Millions', xCallback: monthX,
        tooltip: { title: dayTitle, label: function (c) { return U.fmtInt(c.raw); } } });

      CH.barChart(c4.canvas, monthly.map(function (m) { return U.fmtMonthShort(m.key); }),
        monthly.map(function (m) { return m.avg; }), {
        color: CH.barColors(monthly.map(function (m) { return m.avg; })), yMin: 0, yCallback: milY, yTitle: 'Millions', maxBar: 16,
        barLabels: { display: true, size: 8.5, color: CH.INK.label, formatter: function (v) { return (v / 1e6).toFixed(1); } },
        tooltip: { label: function (c) { return U.fmtInt(c.raw); } } });
    }

    return { initCharts: initCharts };
  }

  function legendSwatch(color) {
    return el('span', { class: 'legend__swatch', style: 'background:' + color });
  }

  global.ADM.tsa = { build: build };
})(window);
