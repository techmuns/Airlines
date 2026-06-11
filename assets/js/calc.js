/* Airline Demand Monitor — derived calculations.
   All "derived" metrics are computed here so the data files can stay minimal
   and a future paid feed can drop in without UI changes. */
(function (global) {
  'use strict';

  var U = global.ADM.util;

  function pctChange(cur, prev) {
    if (cur == null || prev == null || prev === 0) return null;
    return (cur / prev - 1) * 100;
  }

  /* ---------------- TSA daily ---------------- */

  // Enrich the daily series (sorted ascending) with DoD / WoW and ensure
  // YoY + 7DMA exist (prefer values supplied by the ETL, else compute).
  function enrichTSA(days) {
    var byDate = {};
    days.forEach(function (d) { byDate[d.date] = d; });

    function shift(iso, deltaDays) {
      var dt = U.parseISO(iso);
      dt.setUTCDate(dt.getUTCDate() + deltaDays);
      return dt.toISOString().slice(0, 10);
    }
    function nearest(iso, span) {            // find a record near a target date
      for (var k = 0; k <= span; k++) {
        if (byDate[shift(iso, -k)]) return byDate[shift(iso, -k)];
        if (byDate[shift(iso, k)]) return byDate[shift(iso, k)];
      }
      return null;
    }

    days.forEach(function (d, i) {
      var prev = days[i - 1];
      if (d.dod == null) d.dod = prev ? pctChange(d.throughput, prev.throughput) : null;

      if (d.wow == null) {
        var wowRef = byDate[shift(d.date, -7)];
        d.wow = wowRef ? pctChange(d.throughput, wowRef.throughput) : null;
      }
      if (d.yoy == null) {
        var yref = nearest(shift(d.date, -364), 4);
        d.yoy = yref ? pctChange(d.throughput, yref.throughput) : null;
      }
      if (d.sevenDMA == null) {
        var win = [], k;
        for (k = 0; k < 7 && i - k >= 0; k++) win.push(days[i - k].throughput);
        d.sevenDMA = Math.round(win.reduce(function (a, b) { return a + b; }, 0) / win.length);
      }
    });
    return { days: days, byDate: byDate, shift: shift };
  }

  // Monthly averages of daily throughput -> {key, avg}[]
  function monthlyAverages(days) {
    var groups = {}, order = [];
    days.forEach(function (d) {
      var key = U.monthKeyOf(d.date);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(d.throughput);
    });
    return order.map(function (key) {
      var arr = groups[key];
      return { key: key, avg: arr.reduce(function (a, b) { return a + b; }, 0) / arr.length };
    });
  }

  // Year-over-year % of the monthly averages (for the monthly YoY bar chart)
  function monthlyYoY(monthly) {
    var byKey = {};
    monthly.forEach(function (m) { byKey[m.key] = m.avg; });
    return monthly.map(function (m) {
      var p = m.key.split('-'); var pk = (Number(p[0]) - 1) + '-' + p[1];
      return { key: m.key, yoy: pctChange(m.avg, byKey[pk]) };
    });
  }

  // YoY of the 7-day moving average (the "7DMA basis" chart), per day.
  function sevenDmaYoY(days, byDate, shift) {
    return days.map(function (d) {
      var ref = byDate[shift(d.date, -364)];
      return { date: d.date, yoy: (ref && ref.sevenDMA) ? pctChange(d.sevenDMA, ref.sevenDMA) : null };
    });
  }

  /* ---------------- IATA monthly ---------------- */

  function lastValid(arr) {
    for (var i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
    return null;
  }
  function trailingMean(arr, n) {
    var vals = [];
    for (var i = arr.length - 1; i >= 0 && vals.length < n; i--) {
      if (arr[i] != null) vals.push(arr[i]);
    }
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  // For one region/metric series -> {latest, m3}
  function summarise(arr) {
    return { latest: lastValid(arr), m3: trailingMean(arr, 3) };
  }

  global.ADM.calc = {
    pctChange: pctChange,
    enrichTSA: enrichTSA,
    monthlyAverages: monthlyAverages,
    monthlyYoY: monthlyYoY,
    sevenDmaYoY: sevenDmaYoY,
    lastValid: lastValid,
    trailingMean: trailingMean,
    summarise: summarise
  };
})(window);
