/* Airline Demand Monitor — bootstrap: load data, render header, wire tabs. */
(function (global) {
  'use strict';
  var U = global.ADM.util;

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  function periodLabel(tsa, iata) {
    var startKey = tsa.days[0].date.slice(0, 7);
    if (iata.months[0] < startKey) startKey = iata.months[0];
    var p = startKey.split('-');
    var start = U.MON[Number(p[1]) - 1] + ' ' + p[0];
    return start + ' – ' + U.fmtDateLong(tsa.days[tsa.days.length - 1].date);
  }

  function init() {
    var status = document.getElementById('status');

    Promise.all([
      fetchJSON('data/tsa.json'),
      fetchJSON('data/data.json'),
      fetchJSON('data/iata_detail.json').catch(function () { return null; })
    ])
      .then(function (res) {
        var tsa = res[0], iata = res[1], detail = res[2];
        status.hidden = true;

        document.getElementById('meta-asof').innerHTML =
          'Data as of: <b>' + U.fmtDateLong(tsa.days[tsa.days.length - 1].date) + '</b>';
        document.getElementById('meta-period').textContent =
          'Data Period: ' + periodLabel(tsa, iata);

        var mapPanel = document.getElementById('panel-map');
        var tsaPanel = document.getElementById('panel-tsa');
        var iataPanel = document.getElementById('panel-iata');
        var tabs = {
          map: { btn: document.getElementById('tab-map'), panel: mapPanel,
                 ctl: global.ADM.map.build(mapPanel, iata) },
          tsa: { btn: document.getElementById('tab-tsa'), panel: tsaPanel,
                 ctl: global.ADM.tsa.build(tsaPanel, tsa) },
          iata: { btn: document.getElementById('tab-iata'), panel: iataPanel,
                  ctl: global.ADM.iata.build(iataPanel, iata) }
        };
        // Monthly Detail is IATA data, so it lives at the bottom of the IATA tab
        // (not a separate tab). Its System view stays in sync with data.json.
        if (detail && global.ADM.detail) {
          var detailHost = document.createElement('div');
          detailHost.className = 'detail-embed';
          iataPanel.appendChild(detailHost);
          global.ADM.detail.build(detailHost, detail);
        }

        // Re-measure every chart in a panel. Charts built while their panel was
        // hidden come out 0×0; some browsers (Safari/iOS, some in-app webviews)
        // do NOT re-fire their size observer when the panel is shown again, so
        // without this explicit resize those charts stay blank until a reload.
        function resizePanelCharts(panel) {
          if (!global.Chart || !global.Chart.getChart) return;
          var canvases = panel.querySelectorAll('canvas');
          for (var i = 0; i < canvases.length; i++) {
            var chart = global.Chart.getChart(canvases[i]);
            if (chart) { try { chart.resize(); } catch (e) {} }
          }
        }

        // Build a tab's charts only once its panel actually has a size, then
        // resize them so they fit the now-visible panel. Waiting for a real
        // layout box avoids baking blank 0×0 charts when tabs are switched
        // quickly (the panel can still be hidden when a deferred build runs).
        function showCharts(tab, tries) {
          if (tries == null) tries = 30;
          if (tab.panel.offsetWidth > 0 && tab.panel.offsetHeight > 0) {
            try { tab.ctl.initCharts(); }
            catch (e) { if (global.console) global.console.error('chart init failed', e); }
            resizePanelCharts(tab.panel);
            // one more pass next frame, after fonts/late layout settle
            requestAnimationFrame(function () { resizePanelCharts(tab.panel); });
            return;
          }
          if (tries <= 0) return;   // still hidden — it'll build when next shown
          requestAnimationFrame(function () { showCharts(tab, tries - 1); });
        }

        function activate(key) {
          Object.keys(tabs).forEach(function (k) {
            var on = k === key;
            tabs[k].btn.classList.toggle('is-active', on);
            tabs[k].panel.hidden = !on;
          });
          var tab = tabs[key];
          requestAnimationFrame(function () { showCharts(tab); });
        }

        tabs.map.btn.addEventListener('click', function () { activate('map'); });
        tabs.tsa.btn.addEventListener('click', function () { activate('tsa'); });
        tabs.iata.btn.addEventListener('click', function () { activate('iata'); });
        activate('map');

        // header Export: download the IATA regional figures as a CSV file
        var exportBtn = document.getElementById('header-export');
        if (exportBtn) {
          exportBtn.addEventListener('click', function () { global.ADM.map.exportCSV(iata); });
        }
      })
      .catch(function (e) {
        status.className = 'status-banner is-error';
        status.hidden = false;
        status.textContent = 'Could not load the dashboard data (data/tsa.json, data/data.json). ' +
          'If you opened index.html directly from disk, start a local web server instead ' +
          '(for example: python3 -m http.server). Details: ' + e.message;
      });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})(window);
