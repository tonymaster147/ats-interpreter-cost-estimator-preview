/*
 * ATS Interpreter Booking Cost Estimator: pricing engine (no DOM).
 *
 * All booking times are handled as "wall clock" milliseconds (Date.UTC of the local
 * date and time), so the visitor's own timezone never changes the price.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ATSICECalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 60000, DAY = 86400000;
  var TZ = {
    NSW: 'Australia/Sydney', VIC: 'Australia/Melbourne', QLD: 'Australia/Brisbane', WA: 'Australia/Perth',
    SA: 'Australia/Adelaide', TAS: 'Australia/Hobart', ACT: 'Australia/Sydney', NT: 'Australia/Darwin'
  };

  /* ---------- dates ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function dow(ms) { return new Date(ms).getUTCDay(); }
  function nth(year, month, weekday, n) { // month is 1-12
    var first = Date.UTC(year, month - 1, 1);
    return first + (((weekday - dow(first) + 7) % 7) + (n - 1) * 7) * DAY;
  }
  function onOrAfter(ms, weekday) { return ms + ((weekday - dow(ms) + 7) % 7) * DAY; }
  function last(year, month, weekday) {
    var end = Date.UTC(year, month, 0);
    return end - ((dow(end) - weekday + 7) % 7) * DAY;
  }
  function easter(y) { // Gregorian computus, returns Easter Sunday
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451), p = h + l - 7 * m + 114;
    return Date.UTC(y, Math.floor(p / 31) - 1, (p % 31) + 1);
  }

  /*
   * State-wide public holidays. Checked against Fair Work Ombudsman's 2027 list and WA's 2028 changes.
   * City-only and regional days (e.g. Ekka, Hobart Regatta) and the AFL Grand Final Friday, which is set
   * each year, are not here: add them in the plugin settings.
   */
  var cache = {};
  function holidays(year, s) {
    var key = year + s;
    if (cache[key]) return cache[key];
    var out = {};
    function add(ms, name, from) { var k = iso(ms); if (!out[k]) out[k] = { name: name, from: from || 0 }; }
    function is() { for (var i = 0; i < arguments.length; i++) if (arguments[i] === s) return true; return false; }
    var d, w, E = easter(year), wa28 = s === 'WA' && year >= 2028;

    d = Date.UTC(year, 0, 1); add(d, "New Year's Day");
    if (dow(d) === 6 || dow(d) === 0) add(onOrAfter(d, 1), "New Year's Day holiday");

    d = Date.UTC(year, 0, 26); add(dow(d) === 6 || dow(d) === 0 ? onOrAfter(d, 1) : d, 'Australia Day');

    add(E - 2 * DAY, 'Good Friday');
    if (!is('TAS', 'WA') || wa28) add(E - DAY, 'Easter Saturday');
    if (!is('TAS')) add(E, 'Easter Sunday');
    add(E + DAY, 'Easter Monday');

    d = Date.UTC(year, 3, 25); w = dow(d);
    if (!(w === 0 && is('NT', 'QLD'))) add(d, 'Anzac Day');
    if (w === 0 && (is('ACT', 'NT', 'QLD', 'WA') || (s === 'NSW' && year === 2027))) add(d + DAY, 'Anzac Day holiday');
    if (w === 6 && s === 'WA') add(d + 2 * DAY, 'Anzac Day holiday');

    // King's Birthday
    if (s === 'QLD') add(nth(year, 10, 1, 1), "King's Birthday");
    else if (s === 'WA' && !wa28) add(last(year, 9, 1), "King's Birthday");
    else add(nth(year, 6, 1, 2), "King's Birthday");

    // Labour Day and state days
    if (is('NSW', 'ACT', 'SA')) add(nth(year, 10, 1, 1), 'Labour Day');
    if (s === 'VIC') { add(nth(year, 3, 1, 2), 'Labour Day'); add(nth(year, 11, 2, 1), 'Melbourne Cup'); }
    if (s === 'TAS') add(nth(year, 3, 1, 2), 'Eight Hours Day');
    if (s === 'SA') add(nth(year, 3, 1, 2), 'Adelaide Cup Day');
    if (s === 'ACT') { add(nth(year, 3, 1, 2), 'Canberra Day'); add(onOrAfter(Date.UTC(year, 4, 27), 1), 'Reconciliation Day'); }
    if (s === 'QLD') add(nth(year, 5, 1, 1), 'Labour Day');
    if (s === 'NT') { add(nth(year, 5, 1, 1), 'May Day'); add(nth(year, 8, 1, 1), 'Picnic Day'); }
    if (s === 'WA') {
      if (wa28) {
        add(nth(year, 3, 1, year % 4 === 1 ? 3 : 2), 'Labour Day'); // third Monday in state election years
        add(nth(year, 11, 1, 2), 'Western Australia Day');
        if (year === 2028) add(Date.UTC(2028, 8, 25), 'Show Day');
        if (year === 2029) add(Date.UTC(2029, 8, 24), 'Show Day');
      } else {
        add(nth(year, 3, 1, 1), 'Labour Day');
        add(nth(year, 6, 1, 1), 'Western Australia Day');
      }
    }

    // Christmas
    var boxing = s === 'SA' ? 'Proclamation Day' : 'Boxing Day';
    d = Date.UTC(year, 11, 25); w = dow(d); add(d, 'Christmas Day');
    if (w === 6 || w === 0) add(Date.UTC(year, 11, 27), 'Christmas Day holiday');
    d = Date.UTC(year, 11, 26); w = dow(d);
    if (!(s === 'TAS' && (w === 6 || w === 0))) add(d, boxing);
    if (w === 6 || w === 0) add(Date.UTC(year, 11, 28), boxing + ' holiday');

    // Part-day holidays
    if (is('SA', 'NT')) { add(Date.UTC(year, 11, 24), 'Christmas Eve', 19); add(Date.UTC(year, 11, 31), "New Year's Eve", 19); }
    if (s === 'QLD') add(Date.UTC(year, 11, 24), 'Christmas Eve', 18);

    return (cache[key] = out);
  }

  function holidayAt(ms, state, extra) {
    var k = iso(ms);
    for (var i = 0; i < (extra || []).length; i++) {
      var x = extra[i];
      if (x.date === k && (x.state === 'ALL' || x.state === state)) return x.name || 'Public holiday';
    }
    var h = holidays(new Date(ms).getUTCFullYear(), state)[k];
    return h && new Date(ms).getUTCHours() >= h.from ? h.name : null;
  }

  /* ---------- timezones ---------- */
  var fmt = {};
  function offset(tz, utc) { // ms to add to UTC to get wall clock in tz
    fmt[tz] = fmt[tz] || new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    });
    var p = {};
    fmt[tz].formatToParts(new Date(utc)).forEach(function (x) { p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(utc / 1000) * 1000;
  }
  function wallToUtc(wall, state) {
    var tz = TZ[state], u = wall - offset(tz, wall);
    return wall - offset(tz, u);
  }
  function utcToWall(utc, tz) { return utc + offset(tz, utc); }
  function toSydney(wall, state) { return utcToWall(wallToUtc(wall, state), TZ.NSW); }

  /* ---------- pricing ---------- */
  function hm(t) { var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function cents(n) { return Math.round(n * 100) / 100; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function billable(dur, min, inc) {
    if (dur <= min) return min;
    return min + Math.ceil((dur - min) / inc) * inc;
  }

  /* Returns minutes per rate class for the booking, plus the public holiday name if one applies. */
  function classify(cfg, input) {
    var start = input.start, remote = input.mode !== 'onsite';
    var shift = remote && cfg.remoteClock === 'sydney' ? toSydney(start, input.state) - start : 0;
    var open = hm(cfg.hours.start), close = hm(cfg.hours.end);
    var out = { standard: 0, afterHours: 0, weekend: 0, holiday: 0 }, name = null, cls = 'standard';
    function at(wall) {
      var h = holidayAt(wall, input.state, cfg.extraHolidays);
      if (h) { name = name || h; return 'holiday'; }
      var c = wall + shift, d = dow(c);
      if (d === 0 || d === 6) return 'weekend';
      var m = Math.floor((c % DAY) / MIN);
      return m >= open && m < close ? 'standard' : 'afterHours';
    }
    for (var i = 0; i < input.duration; i++) { cls = at(start + i * MIN); out[cls]++; }
    return { minutes: out, last: cls, holiday: name, shift: shift };
  }

  /*
   * cfg values that are null mean "this applies, but the amount is confirmed in the quote".
   * input: { mode, state, area, setting, language, start, duration, interpreters, prep, now }
   */
  function estimate(cfg, input) {
    var mode = cfg.modes[input.mode];
    var tier = input.language ? cfg.tiers[input.language.tier] : null;
    var setting = cfg.settings[input.setting] || { pct: 0 };
    var n = input.interpreters || 1;
    var lines = [], notes = [], from = false, quote = false, reason = '';

    function add(id, label, amount, detail) {
      lines.push({ id: id, label: label, amount: amount === null ? null : cents(amount), detail: detail || '' });
      if (amount === null) from = true;
    }

    var c = classify(cfg, input);
    var bill = billable(input.duration, mode.min, mode.inc);
    c.minutes[c.last] += bill - input.duration; // rounding follows the rate the booking ends on

    if (!isNum(mode.rate)) { quote = true; reason = 'mode'; }
    if (tier && tier.pct === 'quote') { quote = true; reason = reason || 'language'; }
    if (input.mode === 'phone' && tier && tier.sign) { quote = true; reason = 'signPhone'; }
    if (!input.language) from = true;

    var base = quote ? 0 : (mode.rate * bill / 60) * n;
    if (!quote) {
      add('base', 'Interpreting time', base, { minutes: bill, rate: mode.rate, n: n });
      [['afterHours', 'After-hours surcharge'], ['weekend', 'Weekend surcharge'], ['holiday', 'Public holiday surcharge']]
        .forEach(function (x) {
          var mins = c.minutes[x[0]], pct = cfg.surcharge[x[0]];
          if (!mins || pct === 0) return;
          add(x[0], x[1], isNum(pct) ? mode.rate * mins / 60 * n * pct / 100 : null, { minutes: mins, pct: pct });
        });
      if (setting.pct !== 0) add('setting', setting.line || 'Specialist interpreting', isNum(setting.pct) ? base * setting.pct / 100 : null, { pct: setting.pct });
      if (tier && tier.pct !== 0) add('language', 'Language availability', isNum(tier.pct) ? base * tier.pct / 100 : null, { pct: tier.pct });
      if (input.mode === 'onsite') {
        var t = cfg.travel[input.area];
        if (t !== 0) add('travel', input.area === 'regional' ? 'Travel (regional)' : 'Travel (metro)', isNum(t) ? t * n : null);
      }
      if (input.prep) {
        add('prep', 'Preparation time', isNum(cfg.prep.rate) ? cfg.prep.rate * input.prep / 60 * n : null, { minutes: input.prep, rate: cfg.prep.rate, n: n });
      }
    }

    var sub = cents(lines.reduce(function (a, l) { return a + (l.amount || 0); }, 0));
    var gst = cfg.gst === 'add' ? cents(sub * 0.1) : cfg.gst === 'included' ? cents(sub / 11) : 0;
    var total = cfg.gst === 'add' ? cents(sub + gst) : sub;

    var startUtc = wallToUtc(input.start, input.state), now = input.now || Date.now();
    var hoursAway = (startUtc - now) / 3600000;
    var need = cfg.notice[input.mode === 'onsite' ? 'onsite' : 'remote'];

    return {
      quote: quote, reason: reason, from: from && !quote, total: total, subtotal: sub, gst: gst, lines: lines,
      billable: bill, minutes: c.minutes, holiday: c.minutes.holiday ? c.holiday : null, shift: c.shift,
      past: hoursAway < 0, shortNotice: hoursAway >= 0 && need > 0 && hoursAway < need,
      refundUntil: input.start - cfg.cancelDays * DAY, refundable: hoursAway >= cfg.cancelDays * 24
    };
  }

  return {
    estimate: estimate, holidays: holidays, holidayAt: holidayAt, classify: classify, billable: billable,
    toSydney: toSydney, wallToUtc: wallToUtc, utcToWall: utcToWall, iso: iso, TZ: TZ, isNum: isNum
  };
});
