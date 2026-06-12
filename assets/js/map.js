/* Airline Demand Monitor — TAB 1 (landing): Global Demand Map.
   A premium navy world map that shows IATA regional airline demand as glowing
   gold bubbles. Regional IATA RPK / ASK / PLF / market share only — no TSA data. */
(function (global) {
  'use strict';

  var U = global.ADM.util, C = global.ADM.calc, HM = global.ADM.heatmap,
      CH = global.ADM.charts, WM = global.ADM.worldMap, Chart = global.Chart,
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
  var ANCHORS = {
    'North America': { lon: -98, lat: 46 },
    'Europe':        { lon: 10,  lat: 49 },
    'Asia/Pacific':  { lon: 114, lat: 19 },
    'Middle East':   { lon: 51,  lat: 26 },
    'Latin America': { lon: -61, lat: -13 },
    'Africa':        { lon: 21,  lat: 4 }
  };
  var SHORT = {
    'North America': 'N. America', 'Europe': 'Europe', 'Asia/Pacific': 'Asia / Pacific',
    'Middle East': 'Middle East', 'Latin America': 'Latin America', 'Africa': 'Africa'
  };

  var METRIC_LABEL = { rpk: 'RPK YoY', ask: 'ASK YoY', plf: 'PLF', share: 'RPK market share' };
  var VIEW_LABEL = { latest: 'Latest month', m3: '3M rolling', m12: '12-month' };

  /* gold ramp (muted -> bright) + soft red, all premium / never neon */
  var GOLD_DIM = [150, 128, 74], GOLD_BRIGHT = [243, 209, 134], GOLD_HALO = [236, 196, 110];

  function project(lon, lat) { return { x: (lon + 180) * WM.k, y: (WM.latTop - lat) * WM.k }; }
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

  function build(root, raw) {
    var months = raw.months;
    var monthLabels = months.map(U.fmtMonthShort);
    var S = summarise(raw);
    var maxShare = REGIONS.reduce(function (m, r) { return Math.max(m, S[r].share); }, 0);

    var latestKey = months[months.length - 1];
    var latestMonthLong = U.fmtMonthLong(latestKey);
    var rangeSub = U.fmtMonthLong(months[0]) + ' – ' + latestMonthLong;

    /* latest *full* calendar year (for the Year period) */
    var lastMonthNum = Number(latestKey.slice(5, 7));
    var fullYear = lastMonthNum === 12 ? Number(latestKey.slice(0, 4)) : Number(latestKey.slice(0, 4)) - 1;
    var yearIdx = [];
    months.forEach(function (m, i) { if (Number(m.slice(0, 4)) === fullYear) yearIdx.push(i); });

    var state = { metric: 'rpk', view: 'latest', period: 'month', region: 'Asia/Pacific' };

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
    function baseRadius(share) { return Math.max(11, 33 * Math.sqrt(share / maxShare)); }

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

    /* controls (segmented pills sitting on the dark map bar) */
    var caption = el('span', { class: 'gdm-mapbar__now' });
    var metricSeg = segControl('Metric',
      [['rpk', 'RPK'], ['ask', 'ASK'], ['plf', 'PLF'], ['share', 'Market Share']],
      'metric');
    var viewSeg = segControl('View',
      [['latest', 'Latest Month'], ['m3', '3M Rolling'], ['m12', '12M']], 'view');
    var periodSeg = segControl('Period', [['month', 'Month'], ['year', 'Year']], 'period');

    var mapbar = el('div', { class: 'gdm-mapbar' }, [
      el('div', { class: 'gdm-mapbar__lead' }, [
        el('span', { class: 'gdm-mapbar__eyebrow', text: 'Regional demand map' }),
        caption
      ]),
      el('div', { class: 'gdm-controls' }, [metricSeg.el, viewSeg.el, periodSeg.el])
    ]);

    /* legend / encoding key */
    var legend = el('div', { class: 'gdm-legend' }, [
      el('span', { class: 'gdm-legend__item' }, [
        el('span', { class: 'gdm-legend__dot is-lg' }), 'Bubble size — ', el('strong', { text: 'RPK market share' })
      ]),
      el('span', { class: 'gdm-legend__item' }, [
        el('span', { class: 'gdm-legend__dot is-strong' }), 'Bright gold — ', el('strong', { text: 'stronger demand / momentum' })
      ]),
      el('span', { class: 'gdm-legend__item' }, [
        el('span', { class: 'gdm-legend__dot is-muted' }), 'Muted gold — ', el('strong', { text: 'weaker / softer' })
      ]),
      el('span', { class: 'gdm-legend__item' }, [
        el('span', { class: 'gdm-legend__dot is-weak' }), 'Soft red ring — ', el('strong', { text: 'negative or weak' })
      ])
    ]);

    var mapCard = el('div', { class: 'card gdm-map-card' }, [mapbar, mapWrap, legend]);

    /* ================= tab header ================= */
    var header = el('div', { class: 'gdm-head' }, [
      el('div', {}, [
        el('div', { class: 'gdm-head__title', text: 'Global Demand Map' }),
        el('div', { class: 'gdm-head__sub', text: 'Regional airline traffic concentration and momentum' })
      ]),
      el('div', { class: 'gdm-head__meta' }, [
        el('span', { class: 'gdm-chip' }, [el('span', { class: 'ico', html: I.calendar }),
          'Latest month · ' + latestMonthLong]),
        el('span', { class: 'gdm-head__src', text: 'Source: IATA regional traffic data (' + rangeSub + ')' })
      ])
    ]);

    /* ================= selected-region panel ================= */
    var panel = el('div', { class: 'card gdm-region-card' });

    /* ================= lower split: trend + snapshot heatmap ================= */
    var trendCanvas = el('canvas');
    var trendTitle = el('span', { text: 'Regional trend' });
    var trendCard = el('div', { class: 'card chart-card gdm-trend' }, [
      el('div', {}, [
        el('div', { class: 'card-title' }, [el('span', { class: 'ico', html: I.trend }), trendTitle]),
        el('div', { class: 'card-sub', text: 'RPK & ASK year-over-year (left) · PLF load factor (right) · ' + rangeSub })
      ]),
      el('div', { class: 'chart-card__canvas gdm-trend__canvas' }, [trendCanvas])
    ]);

    var snapTable = el('table', { class: 'hm' });
    var snapCard = el('div', { class: 'card' }, [
      el('div', { class: 'section-head' }, [
        el('div', { class: 'section-head__title' }, [el('span', { class: 'ico', html: I.grid }), 'Regional Snapshot'])
      ]),
      el('div', { class: 'hm-wrap' }, [snapTable])
    ]);

    var split = el('div', { class: 'grid gdm-split' }, [trendCard, snapCard]);

    /* ================= regional comparison table ================= */
    var cmp = buildComparison();

    var footer = el('div', { class: 'source-note' }, [
      el('span', {}, [el('b', { text: 'Source: ' }), 'IATA Economics — Air Passenger Market Analysis (regional).']),
      el('span', { text: 'Bubbles show regional demand only — no country- or airport-level data.' }),
      el('span', { text: 'RPK = Revenue Passenger Kilometres · ASK = Available Seat Kilometres · PLF = Passenger Load Factor' })
    ]);

    root.appendChild(el('div', { class: 'gdm-stack' }, [header, mapCard, panel, split, cmp.card, footer]));

    /* ================= static SVG (bg, graticule, land, dots) ================= */
    function staticMarkup() {
      var defs = '<defs>' +
        '<radialGradient id="gdmBg" cx="50%" cy="4%" r="118%">' +
          '<stop offset="0%" stop-color="#16294b"/>' +
          '<stop offset="52%" stop-color="#0c1d3a"/>' +
          '<stop offset="100%" stop-color="#070f22"/>' +
        '</radialGradient>' +
        '<filter id="gdmGlow" x="-90%" y="-90%" width="280%" height="280%">' +
          '<feGaussianBlur stdDeviation="6"/>' +
        '</filter>' +
      '</defs>';
      var bg = '<rect x="0" y="0" width="' + WM.width + '" height="' + WM.height + '" fill="url(#gdmBg)"/>';
      var grat = '<g class="gdm-grat">', a, b, lon, lat;
      for (lon = -180; lon <= 180; lon += 30) {
        a = project(lon, WM.latTop); b = project(lon, WM.latBot);
        grat += '<line x1="' + r1(a.x) + '" y1="' + r1(a.y) + '" x2="' + r1(b.x) + '" y2="' + r1(b.y) + '"/>';
      }
      for (lat = -30; lat <= WM.latTop; lat += 30) {
        a = project(-180, lat); b = project(180, lat);
        grat += '<line class="' + (lat === 0 ? 'is-eq' : '') + '" x1="' + r1(a.x) + '" y1="' + r1(a.y) +
                '" x2="' + r1(b.x) + '" y2="' + r1(b.y) + '"/>';
      }
      grat += '</g>';
      var land = '<path class="gdm-land" fill-rule="evenodd" d="' + WM.landPath + '"/>';
      var dots = '<g class="gdm-dots">' + WM.dots.map(function (p) {
        return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.5"/>';
      }).join('') + '</g>';
      return defs + bg + grat + land + dots + '<g class="gdm-bubbles"></g>';
    }

    /* ================= bubbles ================= */
    function renderBubbles() {
      while (bubbleG.firstChild) bubbleG.removeChild(bubbleG.firstChild);
      // draw biggest first so smaller bubbles & their labels sit on top
      REGIONS.slice().sort(function (a, b) { return S[b].share - S[a].share; }).forEach(function (r) {
        var p = project(ANCHORS[r].lon, ANCHORS[r].lat);
        var v = windowValue(r), st = strengthOf(v), weak = isWeak(v);
        var coreR = baseRadius(S[r].share) * (0.85 + 0.32 * st);
        var haloR = coreR * (1.65 + 0.7 * st);
        var coreCol = mix(GOLD_DIM, GOLD_BRIGHT, st);
        var haloCol = mix(GOLD_DIM, GOLD_HALO, st);

        var g = svg('g', { class: 'gdm-bubble' + (state.region === r ? ' is-selected' : ''),
          transform: 'translate(' + r1(p.x) + ',' + r1(p.y) + ')',
          tabindex: '0', role: 'button', 'aria-label': r });

        g.appendChild(svg('circle', { r: r1(haloR), fill: haloCol,
          opacity: r1(0.16 + 0.42 * st), filter: 'url(#gdmGlow)' }));
        if (state.region === r) {
          g.appendChild(svg('circle', { class: 'gdm-bubble__sel', r: r1(coreR + 5),
            fill: 'none', stroke: 'rgba(247,229,172,.9)', 'stroke-width': '1.4' }));
        }
        g.appendChild(svg('circle', { class: 'gdm-bubble__core', r: r1(coreR), fill: coreCol,
          'fill-opacity': '0.9',
          stroke: weak ? 'rgba(196,88,79,.8)' : 'rgba(246,224,164,.55)',
          'stroke-width': weak ? '1.8' : '1' }));
        g.appendChild(svg('circle', { cx: r1(-coreR * 0.28), cy: r1(-coreR * 0.3),
          r: r1(coreR * 0.4), fill: 'rgba(255,250,236,.32)' }));
        var lbl = svg('text', { class: 'gdm-bubble__lbl', x: '0', y: r1(coreR + 13), 'text-anchor': 'middle' });
        lbl.textContent = SHORT[r];
        g.appendChild(lbl);
        g.appendChild(svg('circle', { class: 'gdm-hit', r: r1(Math.max(coreR + 9, 18)), fill: 'transparent' }));

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
      var left = x + 18, top = y + 18;
      if (left + tw > rect.width - 8) left = x - tw - 18;
      if (top + th > rect.height - 8) top = y - th - 18;
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

    /* ================= selected-region panel ================= */
    function perfLabel(d) {
      var score = (d.rpk.latest || 0) * 0.6 + (d.rpk.m3 || 0) * 0.4;
      if (score >= 2.5) return { txt: 'Strong', cls: 'is-strong' };
      if (score <= -2) return { txt: 'Weak', cls: 'is-weak' };
      return { txt: 'Stable', cls: 'is-stable' };
    }
    function statTile(lab, txt, cls) {
      return el('div', { class: 'gdm-stat' }, [
        el('div', { class: 'gdm-stat__lab', text: lab }),
        el('div', { class: 'gdm-stat__val num ' + (cls || ''), text: txt })
      ]);
    }
    function updatePanel() {
      var r = state.region, d = S[r], perf = perfLabel(d);
      panel.innerHTML = '';
      panel.appendChild(el('div', { class: 'gdm-region' }, [
        el('div', { class: 'gdm-region__id' }, [
          el('span', { class: 'gdm-region__icon', html: I.pin }),
          el('div', {}, [
            el('div', { class: 'gdm-region__eyebrow', text: 'Selected region' }),
            el('div', { class: 'gdm-region__name', text: r })
          ]),
          el('span', { class: 'gdm-badge ' + perf.cls, text: perf.txt })
        ]),
        el('div', { class: 'gdm-stats' }, [
          statTile('RPK YoY', U.fmtPct(d.rpk.latest), U.signClass(d.rpk.latest)),
          statTile('ASK YoY', U.fmtPct(d.ask.latest), U.signClass(d.ask.latest)),
          statTile('PLF', U.fmtPctPlain(d.plf.latest)),
          statTile('RPK 3M', U.fmtPct(d.rpk.m3), U.signClass(d.rpk.m3)),
          statTile('ASK 3M', U.fmtPct(d.ask.m3), U.signClass(d.ask.m3)),
          statTile('PLF 3M', U.fmtPctPlain(d.plf.m3)),
          statTile('Mkt Share', U.fmtPctPlain(d.share))
        ])
      ]));
    }

    /* ================= snapshot heatmap (selected region) ================= */
    function hmCell(v, cls, span) {
      var td = el('td', { class: 'val ' + cls, text: v == null ? '—' : U.fmtPctPlain(v) });
      if (span) td.setAttribute('colspan', span);
      return td;
    }
    function updateSnap() {
      var d = S[state.region];
      snapTable.innerHTML = '';
      snapTable.appendChild(el('thead', {}, [el('tr', { class: 'grp' }, [
        el('th', { class: 'spacer rowlab', text: 'Metric' }),
        el('th', { text: 'Latest' }), el('th', { text: '3M Rolling' }), el('th', { text: '12-Month' })
      ])]));
      var tb = el('tbody');
      tb.appendChild(el('tr', {}, [el('td', { class: 'rowlab', text: 'RPK YoY %' }),
        hmCell(d.rpk.latest, HM.yoyClass(d.rpk.latest)), hmCell(d.rpk.m3, HM.yoyClass(d.rpk.m3)),
        hmCell(d.rpk.m12, HM.yoyClass(d.rpk.m12))]));
      tb.appendChild(el('tr', {}, [el('td', { class: 'rowlab', text: 'ASK YoY %' }),
        hmCell(d.ask.latest, HM.yoyClass(d.ask.latest)), hmCell(d.ask.m3, HM.yoyClass(d.ask.m3)),
        hmCell(d.ask.m12, HM.yoyClass(d.ask.m12))]));
      tb.appendChild(el('tr', {}, [el('td', { class: 'rowlab', text: 'PLF %' }),
        hmCell(d.plf.latest, HM.plfClass(d.plf.latest)), hmCell(d.plf.m3, HM.plfClass(d.plf.m3)),
        hmCell(null, 'fill-none')]));
      tb.appendChild(el('tr', { class: 'gdm-snap-hl' }, [el('td', { class: 'rowlab', text: 'PLF 12M' }),
        hmCell(d.plf.m12, HM.plfClass(d.plf.m12), 3)]));
      tb.appendChild(el('tr', { class: 'gdm-snap-hl' }, [el('td', { class: 'rowlab', text: 'Market Share %' }),
        hmCell(d.share, 'fill-none', 3)]));
      snapTable.appendChild(tb);
    }

    /* ================= regional comparison table ================= */
    function buildComparison() {
      var grp = el('tr', { class: 'grp' }, [
        el('th', { class: 'spacer rowlab', text: 'Region' }),
        el('th', { colspan: 2, text: 'RPK (YoY %)' }),
        el('th', { colspan: 2, text: 'ASK (YoY %)' }),
        el('th', { colspan: 3, text: 'PLF (%)' }),
        el('th', { text: 'RPK Share' })
      ]);
      var sub = el('tr', { class: 'sub' }, ['', 'Latest', '3M', 'Latest', '3M', 'Latest', '3M', '12M', '%']
        .map(function (t, i) { return el('th', { class: i === 0 ? 'rowlab' : '', text: t }); }));
      var tbody = el('tbody');
      var rows = {};
      REGIONS.forEach(function (r) {
        var d = S[r];
        function c(v, cls) { return el('td', { class: 'val ' + cls, text: v == null ? '—' : U.fmtPctPlain(v) }); }
        var tr = el('tr', { class: 'gdm-cmp-row' }, [
          el('td', { class: 'rowlab' }, [el('span', { class: 'ico', html: I.pin }), r]),
          c(d.rpk.latest, HM.yoyClass(d.rpk.latest)), c(d.rpk.m3, HM.yoyClass(d.rpk.m3)),
          c(d.ask.latest, HM.yoyClass(d.ask.latest)), c(d.ask.m3, HM.yoyClass(d.ask.m3)),
          c(d.plf.latest, HM.plfClass(d.plf.latest)), c(d.plf.m3, HM.plfClass(d.plf.m3)),
          c(d.plf.m12, HM.plfClass(d.plf.m12)), c(d.share, 'fill-none')
        ]);
        tr.addEventListener('click', function () { selectRegion(r); });
        rows[r] = tr;
        tbody.appendChild(tr);
      });
      var card = el('div', { class: 'card' }, [
        el('div', { class: 'section-head' }, [
          el('div', { class: 'section-head__title' }, [el('span', { class: 'ico', html: I.bars }), 'Regional Comparison'])
        ]),
        el('div', { class: 'hm-scroll' }, [
          el('table', { class: 'hm' }, [el('thead', {}, [grp, sub]), tbody])
        ]),
        el('div', { class: 'matrix-note', text: 'RPK / ASK shown year-over-year %. PLF shown as load-factor level %. Click any region to drill down. Green = stronger · gold = neutral · red = weaker.' })
      ]);
      return { card: card, rows: rows };
    }
    function updateCmpHighlight() {
      REGIONS.forEach(function (r) { cmp.rows[r].classList.toggle('is-selected', r === state.region); });
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
      // View only applies to time-series metrics on a monthly basis
      if (key === 'metric' || key === 'period') {
        if (state.metric === 'share' || state.period === 'year') {
          // keep view value but it is inactive
        }
      }
      metricSeg.sync(); viewSeg.sync(); periodSeg.sync();
      refreshControlsState();
      renderBubbles();
      updateCaption();
    }
    function refreshControlsState() {
      var viewActive = state.metric !== 'share' && state.period === 'month';
      viewSeg.el.classList.toggle('is-disabled', !viewActive);
    }
    function updateCaption() {
      var viewTxt = state.metric === 'share' ? 'Static share'
        : state.period === 'year' ? ('Full year ' + fullYear)
        : VIEW_LABEL[state.view];
      caption.textContent = METRIC_LABEL[state.metric] + ' · ' + viewTxt;
    }

    /* ================= trend chart ================= */
    var trendChart = null;
    function buildTrend() {
      var d = S[state.region];
      var pctY = function (v) { return v + '%'; };
      trendChart = new Chart(trendCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: monthLabels,
          datasets: [
            line('RPK YoY %', d.rpk.series, CH.INK.navy, 'y'),
            line('ASK YoY %', d.ask.series, CH.INK.blue, 'y'),
            line('PLF %', d.plf.series, '#c9a85c', 'y1')
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 14, right: 4, left: 2, bottom: 0 } },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, position: 'bottom',
              labels: { boxWidth: 11, boxHeight: 11, padding: 15, color: '#67718a',
                font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'line' } },
            tooltip: {
              backgroundColor: '#0d2147', titleColor: '#fff', bodyColor: '#dbe4f3',
              borderColor: 'rgba(255,255,255,.12)', borderWidth: 1, padding: 10, cornerRadius: 8,
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
            x: { grid: { display: false, drawTicks: false }, border: { color: CH.INK.grid },
                 ticks: { color: CH.INK.tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10 } } },
            y: { position: 'left', grid: { color: CH.INK.grid, drawTicks: false }, border: { display: false },
                 ticks: { color: CH.INK.tick, font: { size: 10 }, padding: 6, maxTicksLimit: 6, callback: pctY },
                 title: { display: true, text: 'YoY %', color: CH.INK.axis, font: { size: 10, weight: '600' } },
                 suggestedMin: -20, suggestedMax: 14 },
            y1: { position: 'right', grid: { display: false }, border: { display: false },
                  ticks: { color: '#a98f52', font: { size: 10 }, padding: 6, maxTicksLimit: 6, callback: pctY },
                  title: { display: true, text: 'PLF %', color: '#a98f52', font: { size: 10, weight: '600' } },
                  suggestedMin: 60, suggestedMax: 95 }
          }
        }
      });
    }
    function line(label, data, color, axis) {
      return { label: label, data: data, yAxisID: axis, borderColor: color, backgroundColor: color,
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color,
        tension: 0.3, spanGaps: true };
    }
    function updateTrend() {
      trendTitle.textContent = 'Regional trend — ' + state.region;
      if (!trendChart) return;
      var d = S[state.region];
      trendChart.data.datasets[0].data = d.rpk.series;
      trendChart.data.datasets[1].data = d.ask.series;
      trendChart.data.datasets[2].data = d.plf.series;
      trendChart.update();
    }

    /* ================= region selection ================= */
    function selectRegion(r) {
      state.region = r;
      renderBubbles();
      updatePanel();
      updateSnap();
      updateCmpHighlight();
      updateTrend();
    }

    /* ---- initial paint (no canvas sizing needed for SVG/tables) ---- */
    refreshControlsState();
    updateCaption();
    renderBubbles();
    updatePanel();
    updateSnap();
    updateCmpHighlight();
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

  global.ADM.map = { build: build };
})(window);
