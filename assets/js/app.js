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

    Promise.all([fetchJSON('data/tsa.json'), fetchJSON('data/data.json')])
      .then(function (res) {
        var tsa = res[0], iata = res[1];
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

        function activate(key) {
          Object.keys(tabs).forEach(function (k) {
            var on = k === key;
            tabs[k].btn.classList.toggle('is-active', on);
            tabs[k].panel.hidden = !on;
          });
          requestAnimationFrame(function () { tabs[key].ctl.initCharts(); });
        }

        tabs.map.btn.addEventListener('click', function () { activate('map'); });
        tabs.tsa.btn.addEventListener('click', function () { activate('tsa'); });
        tabs.iata.btn.addEventListener('click', function () { activate('iata'); });
        activate('map');
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
