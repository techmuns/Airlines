/* Airline Demand Monitor — soft heatmap colour logic + TSA calendar. */
(function (global) {
  'use strict';

  var U = global.ADM.util, el = U.el;

  /* --- soft colour buckets (premium pastels, never loud) --- */
  function yoyClass(v) {
    if (v == null || isNaN(v)) return 'fill-none';
    if (v >= 4) return 'fill-spos';
    if (v >= 1) return 'fill-mpos';
    if (v > -1) return 'fill-neu';
    if (v > -4) return 'fill-mneg';
    return 'fill-sneg';
  }
  function plfClass(v) {
    if (v == null || isNaN(v)) return 'fill-none';
    if (v >= 83) return 'fill-spos';
    if (v >= 81) return 'fill-mpos';
    if (v >= 79) return 'fill-neu';
    if (v >= 76) return 'fill-mneg';
    return 'fill-sneg';
  }

  /* --- US holiday labels for the calendar --- */
  function nthWeekday(year, month, weekday, n) {        // month 0-based, weekday 0=Sun
    var d = new Date(Date.UTC(year, month, 1));
    var first = d.getUTCDay();
    var day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return day;
  }
  function lastWeekday(year, month, weekday) {
    var d = new Date(Date.UTC(year, month + 1, 0));
    var last = d.getUTCDate(), wd = d.getUTCDay();
    return last - ((wd - weekday + 7) % 7);
  }
  function holidaysFor(year, month) {                   // month 0-based -> {day: label}
    var h = {};
    if (month === 0) h[1] = 'New Year';
    if (month === 4) h[lastWeekday(year, 4, 1)] = 'Memorial Day';
    if (month === 6) h[4] = 'July 4th';
    if (month === 8) h[nthWeekday(year, 8, 1, 1)] = 'Labor Day';
    if (month === 10) h[nthWeekday(year, 10, 4, 4)] = 'Thanksgiving';
    if (month === 11) h[25] = 'Christmas';
    return h;
  }

  /* --- TSA calendar heatmap --- */
  // ctx: { byDate, dates(sorted asc) }
  function buildCalendar(ctx) {
    var byDate = ctx.byDate, dates = ctx.dates;
    var minKey = dates[0].slice(0, 7), maxKey = dates[dates.length - 1].slice(0, 7);

    // trailing 28-day average for each date (relative strength baseline)
    var trail = {};
    (function () {
      var win = [], sum = 0;
      dates.forEach(function (iso) {
        var v = byDate[iso].throughput;
        win.push(v); sum += v;
        if (win.length > 28) sum -= win.shift();
        trail[iso] = sum / win.length;
      });
    })();

    function level(iso) {
      var r = byDate[iso].throughput / trail[iso];
      if (r >= 1.035) return 'high';
      if (r <= 0.955) return 'low';
      return 'mid';
    }

    // default to latest month; if it has few days, step back one
    var ly = Number(maxKey.slice(0, 4)), lm = Number(maxKey.slice(5, 7)) - 1;
    var latestDay = Number(dates[dates.length - 1].slice(8, 10));
    if (latestDay < 20) { lm -= 1; if (lm < 0) { lm = 11; ly -= 1; } }
    var cur = { y: ly, m: lm };

    var grid = el('div', { class: 'cal__grid' });
    var label = el('div', { class: 'cal__month num' });
    var prevBtn = el('button', { class: 'cal__btn', 'aria-label': 'Previous month', html: U.ICONS.left });
    var nextBtn = el('button', { class: 'cal__btn', 'aria-label': 'Next month', html: U.ICONS.right });

    function keyOf(y, m) { return y + '-' + String(m + 1).padStart(2, '0'); }

    function render() {
      grid.innerHTML = '';
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function (d) {
        grid.appendChild(el('div', { class: 'cal__dow', text: d }));
      });
      label.textContent = U.MON_LONG[cur.m] + ' ' + cur.y;

      var firstDow = new Date(Date.UTC(cur.y, cur.m, 1)).getUTCDay();
      var daysIn = new Date(Date.UTC(cur.y, cur.m + 1, 0)).getUTCDate();
      var prevDaysIn = new Date(Date.UTC(cur.y, cur.m, 0)).getUTCDate();
      var holidays = holidaysFor(cur.y, cur.m);
      var totalCells = Math.ceil((firstDow + daysIn) / 7) * 7;

      for (var c = 0; c < totalCells; c++) {
        var dayNum = c - firstDow + 1;
        var inMonth = dayNum >= 1 && dayNum <= daysIn;
        var cell = el('div', { class: 'cal__cell' });
        if (!inMonth) {
          cell.classList.add('is-out');
          var outNum = dayNum < 1 ? prevDaysIn + dayNum : dayNum - daysIn;
          cell.appendChild(el('div', { class: 'cal__day', text: String(outNum) }));
          grid.appendChild(cell);
          continue;
        }
        var iso = keyOf(cur.y, cur.m) + '-' + String(dayNum).padStart(2, '0');
        cell.appendChild(el('div', { class: 'cal__day', text: String(dayNum) }));
        if (byDate[iso]) {
          cell.classList.add('lvl-' + level(iso));
          cell.appendChild(el('div', { class: 'cal__val', text: U.fmtMillions(byDate[iso].throughput, 2) }));
        }
        if (holidays[dayNum]) {
          cell.classList.add('has-holiday');
          cell.appendChild(el('div', { class: 'cal__holiday', text: holidays[dayNum] }));
        }
        grid.appendChild(cell);
      }
      prevBtn.disabled = keyOf(cur.y, cur.m) <= minKey;
      nextBtn.disabled = keyOf(cur.y, cur.m) >= maxKey;
    }

    prevBtn.addEventListener('click', function () {
      cur.m -= 1; if (cur.m < 0) { cur.m = 11; cur.y -= 1; } render();
    });
    nextBtn.addEventListener('click', function () {
      cur.m += 1; if (cur.m > 11) { cur.m = 0; cur.y += 1; } render();
    });

    var nav = el('div', { class: 'cal__nav' }, [prevBtn, label, nextBtn]);
    var wrap = el('div', { class: 'cal' }, [nav, grid]);
    render();
    return wrap;
  }

  global.ADM.heatmap = {
    yoyClass: yoyClass,
    plfClass: plfClass,
    buildCalendar: buildCalendar
  };
})(window);
