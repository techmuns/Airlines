/* Airline Demand Monitor — TAB 1 (landing): Global Demand Map.
   A premium dark world map that shows IATA regional airline demand as glowing
   gold bubbles, with a controls bar, regional trend, an all-regions snapshot
   and a comparison table. Regional IATA RPK / ASK / PLF / market share only —
   no TSA data, no country- or airport-level data. */
(function (global) {
  'use strict';

  var U = global.ADM.util, C = global.ADM.calc, HM = global.ADM.heatmap,
      WM = global.ADM.worldMap, Chart = global.Chart,
      el = U.el, I = U.ICONS;

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    return n;
  }

  /* The six IATA reporting regions, with a single representative map anchor
     (longitude / latitude) for each. These are regional placements only — the
     data is regional, never country- or airport-level. */
  var REGIONS = ['North America', 'Europe', 'Asia/Pacific', 'Middle East', 'Latin America', 'Africa'];
  var REGIONS_A = REGIONS.slice().sort();          // alphabetical, for tables
  var ANCHORS = {
    'North America': { lon: -98, lat: 44 },
    'Europe':        { lon: 10,  lat: 49 },
    'Asia/Pacific':  { lon: 112, lat: 16 },
    'Middle East':   { lon: 49,  lat: 26 },
    'Latin America': { lon: -61, lat: -14 },
    'Africa':        { lon: 19,  lat: 3 }
  };
  var SHORT = {
    'North America': 'North America', 'Europe': 'Europe', 'Asia/Pacific': 'Asia/Pacific',
    'Middle East': 'Middle East', 'Latin America': 'Latin America', 'Africa': 'Africa'
  };

  var METRIC_LABEL = { rpk: 'RPK YoY', ask: 'ASK YoY', plf: 'PLF', share: 'RPK Market Share' };
  var VIEW_LABEL = { latest: 'Latest Month', m3: '3M Rolling', m12: '12-Month' };

  /* gold ramp (muted -> bright halo), premium / never neon */
  var GOLD_DIM = [150, 128, 74], GOLD_HALO = [236, 196, 110];

  function project(lon, lat) { return { x: (lon + 180) * WM.k, y: (WM.latTop - lat) * WM.ky }; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    return 'rgb(' + Math.round(lerp(c1[0], c2[0], t)) + ',' +
                    Math.round(lerp(c1[1], c2[1], t)) + ',' +
                    Math.round(lerp(c1[2], c2[2], t)) + ')';
  }
  function r1(v) { return Math.round(v * 10) / 10; }

  /* ---- per-region summary across the full monthly series ---- */
  function summarise(raw) {
    var S = {};
    REGIONS.forEach(function (r) {
      var rpk = raw.series.rpk_yoy[r], ask = raw.series.ask_yoy[r], plf = raw.series.plf[r];
      S[r] = {
        rpk: { latest: C.lastValid(rpk), m3: C.trailingMean(rpk, 3), m12: C.trailingMean(rpk, 12), series: rpk },
        ask: { latest: C.lastValid(ask), m3: C.trailingMean(ask, 3), m12: C.trailingMean(ask, 12), series: ask },
        plf: { latest: C.lastValid(plf), m3: C.trailingMean(plf, 3), m12: C.trailingMean(plf, 12), series: plf },
        share: raw.market_share[r]
      };
    });
    return S;
  }

  /* ---- Export: download the regional metrics as a CSV file ---- */
  function exportCSV(raw) {
    var S = summarise(raw);
    function f(v) { return v == null ? '' : v.toFixed(1); }
    var lines = [
      'IATA regional airline traffic - latest month ' + raw.months[raw.months.length - 1],
      'Region,RPK YoY % (latest),RPK YoY % (3M),ASK YoY % (latest),ASK YoY % (3M),' +
      'PLF % (latest),PLF % (3M),PLF % (12M),RPK Market Share %'
    ];
    REGIONS_A.forEach(function (r) {
      var d = S[r];
      lines.push([r, f(d.rpk.latest), f(d.rpk.m3), f(d.ask.latest), f(d.ask.m3),
                  f(d.plf.latest), f(d.plf.m3), f(d.plf.m12), f(d.share)].join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'iata-regional-traffic.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function build(root, raw) {
    var months = raw.months;
    var monthLabels = months.map(U.fmtMonthShort);
    var S = summarise(raw);
    var maxShare = REGIONS.reduce(function (m, r) { return Math.max(m, S[r].share); }, 0);

    var latestKey = months[months.length - 1];
    var latestMonthLong = U.fmtMonthLong(latestKey);
    var rangeSub = U.fmtMonthLong(months[0]) + ' – ' + latestMonthLong;

    /* provenance: which months are real IATA figures vs synthetic sample */
    var REAL = {};
    ((raw._meta && raw._meta.real_months) || []).forEach(function (m) { REAL[m] = true; });
    var realCount = Object.keys(REAL).length;
    var latestIsReal = !!REAL[latestKey];

    /* latest *full* calendar year (for the Year period) */
    var lastMonthNum = Number(latestKey.slice(5, 7));
    var fullYear = lastMonthNum === 12 ? Number(latestKey.slice(0, 4)) : Number(latestKey.slice(0, 4)) - 1;
    var yearIdx = [];
    months.forEach(function (m, i) { if (Number(m.slice(0, 4)) === fullYear) yearIdx.push(i); });

    var state = { metric: 'rpk', view: 'latest', period: 'month', region: 'Asia/Pacific', range: 24 };

    /* ================= map value / encoding logic ================= */
    function seriesFor(r, metric) {
      return metric === 'rpk' ? S[r].rpk.series
           : metric === 'ask' ? S[r].ask.series
           : metric === 'plf' ? S[r].plf.series : null;
    }
    function windowValue(r) {
      if (state.metric === 'share') return S[r].share;
      var series = seriesFor(r, state.metric);
      if (state.period === 'year') {
        var vals = yearIdx.map(function (i) { return series[i]; }).filter(function (v) { return v != null; });
        if (!vals.length) return null;
        return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      }
      if (state.view === 'latest') return C.lastValid(series);
      if (state.view === 'm3') return C.trailingMean(series, 3);
      return C.trailingMean(series, 12);
    }
    function strengthOf(v) {                       // 0 (muted) .. 1 (strong gold)
      if (v == null) return 0;
      if (state.metric === 'plf') return clamp01((v - 74) / 12);
      if (state.metric === 'share') return clamp01(v / maxShare);
      return clamp01((v + 10) / 20);               // YoY −10%..+10%
    }
    function isWeak(v) {                            // soft-red ring trigger
      if (v == null) return false;
      if (state.metric === 'plf') return v < 79;
      if (state.metric === 'share') return false;
      return v < 0;
    }
    function baseRadius(share) { return Math.max(7, 19 * Math.sqrt(share / maxShare)); }

    /* ================= map shell ================= */
    var svgEl = svg('svg', {
      class: 'gdm-map__svg', viewBox: '0 0 ' + WM.width + ' ' + WM.height,
      preserveAspectRatio: 'xMidYMid meet', role: 'img',
      'aria-label': 'World map of regional airline demand'
    });
    svgEl.innerHTML = staticMarkup();
    var bubbleG = svgEl.querySelector('.gdm-bubbles');

    var tipEl = el('div', { class: 'gdm-tooltip', hidden: 'hidden' });
    var mapWrap = el('div', { class: 'gdm-map' }, [svgEl, tipEl]);

    /* floating in-map legend (lower-left) — compact, secondary chart key */
    function legendRow(symCls, text) {
      return el('div', { class: 'gdm-maplegend__row' }, [
        el('span', { class: 'gdm-maplegend__sym ' + symCls }), text
      ]);
    }
    var legendTitle = el('div', { class: 'gdm-maplegend__title' });
    var legendBox = el('div', { class: 'gdm-maplegend' }, [
      legendTitle,
      legendRow('is-size', 'Size · market share'),
      legendRow('is-glow', 'Glow · momentum'),
      legendRow('is-weak', 'Red ring · weak')
    ]);
    mapWrap.appendChild(legendBox);

    var mapCard = el('div', { class: 'card gdm-map-card' }, [mapWrap]);

    /* ================= controls bar (above the map) ================= */
    var metricSeg = segControl('Metric',
      [['rpk', 'RPK'], ['ask', 'ASK'], ['plf', 'PLF'], ['share', 'Market Share']], 'metric');
    var viewSeg = segControl('View',
      [['latest', 'Latest Month'], ['m3', '3M Rolling'], ['m12', '12M']], 'view');
    var periodSeg = segControl('Period', [['month', 'Month'], ['year', 'Year']], 'period');

    var controlBar = el('div', { class: 'card gdm-controlbar' }, [
      el('div', { class: 'gdm-controls' }, [metricSeg.el, viewSeg.el, periodSeg.el]),
      el('div', { class: 'gdm-controlbar__meta' }, [
        el('span', { class: 'gdm-src-tag ' + (latestIsReal ? 'is-real' : 'is-sample'),
          title: latestIsReal ? 'This month is real IATA data' : 'This month is sample data' },
          [latestIsReal ? 'IATA actual' : 'sample']),
        el('span', { class: 'ico', html: I.calendar }),
        'Latest month · ' + latestMonthLong,
        el('span', { class: 'gdm-src-count',
          text: '· ' + realCount + ' of ' + months.length + ' months real' })
      ])
    ]);

    /* ================= lower split: trend + all-regions snapshot ================= */
    var trendCanvas = el('canvas');
    var trendTitle = el('span', { text: 'Regional Trend' });
    var rangeSel = el('select', { class: 'gdm-rangesel', 'aria-label': 'Trend range' }, [
      el('option', { value: '12', text: 'Last 12 Months' }),
      el('option', { value: '24', text: 'Last 24 Months' }),
      el('option', { value: '0', text: 'All Months' })
    ]);
    rangeSel.value = String(state.range);
    rangeSel.addEventListener('change', function () {
      state.range = Number(rangeSel.value);
      updateTrend();
    });
    var trendCard = el('div', { class: 'card chart-card gdm-trend' }, [
      el('div', { class: 'gdm-trend__head' }, [
        el('div', { class: 'card-title' }, [el('span', { class: 'ico', html: I.trend }), trendTitle]),
        rangeSel
      ]),
      el('div', { class: 'chart-card__canvas gdm-trend__canvas' }, [trendCanvas]),
      el('div', { class: 'chart-note', html:
        'Revenue passenger-kilometres (RPK, demand) and available seat-kilometres (ASK, capacity) on the ' +
        'left axis, year-over-year; passenger load factor (PLF, level %) on the right axis. ' +
        '<b>Source:</b> IATA Economics, Air Passenger Market Analysis.' }),
      el('div', { class: 'gdm-srcnote' }, [
        el('span', { class: 'gdm-srcnote__badge' }, [realCount + ' of ' + months.length + ' months are real IATA data']),
        el('span', { class: 'gdm-srcnote__item' }, [el('span', { class: 'gdm-srcnote__dot is-real' }), 'dots = real']),
        el('span', { class: 'gdm-srcnote__item' }, [el('span', { class: 'gdm-srcnote__dash' }), 'dashed = sample (awaiting report)'])
      ])
    ]);

    var snap = buildSnapshot();
    var split = el('div', { class: 'grid gdm-split' }, [trendCard, snap.card]);

    /* ================= regional comparison table ================= */
    var cmp = buildComparison();

    var footer = el('div', { class: 'source-note' }, [
      el('span', {}, [el('b', { text: 'Source: ' }), 'IATA Economics — Air Passenger Market Analysis (regional), ' + rangeSub + '.']),
      el('span', { text: 'Regional data only — no country- or airport-level detail.' }),
      el('span', { text: 'YoY = year over year · 3M = trailing 3-month average · RPK = Revenue Passenger Kilometres · ASK = Available Seat Kilometres · PLF = Passenger Load Factor (level %)' })
    ]);

    root.appendChild(el('div', { class: 'gdm-stack' }, [controlBar, mapCard, split, cmp.card, footer]));

    /* ================= static SVG (bg, graticule, land, dots, vignette) ================= */
    function staticMarkup() {
      var defs = '<defs>' +
        '<radialGradient id="gdmBg" cx="50%" cy="-4%" r="138%">' +
          '<stop offset="0%" stop-color="#102338"/>' +
          '<stop offset="52%" stop-color="#0a1626"/>' +
          '<stop offset="100%" stop-color="#050b14"/>' +
        '</radialGradient>' +
        '<radialGradient id="gdmCore">' +
          '<stop offset="0%" stop-color="#f6eed8"/>' +
          '<stop offset="42%" stop-color="#e3cd92"/>' +
          '<stop offset="80%" stop-color="#bc9a54"/>' +
          '<stop offset="100%" stop-color="#6b5530"/>' +
        '</radialGradient>' +
        '<radialGradient id="gdmVin" cx="50%" cy="48%" r="74%">' +
          '<stop offset="0%" stop-color="#03050b" stop-opacity="0"/>' +
          '<stop offset="66%" stop-color="#03050b" stop-opacity="0"/>' +
          '<stop offset="100%" stop-color="#03050b" stop-opacity="0.6"/>' +
        '</radialGradient>' +
        '<filter id="gdmGlow" x="-70%" y="-70%" width="240%" height="240%">' +
          '<feGaussianBlur stdDeviation="3.2"/>' +
        '</filter>' +
      '</defs>';
      var bg = '<rect x="0" y="0" width="' + WM.width + '" height="' + WM.height + '" fill="url(#gdmBg)"/>';
      var grat = '<g class="gdm-grat">', a, b, lon, lat;
      for (lon = -180; lon <= 180; lon += 30) {
        a = project(lon, WM.latTop); b = project(lon, WM.latBot);
        grat += '<line x1="' + r1(a.x) + '" y1="' + r1(a.y) + '" x2="' + r1(b.x) + '" y2="' + r1(b.y) + '"/>';
      }
      for (lat = -30; lat <= 60; lat += 30) {
        a = project(-180, lat); b = project(180, lat);
        grat += '<line class="' + (lat === 0 ? 'is-eq' : '') + '" x1="' + r1(a.x) + '" y1="' + r1(a.y) +
                '" x2="' + r1(b.x) + '" y2="' + r1(b.y) + '"/>';
      }
      grat += '</g>';
      var land = '<path class="gdm-land" fill-rule="evenodd" d="' + WM.landPath + '"/>';
      // fine halftone texture on the landmass; a sparse few are warm hub sparks
      var dots = '<g class="gdm-dots">' + WM.dots.map(function (p, i) {
        var warm = (i * 5) % 17 === 0;
        return '<circle' + (warm ? ' class="is-warm"' : '') +
               ' cx="' + p[0] + '" cy="' + p[1] + '" r="' + (warm ? 1 : 0.8) + '"/>';
      }).join('') + '</g>';
      var vin = '<rect x="0" y="0" width="' + WM.width + '" height="' + WM.height +
                '" fill="url(#gdmVin)" pointer-events="none"/>';
      return defs + bg + grat + land + dots + vin + '<g class="gdm-bubbles"></g>';
    }

    /* ================= bubbles ================= */
    function bubbleVal(v) {
      if (v == null) return '—';
      return (state.metric === 'rpk' || state.metric === 'ask') ? U.fmtPct(v) : U.fmtPctPlain(v);
    }
    function renderBubbles() {
      while (bubbleG.firstChild) bubbleG.removeChild(bubbleG.firstChild);
      // draw biggest first so smaller bubbles & their labels sit on top
      REGIONS.slice().sort(function (a, b) { return S[b].share - S[a].share; }).forEach(function (r) {
        var p = project(ANCHORS[r].lon, ANCHORS[r].lat);
        var v = windowValue(r), st = strengthOf(v), weak = isWeak(v);
        var R = baseRadius(S[r].share) * (0.84 + 0.22 * st);   // metallic-ring radius
        var glowR = R * 1.3, coreR = R * 0.4;
        var haloCol = mix(GOLD_DIM, GOLD_HALO, st);

        var g = svg('g', { class: 'gdm-bubble' + (state.region === r ? ' is-selected' : ''),
          transform: 'translate(' + r1(p.x) + ',' + r1(p.y) + ')',
          tabindex: '0', role: 'button', 'aria-label': r });

        // controlled halo, a single thin metallic ring, a compact champagne core
        g.appendChild(svg('circle', { r: r1(glowR), fill: haloCol,
          opacity: r1(0.08 + 0.2 * st), filter: 'url(#gdmGlow)' }));
        if (state.region === r) {
          g.appendChild(svg('circle', { class: 'gdm-bubble__sel', r: r1(R + 3.5),
            fill: 'none', stroke: 'rgba(236,222,182,.82)', 'stroke-width': '0.8' }));
        }
        g.appendChild(svg('circle', { r: r1(R), fill: 'none',
          stroke: weak ? 'rgba(190,98,88,.6)' : 'rgba(224,196,132,' + r1(0.38 + 0.34 * st) + ')',
          'stroke-width': weak ? '1' : '0.9' }));
        g.appendChild(svg('circle', { class: 'gdm-bubble__core', r: r1(coreR),
          fill: 'url(#gdmCore)', opacity: r1(0.86 + 0.14 * st) }));

        // side label: region name (caps) + the selected value beneath
        var lx = r1(R + 9);
        var name = svg('text', { class: 'gdm-bubble__name', x: lx, y: '-2.5', 'text-anchor': 'start' });
        name.textContent = SHORT[r].toUpperCase();
        g.appendChild(name);
        var val = svg('text', { class: 'gdm-bubble__val', x: lx, y: '8', 'text-anchor': 'start' });
        val.textContent = bubbleVal(v);
        g.appendChild(val);
        g.appendChild(svg('circle', { class: 'gdm-hit', r: r1(Math.max(R + 8, 15)), fill: 'transparent' }));

        g.addEventListener('mouseenter', function (e) { showTip(r); onMove(e); });
        g.addEventListener('mousemove', onMove);
        g.addEventListener('mouseleave', hideTip);
        g.addEventListener('click', function () { selectRegion(r); });
        g.addEventListener('focus', function () { showTip(r); placeTipAtBubble(p); });
        g.addEventListener('blur', hideTip);
        g.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRegion(r); }
        });
        bubbleG.appendChild(g);
      });
      // re-trigger the soft fade-in so filter changes feel smooth
      bubbleG.style.animation = 'none';
      void bubbleG.getBoundingClientRect();
      bubbleG.style.animation = '';
    }

    /* ================= tooltip ================= */
    function fillTip(r) {
      var d = S[r];
      function row(lab, txt, cls) {
        return el('div', { class: 'gdm-tip__row' }, [
          el('span', { class: 'gdm-tip__lab', text: lab }),
          el('span', { class: 'gdm-tip__val ' + (cls || ''), text: txt })
        ]);
      }
      tipEl.innerHTML = '';
      tipEl.appendChild(el('div', { class: 'gdm-tip__title', text: r }));
      tipEl.appendChild(el('div', { class: 'gdm-tip__grid' }, [
        row('RPK YoY', U.fmtPct(d.rpk.latest), U.signClass(d.rpk.latest)),
        row('ASK YoY', U.fmtPct(d.ask.latest), U.signClass(d.ask.latest)),
        row('PLF', U.fmtPctPlain(d.plf.latest)),
        row('RPK 3M', U.fmtPct(d.rpk.m3), U.signClass(d.rpk.m3)),
        row('ASK 3M', U.fmtPct(d.ask.m3), U.signClass(d.ask.m3)),
        row('PLF 3M', U.fmtPctPlain(d.plf.m3)),
        row('PLF 12M', U.fmtPctPlain(d.plf.m12)),
        row('Mkt Share', U.fmtPctPlain(d.share))
      ]));
    }
    function showTip(r) { fillTip(r); tipEl.hidden = false; }
    function hideTip() { tipEl.hidden = true; }
    function placeTipRel(x, y, rect) {
      var tw = tipEl.offsetWidth || 180, th = tipEl.offsetHeight || 130;
      var left = x + 18, top = y + 14;
      if (left + tw > rect.width - 8) left = x - tw - 18;
      if (top + th > rect.height - 8) top = y - th - 14;
      tipEl.style.left = Math.max(8, left) + 'px';
      tipEl.style.top = Math.max(8, top) + 'px';
    }
    function onMove(e) {
      var rect = mapWrap.getBoundingClientRect();
      placeTipRel(e.clientX - rect.left, e.clientY - rect.top, rect);
    }
    function placeTipAtBubble(p) {
      var rect = mapWrap.getBoundingClientRect();
      var scale = rect.width / WM.width;
      placeTipRel(p.x * scale, p.y * scale, rect);
    }

    /* ================= all-regions snapshot (latest month) ================= */
    function buildSnapshot() {
      var head = el('tr', { class: 'sub' },
        ['Region', 'RPK YoY', 'ASK YoY', 'PLF', 'PLF 3M', 'PLF 12M', 'Mkt Share']
          .map(function (t, i) { return el('th', { class: i === 0 ? 'rowlab' : '', text: t }); }));
      var tbody = el('tbody');
      var rows = {};
      REGIONS_A.forEach(function (r) {
        var d = S[r];
        function c(v, cls) { return el('td', { class: 'val ' + cls, text: v == null ? '—' : U.fmtPctPlain(v) }); }
        var tr = el('tr', { class: 'gdm-snap-row' }, [
          el('td', { class: 'rowlab', text: r }),
          c(d.rpk.latest, HM.yoyClass(d.rpk.latest)),
          c(d.ask.latest, HM.yoyClass(d.ask.latest)),
          c(d.plf.latest, HM.plfClass(d.plf.latest)),
          c(d.plf.m3, HM.plfClass(d.plf.m3)),
          c(d.plf.m12, HM.plfClass(d.plf.m12)),
          c(d.share, 'fill-none')
        ]);
        tr.addEventListener('click', function () { selectRegion(r); });
        rows[r] = tr;
        tbody.appendChild(tr);
      });
      var card = el('div', { class: 'card' }, [
        el('div', { class: 'section-head' }, [
          el('div', { class: 'section-head__title' }, [el('span', { class: 'ico', html: I.grid }),
            'Regional Snapshot — Latest Month']),
          el('span', { class: 'gdm-sechead-note', text: latestMonthLong })
        ]),
        el('div', { class: 'hm-wrap' }, [
          el('table', { class: 'hm gdm-snaptbl' }, [el('thead', {}, [head]), tbody])
        ])
      ]);
      return { card: card, rows: rows };
    }

    /* ================= regional comparison table ================= */
    function th2(lab, unit, cls) {
      return el('th', { class: cls || '' }, [
        el('div', { class: 'gdm-th__lab', text: lab }),
        unit ? el('div', { class: 'gdm-th__unit', text: unit }) : null
      ]);
    }
    function buildComparison() {
      var head = el('tr', { class: 'sub gdm-cmp-head' }, [
        th2('Region', null, 'rowlab'),
        th2('RPK Latest', '(YoY %)'), th2('RPK 3M', '(YoY %)'),
        th2('ASK Latest', '(YoY %)'), th2('ASK 3M', '(YoY %)'),
        th2('PLF Latest', '(%)'), th2('PLF 3M', '(%)'), th2('PLF 12M', '(%)'),
        th2('Market Share', '(%)')
      ]);
      var tbody = el('tbody');
      var rows = {};
      REGIONS_A.forEach(function (r) {
        var d = S[r];
        function c(v, cls) { return el('td', { class: 'val ' + cls, text: v == null ? '—' : U.fmtPctPlain(v) }); }
        function cy(v, cls) { return el('td', { class: 'val ' + cls, text: v == null ? '—' : U.fmtPct(v) }); }
        var tr = el('tr', { class: 'gdm-cmp-row' }, [
          el('td', { class: 'rowlab', text: r }),
          cy(d.rpk.latest, HM.yoyClass(d.rpk.latest)), cy(d.rpk.m3, HM.yoyClass(d.rpk.m3)),
          cy(d.ask.latest, HM.yoyClass(d.ask.latest)), cy(d.ask.m3, HM.yoyClass(d.ask.m3)),
          c(d.plf.latest, HM.plfClass(d.plf.latest)), c(d.plf.m3, HM.plfClass(d.plf.m3)),
          c(d.plf.m12, HM.plfClass(d.plf.m12)), c(d.share, 'fill-none')
        ]);
        tr.addEventListener('click', function () { selectRegion(r); });
        rows[r] = tr;
        tbody.appendChild(tr);
      });
      var card = el('div', { class: 'card' }, [
        el('div', { class: 'section-head' }, [
          el('div', { class: 'section-head__title' }, [el('span', { class: 'ico', html: I.bars }),
            'Regional Comparison — Latest Metrics'])
        ]),
        el('div', { class: 'hm-scroll' }, [
          el('table', { class: 'hm gdm-cmptbl' }, [el('thead', {}, [head]), tbody])
        ]),
        el('div', { class: 'matrix-note', text: 'YoY = year over year · 3M = trailing 3-month average · PLF shown as load-factor level % · Click a region row (or a map bubble) to update the trend chart.' })
      ]);
      return { card: card, rows: rows };
    }
    function updateRowHighlights() {
      REGIONS_A.forEach(function (r) {
        cmp.rows[r].classList.toggle('is-selected', r === state.region);
        snap.rows[r].classList.toggle('is-selected', r === state.region);
      });
    }

    /* ================= segmented controls ================= */
    function segControl(label, opts, key) {
      var btns = opts.map(function (o) {
        return el('button', { class: 'gdm-seg__btn', type: 'button', 'data-val': o[0], text: o[1],
          onClick: function () { setState(key, o[0]); } });
      });
      var box = el('div', { class: 'gdm-seg', 'data-key': key }, [
        el('span', { class: 'gdm-seg__label', text: label }),
        el('div', { class: 'gdm-seg__btns' }, btns)
      ]);
      function sync() {
        btns.forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-val') === state[key]); });
      }
      sync();
      return { el: box, sync: sync, btns: btns };
    }
    function setState(key, val) {
      state[key] = val;
      metricSeg.sync(); viewSeg.sync(); periodSeg.sync();
      refreshControlsState();
      renderBubbles();
      updateCaption();
      applyTrendEmphasis();   // the Metric control also highlights the trend line
    }
    function refreshControlsState() {
      var isShare = state.metric === 'share';
      // View (Latest / 3M / 12M) applies only to a time-series metric on a
      // monthly basis — not to a static share, nor when the Year period is on.
      viewSeg.el.classList.toggle('is-disabled', isShare || state.period === 'year');
      // Period (Month / Year) applies only to time-series metrics; market share
      // is a single static figure, so Month/Year is meaningless there.
      periodSeg.el.classList.toggle('is-disabled', isShare);
    }
    function updateCaption() {
      var viewTxt = state.metric === 'share' ? 'Share of Global'
        : state.period === 'year' ? ('Full Year ' + fullYear)
        : VIEW_LABEL[state.view];
      legendTitle.textContent = METRIC_LABEL[state.metric] + ' · ' + viewTxt;
    }

    /* ================= trend chart ================= */
    var trendChart = null;
    function rangeSlice(arr) {
      return state.range > 0 ? arr.slice(-state.range) : arr.slice();
    }
    function buildTrend() {
      var d = S[state.region];
      var pctY = function (v) { return v + '%'; };
      trendChart = new Chart(trendCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: rangeSlice(monthLabels),
          datasets: [
            line('RPK YoY %', rangeSlice(d.rpk.series), '#d8b15f', 'rgba(216,177,95,.30)', 'y'),        // champagne gold (RPK)
            line('ASK YoY %', rangeSlice(d.ask.series), '#4fb6a8', 'rgba(79,182,168,.30)', 'y'),        // teal (ASK)
            line('PLF %', rangeSlice(d.plf.series), 'rgba(244,247,251,.85)', 'rgba(244,247,251,.20)', 'y1')  // light (PLF)
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: false,   // static: avoids a Chart.js segment-dash animation bug
          layout: { padding: { top: 14, right: 4, left: 2, bottom: 0 } },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, position: 'bottom',
              labels: { boxWidth: 11, boxHeight: 11, padding: 15, color: '#9fb0c7',
                font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'line' } },
            tooltip: {
              backgroundColor: '#0d2147', titleColor: '#fff', bodyColor: '#eaf0fb',
              borderColor: 'rgba(216,177,95,.32)', borderWidth: 1, padding: 10, cornerRadius: 8,
              titleFont: { weight: '700', size: 12 }, bodyFont: { size: 12 },
              callbacks: { label: function (c) {
                if (c.raw == null) return c.dataset.label + ': —';
                var s = c.dataset.yAxisID === 'y1'
                  ? c.raw.toFixed(1) + '%' : (c.raw > 0 ? '+' : '') + c.raw.toFixed(1) + '%';
                return c.dataset.label + ': ' + s;
              } }
            }
          },
          scales: {
            x: { grid: { display: false, drawTicks: false }, border: { color: 'rgba(180,200,225,.18)' },
                 ticks: { color: '#9fb0c7', maxRotation: 0, autoSkip: true, maxTicksLimit: 9, font: { size: 10 } } },
            y: { position: 'left', grid: { color: 'rgba(180,200,225,.12)', drawTicks: false }, border: { display: false },
                 ticks: { color: '#9fb0c7', font: { size: 10 }, padding: 6, maxTicksLimit: 6, callback: pctY },
                 title: { display: true, text: 'YoY %', color: '#9fb0c7', font: { size: 10, weight: '600' } },
                 suggestedMin: -6, suggestedMax: 16 },
            y1: { position: 'right', grid: { display: false }, border: { display: false },
                  ticks: { color: '#9fb0c7', font: { size: 10 }, padding: 6, maxTicksLimit: 6, callback: pctY },
                  title: { display: true, text: 'PLF %', color: '#9fb0c7', font: { size: 10, weight: '600' } },
                  suggestedMin: 60, suggestedMax: 95 }
          }
        }
      });
      applyTrendEmphasis();
    }
    function visMonths() { return rangeSlice(months); }
    function pointRadii(scale) { return visMonths().map(function (m) { return REAL[m] ? (scale || 1) * 3 : 0; }); }
    // real months are drawn solid with a dot; sample months get a dashed segment
    function dashSeg(ctx) {
      var vm = visMonths();
      return (REAL[vm[ctx.p0DataIndex]] && REAL[vm[ctx.p1DataIndex]]) ? undefined : [4, 3];
    }
    var METRIC_LINE = { rpk: 0, ask: 1, plf: 2 };   // which trend line each metric maps to
    function line(label, data, base, fade, axis) {
      return { label: label, data: data, yAxisID: axis, _base: base, _fade: fade,
        borderColor: base, backgroundColor: base,
        borderWidth: 2, pointRadius: pointRadii(), pointBackgroundColor: base, pointBorderColor: base,
        pointHoverRadius: 5, pointHoverBackgroundColor: base,
        segment: { borderDash: dashSeg }, tension: 0.3, spanGaps: true };
    }
    /* the Metric control highlights the matching line in the trend chart, so the
       chart visibly responds to every selection (Market Share shows all three). */
    function applyTrendEmphasis() {
      if (!trendChart) return;
      var sel = METRIC_LINE[state.metric];                 // undefined for share
      trendChart.data.datasets.forEach(function (ds, i) {
        var hot = sel == null || i === sel;
        ds.borderColor = ds.pointBackgroundColor = ds.pointBorderColor = hot ? ds._base : ds._fade;
        ds.borderWidth = (sel != null && i === sel) ? 3.4 : (sel == null ? 2 : 1.2);
        ds.pointRadius = pointRadii(hot ? 1 : 0.6);
      });
      trendChart.update();
    }
    function updateTrend() {
      trendTitle.textContent = 'Regional Trend — ' + state.region;
      if (!trendChart) return;
      var d = S[state.region];
      trendChart.data.labels = rangeSlice(monthLabels);
      [d.rpk.series, d.ask.series, d.plf.series].forEach(function (s, i) {
        trendChart.data.datasets[i].data = rangeSlice(s);
      });
      applyTrendEmphasis();
    }

    /* ================= region selection ================= */
    function selectRegion(r) {
      state.region = r;
      renderBubbles();
      updateRowHighlights();
      updateTrend();
    }

    /* ---- initial paint ---- */
    refreshControlsState();
    updateCaption();
    renderBubbles();
    updateRowHighlights();
    updateTrend();   // sets the title; chart itself builds lazily

    /* ---- lazy chart init (Chart.js canvas must be visible to size) ---- */
    var done = false;
    function initCharts() {
      if (done) return; done = true;
      buildTrend();
      updateTrend();
    }

    return { initCharts: initCharts };
  }

  global.ADM.map = { build: build, exportCSV: exportCSV };
})(window);
