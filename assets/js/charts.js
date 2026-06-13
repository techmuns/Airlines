/* Airline Demand Monitor — themed Chart.js factories.
   Research-style: navy ink, soft gridlines, restrained tooltips. */
(function (global) {
  'use strict';

  var Chart = global.Chart;
  var FONT = '"Inter", "Segoe UI", system-ui, sans-serif';

  /* chart ink — IATA/research "deck" blues (navy primary, light-blue secondary)
     tuned to read on the dark theme; value labels light for legibility */
  var INK = {
    navy: '#5b9bd5',                    // primary BAR series (deck blue)
    navySoft: '#3f74b0',                // deeper blue accent
    blue: '#6fa8dc',                    // LINE / moving-average series (medium blue)
    blueLight: '#a9cfee',               // secondary series, e.g. International (light blue)
    label: '#cfdaee',                   // value labels above bars (legible on dark)
    grid: 'rgba(180,200,225,.12)',      // subtle gridlines
    axis: '#9fb0c7',
    tick: '#9fb0c7'
  };

  if (Chart) {
    Chart.defaults.font.family = FONT;
    Chart.defaults.font.size = 11;
    Chart.defaults.color = INK.tick;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = { duration: 500 };

    /* draw value labels on top of bars (opt-in per chart).
       The config is read from chart.$admBarLabels (a plain object) rather than
       options.plugins, so Chart.js never treats `formatter` as a scriptable
       option and never calls it with a context object in place of the value. */
    Chart.register({
      id: 'admBarLabels',
      afterDatasetsDraw: function (chart) {
        var opt = chart.$admBarLabels;
        if (!opt || !opt.display) return;
        var ctx = chart.ctx;
        chart.data.datasets.forEach(function (ds, di) {
          var meta = chart.getDatasetMeta(di);
          if (meta.type !== 'bar' || meta.hidden) return;
          ctx.save();
          ctx.font = '700 ' + (opt.size || 9.5) + 'px ' + FONT;
          ctx.fillStyle = opt.color || INK.label;
          ctx.textAlign = 'center';
          meta.data.forEach(function (bar, i) {
            var v = ds.data[i];
            if (v == null) return;
            var up = v >= 0;
            ctx.textBaseline = up ? 'bottom' : 'top';
            ctx.fillText(opt.formatter ? opt.formatter(v) : v, bar.x, bar.y + (up ? -4 : 4));
          });
          ctx.restore();
        });
      }
    });
  }

  function baseOptions(o) {
    o = o || {};
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: o.padTop == null ? 16 : o.padTop, right: 6, left: 2, bottom: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: o.legend || { display: false },
        tooltip: {
          backgroundColor: '#0d2147',
          titleColor: '#fff',
          bodyColor: '#dbe4f3',
          borderColor: 'rgba(255,255,255,.12)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          titleFont: { weight: '700', size: 12 },
          bodyFont: { size: 12 },
          callbacks: o.tooltip || {}
        }
      },
      scales: {
        x: {
          grid: { display: false, drawTicks: false },
          border: { color: INK.grid },
          ticks: {
            color: INK.tick, maxRotation: 0, autoSkip: true,
            maxTicksLimit: o.xTicks || 8, font: { size: 10 },
            // fall back to the category label (a bare `undefined` would make
            // Chart.js print the raw tick index instead of the month label)
            callback: o.xCallback || function (value) { return this.getLabelForValue(value); }
          }
        },
        y: {
          grid: { color: INK.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: INK.tick, font: { size: 10 }, padding: 6,
            maxTicksLimit: 6, callback: o.yCallback
          },
          title: o.yTitle ? { display: true, text: o.yTitle, color: INK.axis,
                              font: { size: 10, weight: '600' } } : { display: false },
          suggestedMin: o.yMin, suggestedMax: o.yMax
        }
      }
    };
  }

  function barChart(canvas, labels, data, o) {
    o = o || {};
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: labels, datasets: [{
        data: data,
        backgroundColor: o.color || INK.navy,
        borderRadius: 3,
        maxBarThickness: o.maxBar || 26,
        categoryPercentage: 0.82, barPercentage: 0.9
      }]},
      options: baseOptions(o)
    });
    chart.$admBarLabels = o.barLabels;
    return chart;
  }

  function lineChart(canvas, labels, data, o) {
    o = o || {};
    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: labels, datasets: [{
        data: data,
        borderColor: o.color || INK.blue,
        backgroundColor: o.fill ? (o.fillColor || 'rgba(111,168,220,.12)') : 'transparent',
        fill: !!o.fill,
        borderWidth: o.width || 2.0,
        pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: o.color || INK.blue,
        tension: o.tension == null ? 0.25 : o.tension,
        spanGaps: true
      }]},
      options: baseOptions(o)
    });
  }

  function groupedBarChart(canvas, labels, series, o) {
    o = o || {};
    var chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: series.map(function (s) {
          return {
            label: s.label, data: s.data,
            backgroundColor: s.color, borderRadius: 2,
            maxBarThickness: 12, categoryPercentage: 0.78, barPercentage: 0.92
          };
        })
      },
      options: baseOptions(o)
    });
    chart.$admBarLabels = o.barLabels;
    return chart;
  }

  global.ADM.charts = {
    INK: INK,
    barChart: barChart,
    lineChart: lineChart,
    groupedBarChart: groupedBarChart
  };
})(window);
