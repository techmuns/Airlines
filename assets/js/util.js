/* Airline Demand Monitor — shared helpers (formatting, dates, icons, DOM).
   No build step: each file attaches to the global ADM namespace. */
(function (global) {
  'use strict';

  /* --- inline SVG icons (stroke uses currentColor) --- */
  var ICONS = {
    plane: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 15.5v-1.7l-7.5-4.6V3.6a1.5 1.5 0 0 0-3 0v5.6L3 13.8v1.7l7.5-2.3v4.9l-2 1.4v1.4l3.5-1 3.5 1v-1.4l-2-1.4v-4.9z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17.5" cy="9" r="2.3"/><path d="M15.5 19a4.5 4.5 0 0 1 6-4.2"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8.4 12.4l2.5 2.5 4.6-5.2"/></svg>',
    bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 21V11M12 21V5M19 21v-8M3 21h18"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-8"/><path d="M16 7h5v5"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>'
  };

  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MON_LONG = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];

  /* --- numbers --- */
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtMillions(n, dp) { return (n / 1e6).toFixed(dp == null ? 2 : dp) + 'M'; }
  function fmtPct(v, dp) {
    if (v == null || isNaN(v)) return '—';
    dp = dp == null ? 1 : dp;
    return (v > 0 ? '+' : '') + v.toFixed(dp) + '%';
  }
  function fmtPctPlain(v, dp) {
    if (v == null || isNaN(v)) return '—';
    return v.toFixed(dp == null ? 1 : dp) + '%';
  }
  function signClass(v) { return (v == null || isNaN(v)) ? '' : (v >= 0 ? 'pos' : 'neg'); }

  /* --- dates (UTC to avoid timezone drift) --- */
  function parseISO(s) {
    var p = s.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] || 1));
  }
  function fmtDateLong(s) {
    var d = parseISO(s);
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function fmtMonthShort(key) {            // "2024-01" -> "Jan-24"
    var p = key.split('-');
    return MON[Number(p[1]) - 1] + '-' + p[0].slice(2);
  }
  function fmtMonthLong(key) {             // "2026-02" -> "February 2026"
    var p = key.split('-');
    return MON_LONG[Number(p[1]) - 1] + ' ' + p[0];
  }
  function monthKeyOf(iso) { return iso.slice(0, 7); }

  /* --- tiny DOM builder --- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  global.ADM = global.ADM || {};
  global.ADM.util = {
    ICONS: ICONS, MON: MON, MON_LONG: MON_LONG,
    fmtInt: fmtInt, fmtMillions: fmtMillions, fmtPct: fmtPct,
    fmtPctPlain: fmtPctPlain, signClass: signClass,
    parseISO: parseISO, fmtDateLong: fmtDateLong,
    fmtMonthShort: fmtMonthShort, fmtMonthLong: fmtMonthLong, monthKeyOf: monthKeyOf,
    el: el
  };
})(window);
