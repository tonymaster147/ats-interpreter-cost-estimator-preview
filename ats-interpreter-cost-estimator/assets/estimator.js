/* ATS Interpreter Booking Cost Estimator: interface. Needs calc.js. No dependencies. */
(function () {
  'use strict';
  var C = window.ATSICECalc;
  var MIN = 60000, DAY = 86400000;
  var STATES = { NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', WA: 'Western Australia', SA: 'South Australia', TAS: 'Tasmania', ACT: 'Australian Capital Territory', NT: 'Northern Territory' };
  var MODES = {
    onsite: { label: 'On-site interpreting', desc: 'Interpreter attends in person', icon: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.500C19 14.800 12 21 12 21Z"/><circle cx="12" cy="9.500" r="2.500"/>' },
    video: { label: 'Video remote interpreting', desc: 'Interpreter joins your video call', icon: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 11 6-3.500v9L15 13"/>' },
    phone: { label: 'Phone interpreting', desc: 'Interpreter joins a three-way call', icon: '<path d="M5 4h4l1.600 4.200-2.300 1.500a11 11 0 0 0 6 6l1.500-2.300L20 15v4a1.500 1.500 0 0 1-1.600 1.500A15.500 15.500 0 0 1 3.500 5.600 1.500 1.500 0 0 1 5 4Z"/>' }
  };
  var GROUPS = { spoken: 'Spoken languages', sign: 'Sign language', first: 'Aboriginal and Torres Strait Islander languages' };
  var uid = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function rate(n) { return '$' + (n % 1 ? n.toFixed(2) : n); }
  function dur(m) {
    var h = Math.floor(m / 60), r = m % 60, out = [];
    if (h) out.push(h + (h === 1 ? ' hr' : ' hrs'));
    if (r) out.push(r + ' mins');
    return out.join(' ') || '0 mins';
  }
  function clock(ms) {
    var d = new Date(ms), h = d.getUTCHours(), m = d.getUTCMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' am' : ' pm');
  }
  function date(ms) { return new Date(ms).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  function svg(p, cls) { return '<svg class="' + (cls || 'atsice-ico') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  function parse(d, t) { return Date.parse(d + 'T' + t + ':00Z'); }

  function mount(root) {
    if (root.atsiceReady) return;
    root.atsiceReady = true;
    var cfg = JSON.parse(root.getAttribute('data-config'));
    var id = 'atsice' + (++uid);
    var enabled = Object.keys(MODES).filter(function (m) { return cfg.modes[m]; });
    if (!enabled.length) return;
    var langs = {};
    Object.keys(cfg.tiers).forEach(function (t) { cfg.tiers[t].languages.forEach(function (l) { langs[l] = { name: l, tier: t }; }); });

    function todayIn(state) { return C.utcToWall(Date.now(), C.TZ[state]); }
    function firstDate() { // first weekday outside the free-cancellation window
      var d = todayIn('NSW') + (cfg.cancelDays + 1) * DAY;
      d -= d % DAY;
      while ([0, 6].indexOf(new Date(d).getUTCDay()) > -1 || C.holidayAt(d + 12 * 36e5, 'NSW', cfg.extraHolidays)) d += DAY;
      return C.iso(d);
    }
    function initial() {
      return { mode: enabled.indexOf(cfg.startMode) > -1 ? cfg.startMode : enabled[0], setting: 'general', language: '', state: 'NSW', area: 'metro', date: firstDate(), time: '10:00', duration: 60, interpreters: 1, prepOn: false, prep: 30 };
    }
    var s = initial(), result = null;

    /* ---------- markup ---------- */
    function opt(v, l) { return '<option value="' + esc(v) + '">' + esc(l) + '</option>'; }
    var langOpts = opt('', 'Choose a language');
    Object.keys(GROUPS).forEach(function (g) {
      var list = Object.keys(langs).filter(function (l) { return cfg.tiers[langs[l].tier].group === g; });
      if (g === 'spoken') list.sort(function (a, b) { return a.localeCompare(b); });
      if (list.length) langOpts += '<optgroup label="' + esc(GROUPS[g]) + '">' + list.map(function (l) { return opt(l, l); }).join('') + '</optgroup>';
    });
    langOpts += '<optgroup label="Not listed">' + opt('Other language', 'Other language') + '</optgroup>';
    var times = '';
    for (var m = 0; m < 1440; m += 15) {
      var hh = (m < 600 ? '0' : '') + Math.floor(m / 60), mm = (m % 60 < 10 ? '0' : '') + m % 60;
      times += opt(hh + ':' + mm, clock(m * MIN));
    }
    function stepper(key, label, unit) {
      return '<div class="atsice-stepper" role="group" aria-label="' + esc(label) + '">' +
        '<button type="button" data-step="' + key + '" data-by="-1" aria-label="Decrease ' + esc(unit) + '">&minus;</button>' +
        '<output data-out="' + key + '" aria-live="polite"></output>' +
        '<button type="button" data-step="' + key + '" data-by="1" aria-label="Increase ' + esc(unit) + '">+</button></div>';
    }
    function head(n, t, tag) { return '<div class="atsice-step-head"><span class="atsice-num" aria-hidden="true">' + n + '</span><h3>' + t + '</h3>' + (tag ? '<span class="atsice-tag">' + tag + '</span>' : '') + '</div>'; }

    var logo = cfg.logo ? '<img class="atsice-logo" src="' + esc(cfg.logo) + '" alt="' + esc(cfg.brand) + '" width="200" height="40">' : '';
    root.innerHTML =
      (cfg.heading || logo ? '<div class="atsice-top"><div>' + (cfg.heading ? '<h2>' + esc(cfg.heading) + '</h2><div class="atsice-lead">Choose your booking details and see an estimate straight away.</div>' : '') + '</div>' + logo + '</div>' : '') +
      '<div class="atsice-grid"><div class="atsice-main"><div class="atsice-mini" aria-hidden="true"><span>Estimated cost<b data-el="mini"></b></span><button type="button" class="atsice-jump" tabindex="-1">See breakdown</button></div><form class="atsice-form" novalidate>' +

      '<section class="atsice-step">' + head(1, 'How should the interpreter join?') +
      '<div class="atsice-modes" role="radiogroup" aria-label="Type of interpreting">' + enabled.map(function (k) {
        return '<label class="atsice-mode"><input type="radio" name="' + id + '-mode" value="' + k + '"><span class="atsice-mode-in">' + svg(MODES[k].icon) +
          '<span><b>' + MODES[k].label + '</b><small>' + MODES[k].desc + '</small></span></span></label>';
      }).join('') + '</div></section>' +

      '<section class="atsice-step">' + head(2, 'Language and assignment') +
      '<div class="atsice-fields"><div class="atsice-field"><label for="' + id + '-lang">Language (to or from English)</label><select id="' + id + '-lang" data-key="language">' + langOpts + '</select></div>' +
      '<div class="atsice-field"><label for="' + id + '-set">Type of assignment</label><select id="' + id + '-set" data-key="setting">' +
      Object.keys(cfg.settings).map(function (k) { return opt(k, cfg.settings[k].label); }).join('') + '</select></div></div>' +
      '<div class="atsice-note" data-el="langNote" hidden></div></section>' +

      '<section class="atsice-step">' + head(3, 'Where and when') +
      '<div class="atsice-fields"><div class="atsice-field"><label for="' + id + '-state">State or territory</label><select id="' + id + '-state" data-key="state">' +
      Object.keys(STATES).map(function (k) { return opt(k, STATES[k]); }).join('') + '</select></div>' +
      '<div class="atsice-field" data-el="area"><label for="' + id + '-area">Venue location</label><select id="' + id + '-area" data-key="area">' + opt('metro', 'Metro area') + opt('regional', 'Regional or remote area') + '</select></div>' +
      '<div class="atsice-field"><label for="' + id + '-date">Date</label><input type="date" id="' + id + '-date" data-key="date" required></div>' +
      '<div class="atsice-field"><label for="' + id + '-time">Start time <span class="atsice-dim">(local)</span></label><select id="' + id + '-time" data-key="time">' + times + '</select></div></div>' +
      '<div class="atsice-field"><span class="atsice-label">How long?</span><div class="atsice-dur"><div class="atsice-chips">' +
      [30, 60, 90, 120, 180, 240, 480].map(function (x) { return '<button type="button" class="atsice-chip" data-dur="' + x + '" aria-pressed="false">' + dur(x) + '</button>'; }).join('') + '</div>' +
      stepper('duration', 'Booking length', 'booking length') + '</div></div>' +
      '<div class="atsice-day" aria-hidden="true"><div class="atsice-day-bar"><i class="atsice-day-std" data-el="std"></i><i class="atsice-day-bk" data-el="bk"></i><i class="atsice-day-bk" data-el="bk2"></i></div>' +
      '<div class="atsice-day-ax"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>12 am</span></div></div>' +
      '<div class="atsice-rate" data-el="rateNote" aria-live="polite"></div>' +
      '<div class="atsice-error" data-el="error" role="alert" hidden></div></section>' +

      '<section class="atsice-step">' + head(4, 'Extras', 'optional') +
      '<div class="atsice-row"><div><span class="atsice-label">Interpreters needed</span><small>Conference and long simultaneous sessions often need two, working in turns.</small></div>' + stepper('interpreters', 'Interpreters needed', 'interpreters') + '</div>' +
      (cfg.prep.on ? '<div class="atsice-row"><div><label class="atsice-switch"><input type="checkbox" data-key="prepOn"><span></span><b>Add preparation time</b></label><small>Time to read a brief, agenda or glossary before the session.</small></div><div data-el="prepBox" hidden>' + stepper('prep', 'Preparation time', 'preparation time') + '</div></div>' : '') +
      '</section><button type="button" class="atsice-reset">Start again</button></form></div>' +

      '<aside class="atsice-side" aria-label="Your estimate"><div class="atsice-panel">' +
      '<div class="atsice-eyebrow">Estimated cost</div><div class="atsice-total" data-el="total" aria-live="polite"></div>' +
      '<div class="atsice-sub" data-el="sub"></div><div class="atsice-lines" data-el="lines"></div><div class="atsice-alert" data-el="alert" hidden></div>' +
      '<div class="atsice-cancel" data-el="cancel"></div>' +
      '<a class="atsice-cta" data-el="cta" href="' + esc(cfg.bookUrl) + '"></a>' +
      '<div class="atsice-links">' + (cfg.whatsapp ? '<a data-el="wa" href="#" target="_blank" rel="noopener nofollow">Send on WhatsApp</a>' : '') + '<button type="button" data-el="print">Print or save PDF</button></div>' +
      '<div class="atsice-fine" data-el="fine"></div></div></aside></div>';

    function $(sel) { return root.querySelector(sel); }
    function el(n) { return $('[data-el="' + n + '"]'); }

    /* ---------- state ---------- */
    function sync() { // state -> inputs
      root.querySelectorAll('[name="' + id + '-mode"]').forEach(function (r) { r.checked = r.value === s.mode; });
      root.querySelectorAll('[data-key]').forEach(function (i) { if (i.type === 'checkbox') i.checked = !!s[i.dataset.key]; else i.value = s[i.dataset.key]; });
    }
    var LIMITS = { duration: [15, 720, 15], interpreters: [1, cfg.maxInterpreters, 1], prep: [15, 240, 15] };

    function input() {
      return {
        mode: s.mode, state: s.state, area: s.area, setting: s.setting,
        language: s.language ? (langs[s.language] || { name: s.language, tier: 'other' }) : null,
        start: parse(s.date, s.time), duration: s.duration, interpreters: s.interpreters, prep: cfg.prep.on && s.prepOn ? s.prep : 0, now: Date.now()
      };
    }

    function lineDetail(l) {
      var d = l.detail;
      if (l.id === 'base' || l.id === 'prep') return dur(d.minutes) + (C.isNum(d.rate) ? ' × ' + rate(d.rate) + '/hr' : '') + (d.n > 1 ? ' × ' + d.n + ' interpreters' : '');
      if (d && d.minutes) return dur(d.minutes) + (C.isNum(d.pct) ? ' at +' + d.pct + '%' : '');
      if (d && C.isNum(d.pct)) return '+' + d.pct + '%';
      return '';
    }
    function gstText() { return cfg.gst === 'none' ? 'GST not applicable' : 'Prices include GST'; }
    function title() { return MODES[s.mode].label + ' · ' + dur(s.duration) + (s.language ? ' · ' + s.language : '') + ' · ' + s.state; }
    function totalText(r) { return r.quote ? 'Price on request' : (r.from ? 'From ' : '') + money(r.total); }

    function rateNote(r) {
      var mins = r.minutes, parts = [], std = mins.standard > 0;
      if (r.holiday) parts.push('Public holiday (' + r.holiday + ', ' + s.state + ')');
      if (mins.weekend) parts.push('Weekend');
      if (mins.afterHours) parts.push('After-hours');
      var t = parts.length ? (std ? 'Partly standard hours, partly ' + parts.join(' and ').replace(/^./, function (c) { return c.toLowerCase(); }) : parts.join(' and ') + ' rate applies') : 'Standard hours';
      if (r.shift) t += '. Phone and video hours are measured in Sydney time (your ' + clock(parse(s.date, s.time)) + ' is ' + clock(parse(s.date, s.time) + r.shift) + ' in Sydney)';
      return { text: t + '.', std: !parts.length };
    }

    function drawDay(r) {
      var start = parse(s.date, s.time) % DAY / MIN;
      function pos(node, a, b) { node.style.left = Math.max(0, a) / 14.4 + '%'; node.style.width = Math.max(0, Math.min(1440, b) - Math.max(0, a)) / 14.4 + '%'; }
      function hm(t) { var p = t.split(':'); return p[0] * 60 + (+p[1]); }
      var sh = r.shift / MIN, day = new Date(parse(s.date, '12:00') + r.shift).getUTCDay();
      var closed = day === 0 || day === 6 || C.holidayAt(parse(s.date, '12:00'), s.state, cfg.extraHolidays);
      pos(el('std'), closed ? 0 : hm(cfg.hours.start) - sh, closed ? 0 : hm(cfg.hours.end) - sh);
      pos(el('bk'), start, start + s.duration);
      pos(el('bk2'), 0, start + s.duration - 1440); // the part that runs past midnight
    }

    function update() {
      var ok = /^\d{4}-\d\d-\d\d$/.test(s.date) && !isNaN(parse(s.date, s.time));
      el('area').hidden = s.mode !== 'onsite';
      $('[data-key="date"]').min = C.iso(todayIn(s.state));
      $('[data-out="duration"]').textContent = dur(s.duration);
      $('[data-out="interpreters"]').textContent = s.interpreters;
      if (cfg.prep.on) { $('[data-out="prep"]').textContent = dur(s.prep); el('prepBox').hidden = !s.prepOn; }
      root.querySelectorAll('[data-dur]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.dur === s.duration)); });
      root.querySelectorAll('[data-step]').forEach(function (b) { var k = b.dataset.step, L = LIMITS[k]; b.disabled = +b.dataset.by < 0 ? s[k] <= L[0] : s[k] >= L[1]; });

      var r = ok ? C.estimate(cfg, input()) : null;
      result = r && !r.past ? r : null;
      var err = !ok ? 'Choose a date for your booking.' : r.past ? 'That date and time has already passed. Choose a later one.' : '';
      el('error').textContent = err; el('error').hidden = !err;
      $('[data-key="date"]').setAttribute('aria-invalid', String(!!err));
      if (!result) {
        el('total').textContent = el('mini').textContent = '—'; el('sub').textContent = 'Choose a future date to see your estimate.';
        ['lines', 'cancel', 'fine', 'rateNote'].forEach(function (k) { el(k).textContent = ''; });
        el('alert').hidden = true; el('langNote').hidden = true; el('cta').textContent = 'Book an interpreter';
        el('cancel').hidden = true;
        return;
      }
      drawDay(r);
      var rn = rateNote(r);
      el('rateNote').textContent = rn.text; el('rateNote').classList.toggle('is-extra', !rn.std);

      var note = r.reason === 'signPhone' ? "Auslan can't be interpreted by phone. Choose video or on-site." :
        r.reason === 'language' ? 'Pricing for this language depends on interpreter availability, so we confirm it in a quote.' :
          !s.language ? 'Add your language for a closer estimate.' : '';
      el('langNote').textContent = note; el('langNote').hidden = !note;

      el('total').innerHTML = r.quote ? '<span class="atsice-por">Price on request</span>' : (r.from ? '<span class="atsice-from">From</span> ' : '') + esc(money(r.total));
      el('mini').textContent = totalText(r);
      el('sub').innerHTML = esc(title()) + '<br>' + esc(date(parse(s.date, s.time)) + ', ' + clock(parse(s.date, s.time)) + ' to ' + clock(parse(s.date, s.time) + s.duration * MIN));

      var html = r.lines.map(function (l) {
        var d = lineDetail(l);
        return '<div class="atsice-line"><span>' + esc(l.label) + (d ? '<small>' + esc(d) + '</small>' : '') + '</span><b' + (l.amount === null ? ' class="atsice-tbc">Confirmed in quote' : '>' + esc(money(l.amount))) + '</b></div>';
      }).join('');
      if (!r.quote) {
        html += '<div class="atsice-line atsice-gst"><span>' + (cfg.gst === 'included' ? 'Includes GST of' : cfg.gst === 'add' ? 'GST (10%)' : 'GST') + '</span><b>' + (cfg.gst === 'none' ? 'Not applicable' : esc(money(r.gst))) + '</b></div>';
        if (r.billable > s.duration) html += '<div class="atsice-min">' + (s.duration < cfg.modes[s.mode].min ? 'Minimum booking for this service is ' + dur(cfg.modes[s.mode].min) + '.' : 'Billed in ' + dur(cfg.modes[s.mode].inc) + ' blocks.') + '</div>';
      }
      el('lines').innerHTML = html; el('lines').hidden = !html;

      el('alert').hidden = !r.shortNotice;
      if (r.shortNotice) el('alert').innerHTML = 'Short notice. ' + (cfg.phone ? 'Call <a href="tel:' + esc(cfg.phone.replace(/[^\d+]/g, '')) + '">' + esc(cfg.phone) + '</a> to check availability.' : 'Contact us to check availability.');

      el('cancel').hidden = false;
      el('cancel').innerHTML = '<b>If you need to cancel</b>' + (r.refundable
        ? 'Full refund up to <strong>' + esc(clock(r.refundUntil) + ', ' + date(r.refundUntil)) + '</strong> (' + cfg.cancelDays + ' days before). No refund after that, subject to the Australian Consumer Law.'
        : 'This booking starts in less than ' + cfg.cancelDays + ' days, so no refund applies once it is confirmed, subject to the Australian Consumer Law.') +
        (cfg.cancelUrl ? ' <a href="' + esc(cfg.cancelUrl) + '">Policy</a>' : '');

      el('cta').textContent = r.quote ? 'Request a quote' : 'Book this interpreter';
      el('fine').textContent = 'Estimate only, in Australian dollars. ' + gstText() + '. A project manager confirms the final price before you pay. It can change with interpreter availability, travel or a longer session.';
      if (el('wa')) el('wa').href = 'https://wa.me/' + cfg.whatsapp.replace(/\D/g, '') + '?text=' + encodeURIComponent('Hi, I would like to book an interpreter.\n' + summary(r));
    }

    function summary(r) {
      var start = parse(s.date, s.time);
      return ['Service: ' + MODES[s.mode].label, 'Language: ' + (s.language || 'Not chosen yet'), 'Assignment: ' + cfg.settings[s.setting].label,
        'When: ' + date(start) + ', ' + clock(start) + ' (' + s.state + ' time) for ' + dur(s.duration),
        s.mode === 'onsite' ? 'Venue: ' + (s.area === 'regional' ? 'Regional or remote' : 'Metro') + ', ' + s.state : '',
        s.interpreters > 1 ? 'Interpreters: ' + s.interpreters : '', cfg.prep.on && s.prepOn ? 'Preparation: ' + dur(s.prep) : '',
        'Online estimate: ' + totalText(r)].filter(Boolean).join('\n');
    }

    function handoff() { // picked up by prefill.js on the booking page
      if (!result) return;
      var start = parse(s.date, s.time), syd = C.toSydney(start, s.state);
      try {
        sessionStorage.setItem('atsice-booking', JSON.stringify({
          saved: Date.now(), mode: s.mode, setting: s.setting, language: s.language, duration: dur(s.duration),
          date: C.iso(syd), time: clock(syd).toUpperCase(), summary: summary(result).replace(/\n/g, ' | ')
        }));
      } catch (e) { /* storage blocked: the booking page simply opens empty */ }
    }

    function print() {
      if (!result) return;
      var r = result, w = window.open('', '_blank');
      if (!w) return;
      var rows = summary(r).split('\n').slice(0, -1).map(function (x) { var i = x.indexOf(': '); return '<tr><td>' + esc(x.slice(0, i)) + '</td><td>' + esc(x.slice(i + 2)) + '</td></tr>'; }).join('');
      var cost = r.lines.map(function (l) { var d = lineDetail(l); return '<tr><td>' + esc(l.label) + (d ? ' <small>' + esc(d) + '</small>' : '') + '</td><td class="r">' + (l.amount === null ? 'Confirmed in quote' : esc(money(l.amount))) + '</td></tr>'; }).join('');
      if (cfg.gst === 'add') cost += '<tr><td>GST (10%)</td><td class="r">' + esc(money(r.gst)) + '</td></tr>';
      w.document.write('<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>Interpreter booking estimate</title><style>body{font:14px/1.55 "Open Sans",Arial,sans-serif;color:#0f0f0f;max-width:680px;margin:32px auto;padding:0 20px}img{height:40px;width:auto}h1{font:600 22px Poppins,Arial,sans-serif;color:#144924;margin:24px 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:8px 0;border-bottom:1px solid #dde6e0;vertical-align:top}td:first-child{color:#5d6b63;width:45%}.r{text-align:right}.t td{font-weight:700;color:#144924;font-size:18px;border:0}small{color:#5d6b63}</style></head><body>' +
        (cfg.logoPrint ? '<img src="' + esc(cfg.logoPrint) + '" alt="">' : '') + '<h1>Interpreter booking estimate</h1><div>Prepared ' + esc(date(todayIn('NSW'))) + '</div><table>' + rows + '</table><table>' + cost +
        '<tr class="t"><td>Estimated cost</td><td class="r">' + esc(totalText(r)) + '</td></tr></table><p><small>' + esc(el('fine').textContent) + ' ' + esc(el('cancel').textContent.replace(/ ?Policy$/, '').replace('If you need to cancel', 'Cancellation: ')) + '</small></p><p>' + esc([cfg.brand, cfg.phone, cfg.email].filter(Boolean).join('  |  ')) + '</p></body></html>');
      w.document.close();
      w.focus();
      var img = w.document.images[0], go = function () { w.print(); };
      if (img && !img.complete) { img.onload = img.onerror = go; } else go();
    }

    /* ---------- events ---------- */
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t.name === id + '-mode') s.mode = t.value;
      else if (t.dataset.key) s[t.dataset.key] = t.type === 'checkbox' ? t.checked : t.value;
      else return;
      update();
    });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button, a');
      if (!b || !root.contains(b)) return;
      if (b.dataset.dur) s.duration = +b.dataset.dur;
      else if (b.dataset.step) { var k = b.dataset.step, L = LIMITS[k]; s[k] = Math.min(L[1], Math.max(L[0], s[k] + L[2] * b.dataset.by)); }
      else if (b.classList.contains('atsice-reset')) { s = initial(); sync(); }
      else if (b.classList.contains('atsice-jump')) return $('.atsice-side').scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (b === el('print')) return print();
      else if (b === el('cta')) return handoff();
      else return;
      update();
    });
    $('form').addEventListener('submit', function (e) { e.preventDefault(); });

    // Keep the total in view: a bar on small screens, the whole panel on wide ones.
    // Done with position:fixed because the theme's overflow rules break position:sticky.
    var mini = $('.atsice-mini'), main = $('.atsice-main'), side = $('.atsice-side'), panel = $('.atsice-panel'), queued = false;
    function follow(on) {
      var st = panel.style, box = side.getBoundingClientRect(), h = panel.offsetHeight;
      var top = Math.min(24, window.innerHeight - h - 24); // a panel taller than the screen shows its lower part
      st.position = st.top = st.bottom = st.left = st.width = '';
      if (!on || box.top >= top || box.height <= h) return;
      st.width = box.width + 'px';
      if (box.bottom - h < top) { st.position = 'absolute'; st.bottom = '0'; st.left = '0'; }
      else { st.position = 'fixed'; st.top = top + 'px'; st.left = box.left + 'px'; }
    }
    function pin() {
      queued = false;
      follow(getComputedStyle(mini).display === 'none');
      var box = main.getBoundingClientRect(), on = box.top < 0 && box.bottom > 160;
      mini.classList.toggle('is-fixed', on);
      main.style.paddingTop = on && mini.offsetHeight ? mini.offsetHeight + 16 + 'px' : '';
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(pin); } }
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    root.addEventListener('input', queue);
    root.addEventListener('click', queue);

    sync();
    update();
    root.classList.add('is-ready');
  }

  function boot() { document.querySelectorAll('.atsice[data-config]').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.ATSICE = { mount: mount };
})();
