/* Runway v0.24.0.
   - Signs in with Google (token flow, token kept in memory only).
   - Opens the sheets the person picks (drive.file scope): the home-search sheet and the Runway planning sheet.
   - Shows Overview, Tasks, Decisions, Housing, a side-by-side Compare view, Requirements, Chronology, Journal and Documents.
   - Editors (by Google's sharing settings) can check off tasks, add tasks, decisions and journal entries, and change a home's status pick why a home was rejected, keep the tour Decision in step with the status, add document links, check each home against the requirements, add a home, log a builder contact, and log a tour room by room.
   Sheet text is always inserted as text (never as HTML). */
(function () {
  'use strict';

  var APP_VERSION = '0.24.0';
  var C = window.RUNWAY_CONFIG;
  var SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
  var DRAFT_KEY = 'runway.tourdrafts'; // half-finished tours, kept on this device only
  var HOME_KEY = 'runway.sheet'; // only a sheet's id and name are stored; neither is secret
  var PLAN_KEY = 'runway.plan';
  var TABS = { listing: 'Home Listing', tours: 'Home Tour Notes', contacts: 'Contacts Log' };
  var DOCS_TAB = 'Documents & Links';
  var PLAN_TABS = { tasks: 'Tasks', decisions: 'Decisions', streams: 'Workstreams' };
  // Same list as the Rejected Reason question in the Home Listing Form.
  var REASONS = ['No enclosed WC', 'Small lots', 'Limited lot selection', 'Build quality or reviews', 'Flooring or finishes', 'Layout', 'No models available', 'Over budget', 'Other (explain in Notes)'];
  var STATUS_ORDER = ['Active', 'To tour', 'Researching', 'Toured', 'Rejected', 'Purchased'];

  var state = {
    token: null, expires: 0, user: null, sheet: loadStore(HOME_KEY), plan: loadStore(PLAN_KEY),
    role: null, planRole: null, data: null, planData: null, planError: null,
    loadedAt: null, busy: false, error: null, saving: false, notice: null, drafts: loadDrafts(), openForms: {}, tourRoom: {}, routeArg: '',
    route: 'overview', openHomes: {}, openReq: {}, compareIds: null, compareDiff: false, filter: 'All', taskStream: 'All', showDone: false, needSignIn: true
  };

  var app = document.getElementById('app');
  if (window.top !== window.self) {
    app.textContent = 'Runway cannot be shown inside another page. Open it directly in your browser.';
    return;
  }

  /* ---------- small helpers ---------- */
  function loadStore(key) {
    try { var s = JSON.parse(localStorage.getItem(key) || 'null'); return s && s.id ? s : null; }
    catch (e) { return null; }
  }
  function saveStore(key, s) {
    try { if (s) localStorage.setItem(key, JSON.stringify({ id: s.id, name: s.name })); else localStorage.removeItem(key); }
    catch (e) { /* storage unavailable */ }
  }
  function enc(s) { return encodeURIComponent(s); }
  function colLetter(i) {
    var s = ''; i++;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  // Text typed in the app must never be read by Sheets as a formula (a leading apostrophe forces plain text).
  function safeText(v) {
    var t = String(v === null || v === undefined ? '' : v);
    return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function todayText() { return new Date().toLocaleDateString('en-US'); }
  function startOfToday() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function isoToUs(v) { var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? (+m[2]) + '/' + (+m[3]) + '/' + m[1] : ''; }
  function safeUrl(u) {
    try {
      var x = new URL(u, location.href);
      return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '#';
    } catch (e) { return '#'; }
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'href') el.setAttribute('href', safeUrl(v));
      else el.setAttribute(k, v === true ? '' : v);
    });
    var kids = Array.prototype.slice.call(arguments, 2);
    (function add(list) {
      list.forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false) return;
        if (Array.isArray(kid)) return add(kid);
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      });
    })(kids);
    return el;
  }
  function num(s) {
    var n = parseFloat(String(s || '').replace(/[$,\s]/g, ''));
    return isNaN(n) ? null : n;
  }
  function money(n) {
    return n === null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }
  function parseDate(s) {
    var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null;
  }
  function fmtDate(d) {
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }
  function col(o, re) {
    var keys = Object.keys(o);
    for (var i = 0; i < keys.length; i++) if (re.test(keys[i])) return o[keys[i]];
    return '';
  }
  function groupBy(rows, key) {
    var m = {};
    rows.forEach(function (r) { var k = r[key]; if (k) (m[k] = m[k] || []).push(r); });
    return m;
  }
  function table(values) {
    if (!values || !values.length) return [];
    var head = values[0].map(function (s) { return String(s == null ? '' : s).trim(); });
    var rows = values.slice(1).map(function (r, i) {
      var o = { _row: i + 2 };
      head.forEach(function (k, j) { if (k && o[k] === undefined) o[k] = r[j] == null ? '' : String(r[j]).trim(); });
      return o;
    }).filter(function (o) {
      return Object.keys(o).some(function (k) { return k !== '_row' && o[k] !== ''; });
    });
    rows.head = head;
    return rows;
  }
  function waitFor(test, ms) {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function poll() {
        if (test()) return resolve();
        if (Date.now() - t0 > (ms || 10000)) return reject(new Error('A Google script did not load. Check your connection and any content blockers, then reload.'));
        setTimeout(poll, 100);
      })();
    });
  }

  /* ---------- sign-in (token stays in memory) ---------- */
  function requestToken(prompt) {
    return waitFor(function () { return window.google && google.accounts && google.accounts.oauth2; }).then(function () {
      return new Promise(function (resolve, reject) {
        var client = google.accounts.oauth2.initTokenClient({
          client_id: C.CLIENT_ID,
          scope: SCOPES,
          callback: function (r) {
            if (r.error) return reject(new Error(r.error_description || r.error));
            state.token = r.access_token;
            state.expires = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
            resolve();
          },
          error_callback: function (e) {
            reject(new Error(e && e.type === 'popup_closed' ? 'Sign-in was cancelled.' : (e && (e.message || e.type)) || 'Sign-in failed.'));
          }
        });
        client.requestAccessToken(prompt ? { prompt: prompt } : {});
      });
    });
  }
  function ensureToken() {
    if (state.token && Date.now() < state.expires) return Promise.resolve();
    return requestToken('');
  }
  function api(url, opts) {
    opts = opts || {};
    return ensureToken().then(function () {
      var init = { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + state.token } };
      if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
      return fetch(url, init);
    }).then(function (r) {
      if (r.ok) return r.json();
      return r.json().catch(function () { return {}; }).then(function (j) {
        var err = new Error((j.error && j.error.message) || ('Request failed (' + r.status + ')'));
        err.status = r.status;
        err.reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || (j.error && j.error.status) || '';
        throw err;
      });
    });
  }
  function explain(e) {
    var m = String(e.message || '');
    if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(m + ' ' + e.reason)) {
      var which = /drive/i.test(m) ? 'Google Drive API' : /sheets/i.test(m) ? 'Google Sheets API' : 'a Google API';
      return { title: 'Enable the ' + which, body: 'That API is switched off in the Runway Google Cloud project. Turn it on under APIs & Services > Library, wait a minute, then choose Refresh.' };
    }
    if (e.status === 401) return { title: 'Your sign-in expired', body: 'Sign in again to continue.', action: 'signin' };
    if (e.status === 404 || /not found/i.test(m)) return { title: 'Runway cannot open that sheet', body: 'Choose the sheet again. Runway can only open a file you pick with the Choose sheet button.', action: 'pick' };
    if (e.status === 403) return { title: 'Google refused access', body: m || 'This account may not have access to the sheet.', action: 'pick' };
    if (/Unable to parse range/i.test(m)) return { title: 'That does not look like the right sheet', body: 'The sheet you chose is missing a tab Runway needs (' + m + '). Choose the sheet again.', action: 'pick' };
    return { title: 'Something went wrong', body: m || 'Try again.' };
  }

  /* ---------- Picker ---------- */
  function pickSheet(title) {
    return ensureToken().then(function () {
      return waitFor(function () { return window.gapi; });
    }).then(function () {
      return new Promise(function (res) { gapi.load('picker', { callback: res }); });
    }).then(function () {
      return new Promise(function (resolve) {
        var mine = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setIncludeFolders(false);
        var shared = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setOwnedByMe(false).setLabel('Shared with me');
        var picker = new google.picker.PickerBuilder()
          .addView(mine).addView(shared)
          .setOAuthToken(state.token).setDeveloperKey(C.API_KEY).setAppId(C.PROJECT_NUMBER)
          .setTitle(title || 'Choose your sheet')
          .setCallback(function (d) {
            if (d.action === google.picker.Action.PICKED) resolve({ id: d.docs[0].id, name: d.docs[0].name });
            else if (d.action === google.picker.Action.CANCEL) resolve(null);
          }).build();
        picker.setVisible(true);
      });
    });
  }

  /* ---------- data ---------- */
  function buildPlans(rows) {
    var out = { has: false, head: [], list: [] };
    if (!rows) return out;
    out.head = rows.head || []; out.has = out.head.length > 0;
    rows.forEach(function (r) {
      if (!r['Home ID']) return;
      var st = String(r['Status'] || '').trim().toLowerCase();
      out.list.push({ row: r._row, id: r['Home ID'], date: parseDate(r['Planned date']), dateText: r['Planned date'] || '', time: String(r['Time'] || '').trim(),
        note: r['Note'] || '', status: st === 'done' ? 'Done' : (st === 'cancelled' || st === 'canceled') ? 'Cancelled' : 'Planned', by: r['Planned by'] || '' });
    });
    return out;
  }
  // Sheets hands a time back as "1:00:00 PM" (seconds) or, in some locales, "13:00:00". Accept all of them.
  function parseClock(t) {
    var m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (!m) return null;
    var hh = +m[1], mm = +m[2];
    if (m[3]) { if (hh < 1 || hh > 12) return null; hh = (hh % 12) + (/pm/i.test(m[3]) ? 12 : 0); }
    else if (hh > 23) return null;
    return mm > 59 ? null : { h: hh, m: mm };
  }
  function clockText(t) {
    var c = parseClock(t);
    return c ? ((c.h % 12) || 12) + ':' + pad(c.m, 2) + ' ' + (c.h >= 12 ? 'PM' : 'AM') : String(t || '');
  }
  function planStart(p) {
    if (!p.date) return null;
    var d = new Date(p.date.getTime()), c = parseClock(p.time);
    if (c) { d.setHours(c.h, c.m, 0, 0); return { start: d, timed: true }; }
    return { start: d, timed: false };
  }
  function planWhen(p) { return p.dateText + (p.time ? ' at ' + clockText(p.time) : ''); }
  function timeFromInput(v) {
    var c = parseClock(v);
    return c ? ((c.h % 12) || 12) + ':' + pad(c.m, 2) + ' ' + (c.h >= 12 ? 'PM' : 'AM') : '';
  }
  function ymd(d) { return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2); }
  function ymdhms(d) { return ymd(d) + 'T' + pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + '00'; }
  function tourSlot(ps) {
    if (ps.timed) return { a: ymdhms(ps.start), b: ymdhms(new Date(ps.start.getTime() + 60 * 60000)), allDay: false };
    var next = new Date(ps.start.getTime()); next.setDate(next.getDate() + 1);
    return { a: ymd(ps.start), b: ymd(next), allDay: true };
  }
  function tourDetails(x, p) {
    return [[x.contact, x.phone].filter(Boolean).length ? 'Builder contact: ' + [x.contact, x.phone].filter(Boolean).join(', ') : '', p.note].filter(Boolean).join('\n');
  }
  function calendarLink(x, p) {
    var ps = planStart(p); if (!ps) return null;
    var slot = tourSlot(ps), loc = x.address || [x.community, x.city].filter(Boolean).join(', ');
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + enc('Tour: ' + homeName(x)) + '&dates=' + slot.a + '/' + slot.b +
      '&details=' + enc(tourDetails(x, p)) + '&location=' + enc(loc);
  }
  function icsText(t) { return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function downloadIcs(x, p) {
    var ps = planStart(p); if (!ps) return;
    var slot = tourSlot(ps), loc = x.address || [x.community, x.city].filter(Boolean).join(', ');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Runway//Tour//EN', 'BEGIN:VEVENT', 'UID:tour-' + x.id + '-' + slot.a + '@runway',
      'DTSTAMP:' + ymdhms(new Date()), slot.allDay ? 'DTSTART;VALUE=DATE:' + slot.a : 'DTSTART:' + slot.a, slot.allDay ? 'DTEND;VALUE=DATE:' + slot.b : 'DTEND:' + slot.b,
      'SUMMARY:' + icsText('Tour: ' + homeName(x)), 'LOCATION:' + icsText(loc), 'DESCRIPTION:' + icsText(tourDetails(x, p)), 'END:VEVENT', 'END:VCALENDAR'];
    try {
      var url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
      var a = document.createElement('a'); a.href = url; a.download = 'tour-' + x.id + '.ics';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    } catch (e) { toast('Could not create the calendar file on this device.', true); }
  }
  function plannedFor(id) {
    return state.data.plans.list.filter(function (p) { return p.id === id && p.status === 'Planned'; }).sort(function (a, b) { return (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0); });
  }
  function nextPlan(id) {
    var today = startOfToday(), up = plannedFor(id).filter(function (p) { return p.date && p.date >= today; });
    return up[0] || null;
  }
  function buildChecks(rows) {
    var out = { has: false, head: [], map: {} };
    if (!rows) return out;
    out.head = rows.head || []; out.has = out.head.length > 0;
    rows.forEach(function (r) {
      if (r['Home ID'] && r['Req ID']) out.map[r['Home ID'] + '|' + r['Req ID']] = { row: r._row, result: r['Result'] || '', note: r['Note'] || '', by: r['Checked by'] || '', on: r['Checked on'] || '' };
    });
    return out;
  }
  function normKey(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function tourValue(tour, fieldName) {
    if (!tour || !fieldName) return '';
    var fk = normKey(fieldName), keys = Object.keys(tour);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === '_row') continue;
      var kk = normKey(keys[i]);
      if (kk === fk || (fk.length >= 6 && kk.indexOf(fk) === 0) || (kk.length >= 6 && fk.indexOf(kk) === 0)) { if (tour[keys[i]] !== '') return tour[keys[i]]; }
    }
    return '';
  }
  function reqStatus(x, q) {
    var c = state.data.checks.map[x.id + '|' + q.id];
    var ex = c && /^(yes|no)$/i.test(c.result) ? (c.result.toLowerCase() === 'yes' ? 'Yes' : 'No') : '';
    var tv = tourValue(x.tour, q.tourField), tl = tv.trim().toLowerCase(), derived = '';
    if (tl === 'yes' || tl === 'no') derived = ((tl === 'yes') !== (q.meetsWhen === 'No')) ? 'Yes' : 'No';
    return { result: ex || derived || 'Unknown', source: ex ? 'checked' : derived ? 'tour' : 'none', hint: derived ? '' : tv, note: c ? c.note : '', existing: c || null };
  }
  function latestTour(rows) {
    var best = null;
    rows.forEach(function (r) {
      var d = parseDate(r['Visit Date']), bd = best ? parseDate(best['Visit Date']) : null;
      if (!best || (d && (!bd || d >= bd)) || (!d && !bd && r._row > best._row)) best = r;
    });
    return best;
  }
  function buildHomes(t) {
    var tours = groupBy(t.tours, 'Home ID');
    var contacts = groupBy(t.contacts, 'Home ID');
    return t.listing.filter(function (r) { return r['Home ID']; }).map(function (r) {
      var id = r['Home ID'];
      return {
        id: id, row: r._row, added: String(r['Timestamp'] || '').trim().split(' ')[0], beds: r['Bedrooms'] || '', baths: r['Baths'] || '', garage: r['Garage'] || '', builder: r['Builder'] || '', model: r['Model'] || '', community: r['Community'] || '', city: r['City'] || '',
        status: canonStatus(r['Status']), price: num(r['List Price']), upgrade: num(r['Upgrade Price']), sqft: num(r['Sq Ft']),
        visit: r['Visit Date'] || '', reason: r['Rejected Reason'] || '', url: r['Listing URL'] || '', address: r['Address'] || '',
        notes: r['Notes'] || '', contact: r['Contact'] || '', phone: r['Tel. #'] || '',
        tour: latestTour(tours[id] || []), contacts: contacts[id] || []
      };
    });
  }
  function canonStatus(s) {
    var k = String(s || '').trim().toLowerCase();
    for (var i = 0; i < STATUS_ORDER.length; i++) if (STATUS_ORDER[i].toLowerCase() === k) return STATUS_ORDER[i];
    return String(s || '').trim() || 'Unknown';
  }
  function homeName(x) { return (x.builder + (x.model ? ': ' + x.model : '')).trim() || x.id; }


  function buildTasks(rows) {
    return rows.filter(function (r) { return r['Task ID'] || r['Title']; }).map(function (r) {
      var s = String(r['Status'] || '').trim().toLowerCase();
      return {
        id: r['Task ID'] || '', row: r._row, stream: r['Workstream'] || 'Other', title: r['Title'] || '',
        owner: r['Owner'] || '', due: parseDate(r['Due date']), dueText: r['Due date'] || '',
        status: s === 'done' ? 'Done' : s === 'in progress' ? 'In progress' : s === 'skipped' ? 'Skipped' : 'To do',
        notes: r['Notes'] || '', completedOn: r['Completed on'] || '', completedBy: r['Completed by'] || ''
      };
    });
  }
  function buildDecisions(rows) {
    return rows.filter(function (r) { return r['Decision ID'] || r['Decision']; }).map(function (r) {
      var s = String(r['Status'] || '').trim().toLowerCase();
      return {
        id: r['Decision ID'] || '', row: r._row, title: r['Decision'] || '', stream: r['Workstream'] || '',
        options: r['Options'] || '', owners: r['Owners'] || '', cfp: /^y/i.test(r['CFP input needed'] || ''),
        status: s === 'decided' ? 'Decided' : s === 'deferred' ? 'Deferred' : 'Open',
        decidedOn: r['Decided on'] || '', reasoning: r['Reasoning'] || '', loggedBy: r['Logged by'] || ''
      };
    });
  }

  function buildJournal(rows) {
    return rows.filter(function (r) { return r['Entry ID'] || r['Title']; }).map(function (r) {
      return { id: r['Entry ID'] || '', row: r._row, date: parseDate(r['Date']), dateText: r['Date'] || '', title: r['Title'] || '', detail: r['Detail'] || '', by: r['Logged by'] || '' };
    });
  }

  function fetchRole(file) {
    return api('https://www.googleapis.com/drive/v3/files/' + enc(file.id) + '?fields=name,capabilities(canEdit)&supportsAllDrives=true')
      .then(function (f) { file.name = f.name; return f.capabilities && f.capabilities.canEdit ? 'editor' : 'viewer'; })
      .catch(function (e) { if (e.status === 404) throw e; return 'unknown'; });
  }

  function loadHome() {
    var id = enc(state.sheet.id);
    return fetchRole(state.sheet).then(function (r) {
      state.role = r; saveStore(HOME_KEY, state.sheet);
      var ranges = Object.keys(TABS).map(function (k) { return 'ranges=' + enc("'" + TABS[k] + "'"); }).join('&');
      return api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values:batchGet?' + ranges + '&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE');
    }).then(function (j) {
      var keys = Object.keys(TABS), by = {};
      (j.valueRanges || []).forEach(function (vr, i) { by[keys[i]] = table(vr.values); });
      return api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + enc("'" + DOCS_TAB + "'") + '?valueRenderOption=FORMATTED_VALUE')
        .then(function (d) { by.docs = table(d.values); })
        .catch(function () { by.docs = null; })
        .then(function () {
          return api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + enc("'Home Checks'") + '?valueRenderOption=FORMATTED_VALUE')
            .then(function (c) { by.checks = table(c.values); })
            .catch(function () { by.checks = null; });
        })
        .then(function () {
          return api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + enc("'Tour Plans'") + '?valueRenderOption=FORMATTED_VALUE')
            .then(function (c) { by.plans = table(c.values); })
            .catch(function () { by.plans = null; });
        })
        .then(function () { return by; });
    }).then(function (by) {
      state.data = { homes: buildHomes(by), tours: by.tours || [], contacts: by.contacts || [], docs: by.docs, listingHead: (by.listing && by.listing.head) || [], docsHead: (by.docs && by.docs.head) || [], listingRows: by.listing || [], tourHead: (by.tours && by.tours.head) || [], checks: buildChecks(by.checks), plans: buildPlans(by.plans), contactsHead: (by.contacts && by.contacts.head) || [] };
    });
  }

  function loadPlan() {
    if (!state.plan) { state.planData = null; state.planError = null; return Promise.resolve(); }
    var id = enc(state.plan.id);
    state.planError = null;
    return fetchRole(state.plan).then(function (r) {
      state.planRole = r; saveStore(PLAN_KEY, state.plan);
      var keys = Object.keys(PLAN_TABS);
      var ranges = keys.map(function (k) { return 'ranges=' + enc("'" + PLAN_TABS[k] + "'"); }).join('&');
      return api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values:batchGet?' + ranges + '&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE');
    }).then(function (j) {
      var keys = Object.keys(PLAN_TABS), by = {};
      (j.valueRanges || []).forEach(function (vr, i) { by[keys[i]] = table(vr.values); });
      var tasks = by.tasks || [], decisions = by.decisions || [];
      state.planData = {
        tasks: buildTasks(tasks), decisions: buildDecisions(decisions),
        streams: (by.streams || []).map(function (r) { return r['Workstream']; }).filter(Boolean),
        journal: [], hasJournal: false,
        heads: { tasks: tasks.head || [], decisions: decisions.head || [], journal: [] }
      };
      state.planData.links = [];
      return api(sheetsBase() + '/values/' + enc("'Journal'") + '?valueRenderOption=FORMATTED_VALUE').then(function (j) {
        var rows = table(j.values);
        state.planData.journal = buildJournal(rows); state.planData.heads.journal = rows.head || [];
        state.planData.hasJournal = !!(rows.head && rows.head.length);
      }).catch(function () { state.planData.journal = []; state.planData.hasJournal = false; })
      .then(function () {
        return api(sheetsBase() + '/values/' + enc("'Links'") + '?valueRenderOption=FORMATTED_VALUE').then(function (j) {
          state.planData.links = table(j.values).map(function (r) { return { name: r['Name'] || '', url: r['URL'] || '', group: r['Group'] || '', field: r['Prefill field'] || '' }; });
        }).catch(function () { state.planData.links = []; });
      }).then(function () {
        state.planData.requirements = []; state.planData.hasRequirements = false;
        return api(sheetsBase() + '/values/' + enc("'Requirements'") + '?valueRenderOption=FORMATTED_VALUE').then(function (j) {
          var rows = table(j.values);
          state.planData.hasRequirements = !!(rows.head && rows.head.length);
          state.planData.requirements = rows.map(function (r) {
            return { section: r['Section'] || 'Other', group: r['Group'] || '', text: r['Requirement'] || '', detail: r['Detail'] || '',
              tracked: trackedKind(r['Where it is tracked']), trackedText: r['Where it is tracked'] || '', priority: r['Priority'] || '',
              id: r['Req ID'] || r['Requirement'] || '', tourField: r['Tour field'] || '', meetsWhen: /^no/i.test(r['Meets when'] || '') ? 'No' : 'Yes' };
          }).filter(function (q) { return q.text; });
        }).catch(function () { state.planData.requirements = []; state.planData.hasRequirements = false; });
      });
    }).catch(function (e) { state.planData = null; state.planError = explain(e); });
  }

  function loadAll() {
    state.busy = true; state.error = null; render();
    var p = Promise.resolve();
    if (!state.user) p = api('https://www.googleapis.com/oauth2/v3/userinfo').then(function (u) { state.user = u; });
    if (state.sheet) p = p.then(loadHome);
    return p.then(loadPlan)
      .then(function () { state.loadedAt = new Date(); })
      .catch(function (e) { state.error = explain(e); })
      .then(function () { state.busy = false; render(); });
  }

  /* ---------- writing to the planning sheet (editors only; Google enforces this) ---------- */
  function who() { return (state.user && (state.user.given_name || state.user.email)) || ''; }
  function canEditPlan() { return state.planRole === 'editor'; }
  function sheetsBase() { return 'https://sheets.googleapis.com/v4/spreadsheets/' + enc(state.plan.id); }
  function readCell(tab, a1) {
    return api(sheetsBase() + '/values/' + enc("'" + tab + "'!" + a1)).then(function (j) { return j.values && j.values[0] ? String(j.values[0][0]) : ''; });
  }
  function writeCells(data) {
    return api(sheetsBase() + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data: data } });
  }
  function appendRow(tab, values) {
    return api(sheetsBase() + '/values/' + enc("'" + tab + "'!A1") + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { method: 'POST', body: { values: [values] } });
  }
  function guardRow(tab, head, idName, id, row) {
    var i = head.indexOf(idName);
    if (i < 0 || !id) return Promise.resolve();
    return readCell(tab, colLetter(i) + row).then(function (v) {
      if (v !== id) throw new Error('The sheet changed since it was loaded. Runway refreshed it. Please try again.');
    });
  }
  function cell(tab, head, name, row, value) {
    var i = head.indexOf(name);
    return i < 0 ? null : { range: "'" + tab + "'!" + colLetter(i) + row, values: [[safeText(value)]] };
  }
  function rowLoose(head, obj) {
    var cut = head.indexOf(''); var cols = cut >= 0 ? head.slice(0, cut) : head;
    var map = {}; Object.keys(obj).forEach(function (k) { map[normKey(k)] = obj[k]; });
    return cols.map(function (k) { var v = map[normKey(k)]; return v === undefined ? '' : safeText(v); });
  }
  function rowFrom(head, obj) { return head.map(function (k) { return obj[k] === undefined ? '' : safeText(obj[k]); }); }
  function nextId(items, prefix) {
    var max = 0;
    items.forEach(function (x) { var m = String(x.id).match(/(\d+)$/); if (m) max = Math.max(max, +m[1]); });
    return prefix + '-' + pad(max + 1, 3);
  }

  function setTaskStatus(t, status) {
    var head = state.planData.heads.tasks;
    if (head.indexOf('Status') < 0) return Promise.reject(new Error('The Tasks tab needs a Status column.'));
    var done = status === 'Done';
    var data = [cell('Tasks', head, 'Status', t.row, status),
      cell('Tasks', head, 'Completed on', t.row, done ? todayText() : ''),
      cell('Tasks', head, 'Completed by', t.row, done ? who() : '')].filter(Boolean);
    return guardRow('Tasks', head, 'Task ID', t.id, t.row).then(function () { return writeCells(data); }).then(function () {
      t.status = status; t.completedOn = done ? todayText() : ''; t.completedBy = done ? who() : '';
    });
  }
  function addTask(f) {
    var P = state.planData;
    var obj = { 'Task ID': nextId(P.tasks, 'T'), 'Workstream': f.stream, 'Title': f.title, 'Owner': f.owner, 'Due date': isoToUs(f.due), 'Status': 'To do', 'Notes': f.notes };
    return appendRow('Tasks', rowFrom(P.heads.tasks, obj)).then(loadPlan);
  }
  function addDecision(f) {
    var P = state.planData;
    var obj = { 'Decision ID': nextId(P.decisions, 'D'), 'Decision': f.title, 'Workstream': f.stream, 'Options': f.options, 'Owners': f.owners, 'CFP input needed': f.cfp, 'Status': 'Open', 'Logged by': who() };
    return appendRow('Decisions', rowFrom(P.heads.decisions, obj)).then(loadPlan);
  }
  function canEditHome() { return state.role === 'editor'; }
  function homeBase() { return 'https://sheets.googleapis.com/v4/spreadsheets/' + enc(state.sheet.id); }
  function splitReasons(text) {
    return String(text || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }
  function setHomeStatus(x, status, reasons, syncTour) {
    var head = state.data.listingHead, iS = head.indexOf('Status'), iId = head.indexOf('Home ID'), iR = head.indexOf('Rejected Reason');
    if (iS < 0 || iId < 0) return Promise.reject(new Error('The Home Listing tab needs Status and Home ID columns.'));
    if (STATUS_ORDER.indexOf(status) < 0) return Promise.reject(new Error('Choose one of the standard statuses.'));
    var rejected = status === 'Rejected';
    reasons = rejected ? (reasons || []) : [];
    if (rejected && !reasons.length) return Promise.reject(new Error('Pick at least one reason for the rejection.'));
    if (reasons.some(function (r) { return REASONS.indexOf(r) < 0; })) return Promise.reject(new Error('Choose reasons from the list.'));
    var reasonText = reasons.join(', ');
    var tour = syncTour ? x.tour : null, th = state.data.tourHead || [];
    var iD = th.indexOf('Decision'), iTid = th.indexOf('Home ID');
    if (tour && (iD < 0 || iTid < 0)) return Promise.reject(new Error('The Home Tour Notes tab needs Decision and Home ID columns.'));
    function guard(tab, colIndex, row, id) {
      return api(homeBase() + '/values/' + enc("'" + tab + "'!" + colLetter(colIndex) + row)).then(function (j) {
        var v = j.values && j.values[0] ? String(j.values[0][0]).trim() : '';
        if (v !== id) throw new Error('The sheet changed since it was loaded. Runway refreshed it. Please try again.');
      });
    }
    return guard('Home Listing', iId, x.row, x.id).then(function () {
      return tour ? guard('Home Tour Notes', iTid, tour._row, x.id) : null;
    }).then(function () {
      var data = [{ range: "'Home Listing'!" + colLetter(iS) + x.row, values: [[safeText(status)]] }];
      if (iR >= 0) data.push({ range: "'Home Listing'!" + colLetter(iR) + x.row, values: [[safeText(reasonText)]] });
      if (tour) data.push({ range: "'Home Tour Notes'!" + colLetter(iD) + tour._row, values: [[safeText(status)]] });
      return api(homeBase() + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data: data } });
    }).then(function () {
      x.status = status;
      if (iR >= 0) x.reason = reasonText;
      if (tour) tour['Decision'] = status;
    });
  }
  function guardCell(tab, colIndex, row, expected) {
    return api(homeBase() + '/values/' + enc("'" + tab + "'!" + colLetter(colIndex) + row)).then(function (j) {
      var v = j.values && j.values[0] ? String(j.values[0][0]).trim() : '';
      if (v !== expected) throw new Error('The sheet changed since it was loaded. Runway refreshed it. Please try again.');
    });
  }
  function setCheck(x, q, result) {
    var checks = state.data.checks, head = checks.head;
    if (!checks.has) return Promise.reject(new Error('Add a Home Checks tab to the home-search sheet to save checks.'));
    var iH = head.indexOf('Home ID'), iQ = head.indexOf('Req ID');
    if (iH < 0 || iQ < 0 || head.indexOf('Result') < 0) return Promise.reject(new Error('The Home Checks tab needs Home ID, Req ID and Result columns.'));
    var key = x.id + '|' + q.id, ex = checks.map[key], by = who(), on = todayText();
    if (ex) {
      var cells = [['Result', result], ['Checked by', result ? by : ''], ['Checked on', result ? on : '']].map(function (p) {
        var i = head.indexOf(p[0]); return i < 0 ? null : { range: "'Home Checks'!" + colLetter(i) + ex.row, values: [[safeText(p[1])]] };
      }).filter(Boolean);
      return guardCell('Home Checks', iH, ex.row, x.id).then(function () { return guardCell('Home Checks', iQ, ex.row, q.id); }).then(function () {
        return api(homeBase() + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data: cells } });
      }).then(function () { ex.result = result; ex.by = result ? by : ''; ex.on = result ? on : ''; });
    }
    if (!result) return Promise.resolve();
    var obj = { 'Home ID': x.id, 'Req ID': q.id, 'Requirement': q.text, 'Result': result, 'Note': '', 'Checked by': by, 'Checked on': on };
    return api(homeBase() + '/values/' + enc("'Home Checks'!A1") + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: { values: [rowFrom(head, obj)] } }).then(loadHome);
  }
  function stamp() {
    var d = new Date();
    return d.toLocaleDateString('en-US') + ' ' + d.getHours() + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  }
  function commonValue(rows, key) {
    var n = {}, best = '', bestN = 0;
    rows.forEach(function (r) { var v = r[key]; if (v) { n[v] = (n[v] || 0) + 1; if (n[v] > bestN) { best = v; bestN = n[v]; } } });
    return best;
  }
  function addHome(f) {
    var head = state.data.listingHead, d = state.data;
    if (head.indexOf('Home ID') < 0 || head.indexOf('Status') < 0) return Promise.reject(new Error('The Home Listing tab needs Home ID and Status columns.'));
    var key = function (b, m, c) { return [b, m, c].map(function (t) { return String(t || '').trim().toLowerCase(); }).join('|'); };
    if (d.homes.some(function (x) { return key(x.builder, x.model, x.community) === key(f.builder, f.model, f.community); })) return Promise.reject(new Error('That home is already in the list.'));
    if (f.url && d.homes.some(function (x) { return x.url && x.url.trim() === f.url; })) return Promise.reject(new Error('A home with that listing link is already in the list.'));
    var id = nextId(d.homes, 'HOME');
    var obj = { 'Timestamp': stamp(), 'Status': f.status, 'City': f.city, 'Community': f.community, 'Builder': f.builder, 'Model': f.model,
      'Style': f.style, 'Address': f.address, 'List Price': f.price, 'Upgrade Price': f.upgrade, 'Bedrooms': f.beds, 'Baths': f.baths, 'Sq Ft': f.sqft,
      'Garage': f.garage, 'Listing URL': f.url, 'Contact': f.contact, 'Tel. #': f.phone, 'Notes': f.notes, 'Logged by': who(), 'Home ID': id };
    return api(homeBase() + '/values/' + enc("'Home Listing'!A1") + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: { values: [rowFrom(head, obj)] } }).then(loadHome).then(function () {
        var formsInUse = state.planData && (state.planData.links || []).some(function (l) { return /housing/i.test(l.group) && formUrl(l.url); });
        state.notice = formsInUse ? 'Added ' + id + '. To log tours or contacts for it with the Forms, add "' + id + ' ' + (f.builder + ': ' + f.model) + '" to the "Which home?" dropdown in the Tour and Contact Forms. The Log a tour and Log a contact buttons need that option too.'
          : 'Added ' + id + '.';
      });
  }
  function addContact(x, f) {
    var head = state.data.contactsHead;
    if (!head.length) return Promise.reject(new Error('The Contacts Log tab was not found.'));
    var obj = { 'Timestamp': stamp(), 'Contact Name': f.name, 'Builder': x.builder, 'Community': x.community, 'Date': isoToUs(f.date) || todayText(),
      'Channel': f.channel, 'Direction': f.direction, 'Subject': f.subject, 'Summary': f.summary, 'Documents / Links Reference': f.link,
      'Action Required': f.action, 'Action Notes': f.actionNotes, 'Which Home?': homeFormLabel(x), 'Logged by': who(), 'Next action': f.next, 'Due date': isoToUs(f.due) };
    return api(homeBase() + '/values/' + enc("'Contacts Log'!A1") + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: { values: [rowLoose(head, obj)] } }).then(loadHome);
  }
  function addTourRow(x, f) {
    var head = state.data.tourHead;
    if (!head.length) return Promise.reject(new Error('The Home Tour Notes tab was not found.'));
    var date = isoToUs(f.date);
    var again = (state.data.tours || []).some(function (r) { return r['Home ID'] === x.id && String(r['Visit Date'] || '').trim() === date; });
    if (again) return Promise.reject(new Error('A tour of this home on that date is already logged.'));
    var obj = { 'Timestamp': stamp(), 'Home Identification': (x.builder + (x.model ? ' - ' + x.model : '')).trim(), 'Community': x.community, 'Visit Date': date,
      'Address': x.address, 'Which home?': homeFormLabel(x), 'Logged by': who() };
    f.answers.forEach(function (a) { if (a.value) obj[a.header] = a.value; });
    return api(homeBase() + '/values/' + enc("'Home Tour Notes'!A1") + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: { values: [rowLoose(head, obj)] } }).then(loadHome).then(function () {
        var done = state.data.plans.list.filter(function (p) { return p.id === x.id && p.status === 'Planned' && p.dateText === date; });
        var closePlans = done.reduce(function (chain, p) { return chain.then(function () { return setPlanStatus(p, 'Done'); }).catch(function () { return null; }); }, Promise.resolve());
        return closePlans.then(function () {
          if (!f.syncStatus) return null;
          var fresh = state.data.homes.filter(function (hm) { return hm.id === x.id; })[0];
          return fresh ? setHomeStatus(fresh, f.decision, f.reasons, false) : null;
        });
      });
  }
  function driveIdFrom(url) {
    var m = String(url).match(/\/d\/([A-Za-z0-9_-]{15,})/) || String(url).match(/[?&]id=([A-Za-z0-9_-]{15,})/);
    return m ? m[1] : '';
  }
  function addDocument(f) {
    var head = state.data.docsHead;
    var obj = { 'Title': f.title, 'URL': f.url, 'Drive file ID': driveIdFrom(f.url), 'Workstream': f.stream, 'Home ID': f.homeId, 'Owner': f.owner,
      'Sensitivity': f.sensitivity, 'Added by': who(), 'Added on': todayText(), 'Review date': isoToUs(f.review) };
    return api(homeBase() + '/values/' + enc("'Documents & Links'!A1") + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: { values: [rowFrom(head, obj)] } }).then(loadHome);
  }
  function addPlan(x, f) {
    var plans = state.data.plans, head = plans.head;
    if (!plans.has) return Promise.reject(new Error('Add a Tour Plans tab to the home-search sheet to save planned tours.'));
    var date = isoToUs(f.date);
    if (plannedFor(x.id).some(function (p) { return p.dateText === date; })) return Promise.reject(new Error('A tour is already planned for this home on that date.'));
    var obj = { 'Home ID': x.id, 'Planned date': date, 'Time': f.time, 'Note': f.note, 'Status': 'Planned', 'Planned by': who(), 'Planned on': todayText() };
    return api(homeBase() + '/values/' + enc("'Tour Plans'!A1") + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: { values: [rowLoose(head, obj)] } }).then(loadHome);
  }
  function setPlanStatus(p, status) {
    var head = state.data.plans.head, iS = head.indexOf('Status'), iH = head.indexOf('Home ID');
    if (iS < 0 || iH < 0) return Promise.reject(new Error('The Tour Plans tab needs Home ID and Status columns.'));
    return guardCell('Tour Plans', iH, p.row, p.id).then(function () {
      return api(homeBase() + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED',
        data: [{ range: "'Tour Plans'!" + colLetter(iS) + p.row, values: [[status]] }] } });
    }).then(function () { p.status = status; });
  }
  function addJournal(f) {
    var P = state.planData;
    var obj = { 'Entry ID': nextId(P.journal, 'J'), 'Date': isoToUs(f.date) || todayText(), 'Title': f.title, 'Detail': f.detail, 'Logged by': who() };
    return appendRow('Journal', rowFrom(P.heads.journal, obj)).then(loadPlan);
  }
  function markDecided(d, reasoning) {
    var head = state.planData.heads.decisions;
    var data = [cell('Decisions', head, 'Status', d.row, 'Decided'), cell('Decisions', head, 'Decided on', d.row, todayText()),
      cell('Decisions', head, 'Reasoning', d.row, reasoning)].filter(Boolean);
    return guardRow('Decisions', head, 'Decision ID', d.id, d.row).then(function () { return writeCells(data); }).then(function () {
      d.status = 'Decided'; d.decidedOn = todayText(); d.reasoning = reasoning;
    });
  }
  var toastTimer = null;
  function toast(text, bad) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 4500);
  }
  // Typed text in the add forms survives a redraw (drafts), and forms keep their open state.
  function loadDrafts() {
    try { var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
  }
  function persistDrafts() {
    try {
      var kept = {};
      Object.keys(state.drafts).forEach(function (k) { if (k.indexOf('tour-') === 0 && state.drafts[k] !== '') kept[k] = state.drafts[k]; });
      if (Object.keys(kept).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(kept)); else localStorage.removeItem(DRAFT_KEY);
    } catch (e) { /* storage unavailable */ }
  }
  function setDraft(k, v) { state.drafts[k] = v; if (k.indexOf('tour-') === 0) persistDrafts(); }
  function keep(form, name, el) {
    var k = form + '.' + name;
    if (state.drafts[k] !== undefined) el.value = state.drafts[k];
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { setDraft(k, el.value); });
    return el;
  }
  function clearDraft(form) {
    Object.keys(state.drafts).forEach(function (k) { if (k.indexOf(form + '.') === 0) delete state.drafts[k]; });
    persistDrafts();
  }
  function formAttrs(form, openByDefault, cls) {
    var open = state.openForms[form] === undefined ? !!openByDefault : state.openForms[form];
    return { class: cls || 'card addform', open: open ? true : null, ontoggle: function (e) { state.openForms[form] = e.target.open; } };
  }
  function submit(form, p, after) {
    return p.then(function (ok) { if (ok) { clearDraft(form); if (after) after(); render(); } });
  }
  function save(promise, okText) {
    state.saving = true; render();
    return promise.then(function () { state.saving = false; toast(okText); render(); return true; })
      .catch(function (e) {
        state.saving = false;
        var msg = e && e.message ? e.message : 'Could not save.';
        if (/changed since/.test(msg)) loadAll().then(function () { toast(msg, true); }); else { toast(msg, true); render(); }
        return false;
      });
  }

  /* ---------- actions ---------- */
  function doSignIn(prompt) {
    state.error = null;
    return requestToken(prompt || '').then(function () {
      state.needSignIn = false;
      if (state.sheet) return loadAll();
      render();
    }).catch(function (e) { state.error = { title: 'Sign-in did not finish', body: e.message }; render(); });
  }
  function choose(title, key, setter) {
    pickSheet(title).then(function (s) {
      if (!s) return;
      setter(s); saveStore(key, s);
      return loadAll();
    }).catch(function (e) { state.error = explain(e); render(); });
  }
  function doPick() { choose('Choose your home-search sheet', HOME_KEY, function (s) { state.sheet = s; state.data = null; }); }
  function doPickPlan() { choose('Choose your Runway planning sheet', PLAN_KEY, function (s) { state.plan = s; state.planData = null; state.planRole = null; }); }
  function doSignOut() {
    var t = state.token;
    state.drafts = {}; persistDrafts(); state.token = null; state.expires = 0; state.user = null; state.data = null; state.planData = null;
    state.role = null; state.planRole = null; state.needSignIn = true; state.error = null; state.planError = null;
    try { if (t && window.google && google.accounts) google.accounts.oauth2.revoke(t, function () {}); } catch (e) { /* ignore */ }
    render();
  }

  function tagFor(status) { return h('span', { class: 'tag' + (status === 'Active' ? ' active' : status === 'To tour' ? ' warn' : '') }, status); }

  /* ---------- views ---------- */
  function connectCard(what) {
    return h('section', { class: 'card stack' },
      h('h2', null, 'Connect the Runway planning sheet'),
      h('p', { class: 'muted' }, what + ' live in a separate planning sheet. Choose it once and Runway remembers it on this device.'),
      h('button', { class: 'btn', type: 'button', onclick: doPickPlan, style: 'align-self:flex-start' }, 'Choose planning sheet'));
  }
  function formUrl(u) {
    try {
      var x = new URL(u);
      var ok = x.protocol === 'https:' && ((x.hostname === 'docs.google.com' && x.pathname.indexOf('/forms/') === 0) || x.hostname === 'forms.gle');
      return ok ? x.href : null;
    } catch (e) { return null; }
  }
  function pageHead(title, lede) { return h('div', null, h('h1', null, title), lede ? h('p', { class: 'lede' }, lede) : null); }
  function planProblem() {
    if (!state.plan) return null;
    var e = state.planError; if (!e) return null;
    return h('div', { class: 'alert', role: 'alert' }, h('strong', null, e.title), h('span', null, e.body),
      e.action === 'pick' ? h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn small', type: 'button', onclick: doPickPlan }, 'Choose planning sheet')) : null);
  }
  function bar(done, total) {
    var wrap = h('div', { class: 'meter', role: 'img', 'aria-label': done + ' of ' + total + ' done' }, h('i', null));
    wrap.firstChild.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    return wrap;
  }
  function dueTag(t) {
    if (!t.due || t.status === 'Done' || t.status === 'Skipped') return null;
    return t.due < startOfToday() ? h('span', { class: 'tag warn' }, 'Overdue') : null;
  }
  function openTasksSorted(tasks) {
    return tasks.filter(function (t) { return t.status !== 'Done' && t.status !== 'Skipped'; }).sort(function (a, b) {
      return (a.due ? a.due.getTime() : 9e15) - (b.due ? b.due.getTime() : 9e15);
    });
  }

  function viewOverview() {
    var d = state.data, homes = d.homes, P = state.planData;
    var target = new Date(C.TARGET_DATE + 'T00:00:00Z');
    var days = Math.ceil((target - Date.now()) / 864e5);
    var months = Math.max(0, Math.round(days / 30.44));
    var label = target.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    var counts = {};
    homes.forEach(function (x) { counts[x.status] = (counts[x.status] || 0) + 1; });
    var statuses = Object.keys(counts).sort(function (a, b) {
      var ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var active = homes.filter(function (x) { return x.status === 'Active'; });
    var toTour = homes.filter(function (x) { return x.status === 'To tour'; });
    var follow = d.contacts.filter(function (c) { return /^y/i.test(col(c, /^action required/i)); });

    var done = P ? P.tasks.filter(function (t) { return t.status === 'Done'; }).length : 0;
    var total = P ? P.tasks.length : 0;
    var nextUp = P ? openTasksSorted(P.tasks).slice(0, 5) : [];
    var openDecisions = P ? P.decisions.filter(function (x) { return x.status === 'Open'; }) : [];
    var latest = P && P.journal.length ? P.journal.slice().sort(function (a, b) { return (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0); })[0] : null;

    var hero = h('section', { class: 'card hero stack' },
      h('div', { class: 'small' }, 'Target date'),
      h('div', { class: 'big' }, label),
      h('div', null, days > 0 ? 'About ' + months + (months === 1 ? ' month' : ' months') + ' to go (' + days + ' days)' : 'The target date has arrived.'),
      P && total ? h('div', { class: 'stack', style: 'gap:6px' }, bar(done, total), h('div', { class: 'small' }, done + ' of ' + total + ' tasks done')) : null);

    var plan = !state.plan ? connectCard('Tasks and decisions')
      : state.planError ? planProblem()
      : h('div', { class: 'row' },
        h('section', { class: 'card col stack' }, h('h2', null, 'Next up'),
          nextUp.length ? h('ul', { class: 'list' }, nextUp.map(function (t) {
            return h('li', null, h('strong', null, t.title),
              h('div', { class: 'muted small' }, [t.stream, t.owner, t.dueText ? 'Due ' + t.dueText : ''].filter(Boolean).join(' | '), ' ', dueTag(t)));
          })) : h('p', { class: 'muted' }, 'Nothing open. Add tasks on the Tasks page.'),
          h('a', { class: 'btn ghost small', href: '#/tasks', style: 'align-self:flex-start' }, 'All tasks')),
        h('section', { class: 'card col stack' }, h('h2', null, 'Open decisions'),
          openDecisions.length ? h('ul', { class: 'list' }, openDecisions.map(function (x) {
            return h('li', null, h('strong', null, x.title),
              h('div', { class: 'muted small' }, [x.owners, x.cfp ? 'Needs CFP input' : ''].filter(Boolean).join(' | ')));
          })) : h('p', { class: 'muted' }, 'No open decisions.'),
          h('a', { class: 'btn ghost small', href: '#/decisions', style: 'align-self:flex-start' }, 'All decisions')));

    return h('div', { class: 'stack' },
      pageHead('Overview', 'Where things stand today.'),
      h('div', { class: 'row' },
        hero,
        h('section', { class: 'card col stack' },
          h('h2', null, 'Housing at a glance'),
          h('div', { class: 'chips' }, statuses.map(function (s) {
            return h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: function () { state.filter = s; go('housing'); } }, s + ' (' + counts[s] + ')');
          })),
          homes.length ? null : h('p', { class: 'muted' }, 'No homes with a Home ID yet. Add IDs in the Home Listing tab.'),
          h('a', { class: 'btn ghost small', href: '#/housing', style: 'align-self:flex-start' }, 'See all homes'))),
      plan,
      upcomingToursCard(),
      h('div', { class: 'row' },
        h('section', { class: 'card col stack' },
          h('h2', null, 'Active candidates'),
          active.length ? h('ul', { class: 'list' }, active.map(function (x) {
            return h('li', null,
              h('div', { style: 'display:flex;justify-content:space-between;gap:12px' }, h('strong', null, homeName(x)), h('span', null, money(x.price))),
              h('div', { class: 'muted small' }, [x.community, x.city].filter(Boolean).join(', ')),
              h('div', { class: 'small' }, x.visit ? 'Toured ' + x.visit : 'Not toured yet'));
          })) : h('p', { class: 'muted' }, 'No homes marked Active.'),
          active.length > 1 ? h('a', { class: 'btn ghost small', href: '#/compare', style: 'align-self:flex-start' }, 'Compare these homes') : null),
        h('section', { class: 'card col stack' },
          h('h2', null, 'Homes to tour'),
          toTour.length ? h('ul', { class: 'list' }, toTour.map(function (x) {
            return h('li', null, h('strong', null, homeName(x)), h('div', { class: 'muted small' }, [x.community, x.city].filter(Boolean).join(', ')));
          })) : h('p', { class: 'muted' }, 'No homes waiting to be toured.'))),
      h('div', { class: 'row' },
        h('section', { class: 'card col stack' },
          h('h2', null, 'Open follow-ups'),
          follow.length ? h('ul', { class: 'list' }, follow.map(function (c) {
            return h('li', null,
              h('strong', null, col(c, /^next action/i) || c['Subject'] || 'Follow up'),
              h('div', { class: 'muted small' }, [c['Builder'], c['Contact Name']].filter(Boolean).join(', ')),
              col(c, /^due date/i) ? h('div', { class: 'small' }, 'Due ' + col(c, /^due date/i)) : null);
          })) : h('p', { class: 'muted' }, 'No follow-ups marked Yes in the Contacts Log.')),
        h('section', { class: 'card col stack' },
          h('h2', null, 'Latest journal entry'),
          latest ? h('div', { class: 'stack', style: 'gap:6px' }, h('strong', null, latest.title), h('div', { class: 'muted small' }, [latest.dateText, latest.by].filter(Boolean).join(' | ')),
            latest.detail ? h('p', null, latest.detail) : null, h('a', { class: 'btn ghost small', href: '#/journal', style: 'align-self:flex-start' }, 'Open the journal'))
          : h('p', { class: 'muted' }, 'No entries yet.'),
          !latest ? h('a', { class: 'btn ghost small', href: '#/journal', style: 'align-self:flex-start' }, 'Open the journal') : null))
    );
  }

  /* ----- Tasks ----- */
  function field(label, control) { return h('label', { class: 'fld' }, h('span', null, label), control); }
  function taskRow(t) {
    var done = t.status === 'Done';
    var box = h('input', {
      type: 'checkbox', checked: done ? true : null, disabled: (!canEditPlan() || state.saving) ? true : null,
      'aria-label': (done ? 'Mark not done: ' : 'Mark done: ') + t.title,
      onchange: function (e) { var on = e.target.checked; save(setTaskStatus(t, on ? 'Done' : 'To do'), on ? 'Marked done' : 'Marked not done'); }
    });
    return h('li', { class: 'task' + (done ? ' done' : '') },
      box,
      h('div', { class: 'tbody' },
        h('div', { class: 'ttitle' }, t.title),
        h('div', { class: 'muted small' }, [t.owner, t.dueText ? 'Due ' + t.dueText : '', t.status === 'In progress' ? 'In progress' : '', t.status === 'Skipped' ? 'Skipped' : '',
          done && t.completedOn ? 'Done ' + t.completedOn + (t.completedBy ? ' by ' + t.completedBy : '') : ''].filter(Boolean).join(' | '), ' ', dueTag(t)),
        t.notes ? h('div', { class: 'small' }, t.notes) : null));
  }
  function addTaskForm(P) {
    var title = keep('task', 'title', h('input', { type: 'text', maxlength: '200', placeholder: 'What needs doing' }));
    var stream = keep('task', 'stream', h('select', null, (P.streams.length ? P.streams : ['Other']).map(function (s) { return h('option', { value: s }, s); })));
    var owner = keep('task', 'owner', h('input', { type: 'text', list: 'owners', maxlength: '40' }));
    var owners = {}; P.tasks.forEach(function (t) { if (t.owner) owners[t.owner] = true; });
    var dl = h('datalist', { id: 'owners' }, Object.keys(owners).map(function (o) { return h('option', { value: o }); }));
    var due = keep('task', 'due', h('input', { type: 'date' }));
    var notes = keep('task', 'notes', h('input', { type: 'text', maxlength: '300' }));
    return h('details', formAttrs('task'), h('summary', null, 'Add a task'),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        field('Task', title), field('Workstream', stream), field('Owner', owner), dl, field('Due date (optional)', due), field('Notes (optional)', notes),
        h('button', { class: 'btn', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!title.value.trim()) { toast('Give the task a title.', true); return; }
          submit('task', save(addTask({ title: title.value.trim(), stream: stream.value, owner: owner.value.trim(), due: due.value, notes: notes.value.trim() }), 'Task added'));
        } }, 'Add task')));
  }
  function viewTasks() {
    var head = pageHead('Tasks', 'The checklist for the road ahead, grouped by workstream.');
    if (!state.plan) return h('div', { class: 'stack' }, head, connectCard('Tasks and decisions'));
    if (state.planError) return h('div', { class: 'stack' }, head, planProblem());
    var P = state.planData; if (!P) return h('div', { class: 'stack' }, head);
    var names = P.streams.slice();
    P.tasks.forEach(function (t) { if (names.indexOf(t.stream) < 0) names.push(t.stream); });
    if (names.indexOf(state.taskStream) < 0) state.taskStream = 'All';
    var chips = ['All'].concat(names).map(function (n) {
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.taskStream === n), onclick: function () { state.taskStream = n; render(); } }, n);
    });
    var sections = names.filter(function (n) { return state.taskStream === 'All' || state.taskStream === n; }).map(function (n) {
      var all = P.tasks.filter(function (t) { return t.stream === n; });
      var done = all.filter(function (t) { return t.status === 'Done'; }).length;
      var shown = all.filter(function (t) { return state.showDone || t.status !== 'Done'; }).sort(function (a, b) {
        return (a.due ? a.due.getTime() : 9e15) - (b.due ? b.due.getTime() : 9e15);
      });
      if (!all.length) return null;
      return h('section', { class: 'card stack' },
        h('div', { class: 'sechead' }, h('h2', null, n), h('span', { class: 'muted small' }, done + ' of ' + all.length + ' done')),
        bar(done, all.length),
        shown.length ? h('ul', { class: 'tasks' }, shown.map(taskRow)) : h('p', { class: 'muted' }, 'Everything here is done.'));
    });
    return h('div', { class: 'stack' }, head,
      canEditPlan() ? null : h('p', { class: 'muted small' }, 'You can see every task. Only people with edit access to the planning sheet can change them.'),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by workstream' }, chips,
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.showDone), onclick: function () { state.showDone = !state.showDone; render(); } }, 'Show done')),
      sections,
      canEditPlan() ? addTaskForm(P) : null);
  }

  /* ----- Decisions ----- */
  function decisionCard(x) {
    var reason = h('textarea', { rows: '3', maxlength: '1000', placeholder: 'What was decided, and why' });
    return h('section', { class: 'card stack' },
      h('div', { class: 'sechead' }, h('h2', null, x.title),
        h('span', { class: 'tag' + (x.status === 'Open' ? ' warn' : x.status === 'Decided' ? ' active' : '') }, x.status)),
      h('div', { class: 'muted small' }, [x.stream, x.owners, x.cfp ? 'Needs CFP input' : ''].filter(Boolean).join(' | ')),
      x.options ? h('p', null, h('strong', null, 'Options: '), x.options) : null,
      x.status === 'Decided' ? h('p', null, h('strong', null, 'Decided' + (x.decidedOn ? ' ' + x.decidedOn : '') + ': '), x.reasoning || '') : null,
      x.status !== 'Decided' && canEditPlan() ? h('details', null, h('summary', null, 'Mark as decided'),
        h('div', { class: 'stack', style: 'margin-top:12px' }, field('Reasoning', reason),
          h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
            if (!reason.value.trim()) { toast('Add the reasoning first.', true); return; }
            save(markDecided(x, reason.value.trim()), 'Decision recorded');
          } }, 'Save decision'))) : null);
  }
  function addDecisionForm(P) {
    var title = keep('decision', 'title', h('input', { type: 'text', maxlength: '200' }));
    var stream = keep('decision', 'stream', h('select', null, (P.streams.length ? P.streams : ['Other']).map(function (s) { return h('option', { value: s }, s); })));
    var options = keep('decision', 'options', h('input', { type: 'text', maxlength: '400' }));
    var owners = keep('decision', 'owners', h('input', { type: 'text', maxlength: '80' }));
    var cfp = keep('decision', 'cfp', h('select', null, h('option', { value: 'No' }, 'No'), h('option', { value: 'Yes' }, 'Yes')));
    return h('details', formAttrs('decision'), h('summary', null, 'Add a decision'),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        field('Decision', title), field('Workstream', stream), field('Options (optional)', options), field('Who decides', owners), field('Needs CFP input', cfp),
        h('button', { class: 'btn', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!title.value.trim()) { toast('Give the decision a title.', true); return; }
          submit('decision', save(addDecision({ title: title.value.trim(), stream: stream.value, options: options.value.trim(), owners: owners.value.trim(), cfp: cfp.value }), 'Decision added'));
        } }, 'Add decision')));
  }
  function viewDecisions() {
    var head = pageHead('Decisions', 'What is still open, and what has been settled and why.');
    if (!state.plan) return h('div', { class: 'stack' }, head, connectCard('Tasks and decisions'));
    if (state.planError) return h('div', { class: 'stack' }, head, planProblem());
    var P = state.planData; if (!P) return h('div', { class: 'stack' }, head);
    var order = { Open: 0, Deferred: 1, Decided: 2 };
    var list = P.decisions.slice().sort(function (a, b) { return order[a.status] - order[b.status]; });
    return h('div', { class: 'stack' }, head,
      canEditPlan() ? null : h('p', { class: 'muted small' }, 'You can see every decision. Only people with edit access to the planning sheet can change them.'),
      list.length ? list.map(decisionCard) : h('p', { class: 'muted' }, 'No decisions yet.'),
      canEditPlan() ? addDecisionForm(P) : null);
  }

  function fact(label, value) {
    return value ? [h('dt', null, label), h('dd', null, value)] : null;
  }
  function homeFormLabel(x) { return x.id + ' ' + (x.builder + (x.model ? ': ' + x.model : '')).trim(); }
  function homeLinks(x) {
    if (effectiveRole() !== 'editor' || !state.planData) return [];
    return (state.planData.links || []).filter(function (k) {
      return /housing/i.test(k.group) && formUrl(k.url) && /^entry\.\d+$/.test(k.field.trim());
    }).map(function (l) {
      var u = new URL(formUrl(l.url));
      u.searchParams.set('usp', 'pp_url');
      u.searchParams.set(l.field.trim(), homeFormLabel(x));
      var label = /tour/i.test(l.name) ? 'Log a tour here' : /contact/i.test(l.name) ? 'Log a contact here' : (l.name || 'Open form') + ' for this home';
      return h('a', { class: 'btn small', href: u.href, target: '_blank', rel: 'noopener noreferrer' }, label);
    });
  }
  function addHomeForm() {
    var d = state.data;
    function txt(name, max, ph) { return keep('home', name, h('input', { type: 'text', maxlength: String(max || 80), placeholder: ph || '' })); }
    function numInput(name, ph) { return keep('home', name, h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: ph || '' })); }
    var builder = txt('builder', 60), model = txt('model', 80), community = txt('community', 80), address = txt('address', 120), contact = txt('contact', 60), phone = txt('phone', 30), notes = txt('notes', 400);
    var cities = {}; d.homes.forEach(function (x) { if (x.city) cities[x.city] = true; });
    var city = keep('home', 'city', h('input', { type: 'text', list: 'home-cities', maxlength: '40' }));
    var cl = h('datalist', { id: 'home-cities' }, Object.keys(cities).map(function (c) { return h('option', { value: c }); }));
    var price = numInput('price', 'Price'), upgrade = numInput('upgrade', 'With upgrades (optional)'), beds = numInput('beds'), baths = numInput('baths'), sqft = numInput('sqft');
    var garage = keep('home', 'garage', h('input', { type: 'text', maxlength: '20', value: commonValue(state.data.listingRows || [], 'Garage') || '2-car' }));
    var url = keep('home', 'url', h('input', { type: 'url', maxlength: '800', placeholder: 'https:// (optional)', inputmode: 'url' }));
    var status = keep('home', 'status', h('select', null, STATUS_ORDER.map(function (o) { return h('option', { value: o, selected: o === 'Researching' ? true : null }, o); })));
    var style = commonValue(state.data.listingRows || [], 'Style') || 'Ranch / Single-story';
    return h('details', formAttrs('home'), h('summary', null, 'Add a home'),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        h('p', { class: 'muted small' }, 'Runway gives the new home the next Home ID and adds it to the Home Listing tab.'),
        field('Builder', builder), field('Model', model), field('Community', community), field('City', city), cl, field('Address (optional)', address),
        field('List price', price), field('Price with upgrades (optional)', upgrade), field('Bedrooms', beds), field('Baths', baths), field('Square feet', sqft),
        field('Garage', garage), field('Listing link (optional)', url), field('Builder contact (optional)', contact), field('Phone (optional)', phone),
        field('Notes (optional)', notes), field('Status', status),
        h('button', { class: 'btn', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!builder.value.trim() || !model.value.trim()) { toast('Builder and model are required.', true); return; }
          if (!city.value.trim()) { toast('Choose or type the city.', true); return; }
          var link = url.value.trim();
          if (link && !/^https:\/\//i.test(link)) { toast('The listing link must start with https://', true); return; }
          submit('home', save(addHome({ builder: builder.value.trim(), model: model.value.trim(), community: community.value.trim(), city: city.value.trim(), address: address.value.trim(),
            price: price.value, upgrade: upgrade.value, beds: beds.value, baths: baths.value, sqft: sqft.value, garage: garage.value.trim(), style: style, url: link,
            contact: contact.value.trim(), phone: phone.value.trim(), notes: notes.value.trim(), status: status.value }), 'Home added'));
        } }, 'Add home')));
  }
  // The tour, grouped by where you stand. Only fields whose column exists in the Tour Notes tab are shown.
  // t: yn (Yes/No taps), chips (pick one), multi (tick several), suggest (type or tap a past answer), text, long, num
  var TOUR_ROOMS = [
    { id: 'outside', title: 'Outside and lot', fields: [
      { h: 'Lot Size (sq ft)', label: 'Lot size (sq ft)', t: 'num' }, { h: 'House Spacing', label: 'House spacing', t: 'chips', opts: ['Close', 'Moderate', 'Well-spaced'] },
      { h: 'House Size (sq ft)', label: 'House size (sq ft)', t: 'num' }, { h: 'Covered Porch', label: 'Covered porch', t: 'yn' }, { h: 'Covered Patio', label: 'Covered patio', t: 'yn' },
      { h: 'Zero-Step Entry (Front Door)', label: 'Zero-step entry, front door', t: 'yn' }, { h: 'Exterior Note', label: 'Exterior notes', t: 'long' } ] },
    { id: 'living', title: 'Living areas', fields: [
      { h: 'Flex Room', label: 'Flex room', t: 'yn' }, { h: 'Room Choice / Layout Flexibility', label: 'Room choice and layout flexibility', t: 'yn' },
      { h: 'Wider Doorways / Hallways', label: 'Wider doorways and hallways (32 in or more)', t: 'yn' }, { h: 'Powder Room', label: 'Powder room', t: 'yn' },
      { h: 'Recessed Lighting', label: 'Recessed lighting', t: 'yn' }, { h: 'Ceiling Fans', label: 'Ceiling fans', t: 'chips', opts: ['Yes', 'No', 'Junction box only'] },
      { h: 'Blinds Included', label: 'Blinds included', t: 'yn' } ] },
    { id: 'kitchen', title: 'Kitchen', fields: [
      { h: 'Cooking Appliance Layout', label: 'Cooking appliance layout', t: 'suggest' }, { h: 'Walk-in Pantry', label: 'Walk-in pantry', t: 'yn' },
      { h: 'Large Island', label: 'Large island', t: 'yn' }, { h: 'Center Island Sink', label: 'Center island has a main sink (you want No)', t: 'yn' },
      { h: 'Stainless Steel Appliances', label: 'Stainless steel appliances', t: 'yn' },
      { h: 'Appliances Included', label: 'Appliances included', t: 'multi', opts: ['Refrigerator', 'Microwave', 'Oven', 'Range', 'Hood with Exterior Vent', 'Dishwasher', 'Washer / Dryer'] },
      { h: 'Kitchen Upgrade Package Available', label: 'Kitchen upgrade package available', t: 'yn' }, { h: 'Kitchen Upgrade Notes', label: 'Kitchen upgrade notes', t: 'text' },
      { h: 'Kitchen Notes', label: 'Kitchen notes', t: 'long' } ] },
    { id: 'laundry', title: 'Laundry, mud room and garage', fields: [
      { h: 'Laundry Tub', label: 'Laundry tub', t: 'yn' }, { h: 'Separate Mud Room', label: 'Separate mud room', t: 'yn' },
      { h: 'Zero-Step Entry (Garage)', label: 'Zero-step entry, garage', t: 'yn' }, { h: 'EV Charger / 240V Prewire in Garage', label: 'EV charger or 240V prewire in the garage', t: 'yn' } ] },
    { id: 'suite', title: 'Primary suite', fields: [
      { h: 'Walk-in Closet', label: 'Walk-in closet', t: 'yn' }, { h: 'Primary Suite Notes', label: 'Primary suite notes', t: 'long' } ] },
    { id: 'bath', title: 'Primary bath', fields: [
      { h: 'Enclosed WC', label: 'Enclosed WC', t: 'yn' }, { h: 'Tub Included', label: 'Tub included', t: 'yn' }, { h: 'Shower Type', label: 'Shower type', t: 'chips', opts: ['Standard', 'Oversize'] },
      { h: 'Curbless / Zero-Threshold Shower', label: 'Curbless shower', t: 'yn' }, { h: 'Grab Bar Blocking Available', label: 'Grab-bar blocking', t: 'yn' },
      { h: 'Bidet Available', label: 'Bidet available', t: 'yn' }, { h: 'GFCI Outlet Near Owner', label: 'GFCI outlet near the owner\'s suite toilet', t: 'yn' },
      { h: 'Primary Bath Notes', label: 'Primary bath notes', t: 'long' } ] },
    { id: 'package', title: 'Utilities, package and HOA', fields: [
      { h: 'Utilities', label: 'Utilities', t: 'suggest', opts: ['Electric Only', 'Unknown'] }, { h: 'HOA Monthly', label: 'HOA monthly ($)', t: 'num' },
      { h: 'HOA Includes', label: 'HOA includes', t: 'text' }, { h: 'Package Notes', label: 'Package notes', t: 'long' } ] },
    { id: 'builder', title: 'Builder', fields: [
      { h: 'Builder Reputation', label: 'Builder reputation', t: 'suggest' }, { h: 'GuildQuality Score', label: 'GuildQuality score (%)', t: 'num' },
      { h: 'Buyer References Provided', label: 'Buyer references provided', t: 'yn' }, { h: 'Warranty Terms', label: 'Warranty terms', t: 'long' } ] },
    { id: 'overall', title: 'Overall', fields: [
      { h: 'Overall Impression', label: 'Overall impression', t: 'text' }, { h: 'Pros', label: 'Pros', t: 'long' }, { h: 'Cons', label: 'Cons', t: 'long' },
      { h: 'Decision Notes', label: 'Decision notes', t: 'text' } ] }
  ];
  function matchHeader(head, name) {
    var want = normKey(name), found = '';
    head.forEach(function (hd) { if (!found && hd && normKey(hd) === want) found = hd; });
    head.forEach(function (hd) { if (!found && hd && normKey(hd).indexOf(want) === 0) found = hd; });
    return found;
  }
  function observed(header) {
    var n = {}, order = [];
    (state.data.tours || []).forEach(function (r) {
      var v = String(r[header] || '').trim();
      if (v && v.length <= 80) { if (!n[v]) { n[v] = 0; order.push(v); } n[v]++; }
    });
    return order.sort(function (a, b) { return n[b] - n[a]; });
  }
  function tourFieldKey(x, header) { return 'tour-' + x.id + '.f:' + header; }
  function tourRoomsFor() {
    var head = state.data.tourHead || [];
    return TOUR_ROOMS.map(function (room) {
      return { id: room.id, title: room.title, fields: room.fields.map(function (f) {
        var header = matchHeader(head, f.h);
        return header ? { header: header, label: f.label, t: f.t, opts: f.opts || [] } : null;
      }).filter(Boolean) };
    }).filter(function (room) { return room.fields.length || room.id === 'overall'; });
  }
  function tourDraftCount(x) {
    var p = 'tour-' + x.id + '.';
    return Object.keys(state.drafts).filter(function (k) { return k.indexOf(p) === 0 && state.drafts[k] !== '' && k !== p + 'date'; }).length;
  }
  function tourStart(x) {
    if (!canEditHome() || !(state.data.tourHead || []).length) return null;
    return h('a', { class: 'btn small', href: '#/tour/' + enc(x.id), style: 'align-self:flex-start' }, tourDraftCount(x) ? 'Continue your tour draft' : 'Log a tour');
  }
  function fieldControl(x, f) {
    var key = tourFieldKey(x, f.header), cur = state.drafts[key] || '';
    function set(v) { setDraft(key, v); render(); }
    if (f.t === 'yn' || f.t === 'chips') {
      var opts = f.t === 'yn' ? ['Yes', 'No'] : f.opts;
      return h('div', { class: 'chips', style: 'gap:6px' }, opts.map(function (o) {
        return h('button', { type: 'button', class: 'seg', 'aria-pressed': String(cur === o), 'aria-label': f.label + ': ' + o, onclick: function () { set(cur === o ? '' : o); } }, o);
      }));
    }
    if (f.t === 'multi') {
      var base = f.opts.slice(), have = splitReasons(cur);
      observed(f.header).forEach(function (v) { splitReasons(v).forEach(function (t) { if (base.indexOf(t) < 0) base.push(t); }); });
      have.forEach(function (t) { if (base.indexOf(t) < 0) base.push(t); });
      return h('div', { class: 'reasons', style: 'border:0;padding:0' }, base.map(function (o) {
        var box = h('input', { type: 'checkbox', checked: have.indexOf(o) >= 0 ? true : null, 'aria-label': o });
        box.addEventListener('change', function () {
          var next = base.filter(function (t) { return t === o ? box.checked : have.indexOf(t) >= 0; });
          set(next.join(', '));
        });
        return h('label', null, box, o);
      }));
    }
    if (f.t === 'long') return keep('tour-' + x.id, 'f:' + f.header, h('textarea', { rows: '3', maxlength: '2000', 'aria-label': f.label }));
    var input = h('input', { type: 'text', maxlength: '300', 'aria-label': f.label });
    if (f.t === 'num') input.setAttribute('inputmode', 'decimal');
    if (f.t === 'suggest') {
      var seen = {}, list = [];
      (f.opts || []).concat(observed(f.header)).forEach(function (v) { if (!seen[v]) { seen[v] = true; list.push(v); } });
      var id = 'dl-' + normKey(f.header);
      input.setAttribute('list', id);
      return h('div', null, keep('tour-' + x.id, 'f:' + f.header, input), h('datalist', { id: id }, list.map(function (v) { return h('option', { value: v }); })));
    }
    return keep('tour-' + x.id, 'f:' + f.header, input);
  }
  function viewTour() {
    var back = h('a', { href: '#/housing', class: 'btn ghost small', style: 'align-self:flex-start' }, 'Back to Housing');
    var x = state.data.homes.filter(function (hm) { return hm.id === state.routeArg; })[0];
    if (!x) return h('div', { class: 'stack' }, pageHead('Log a tour', 'That home was not found.'), back);
    if (!canEditHome() || !(state.data.tourHead || []).length) return h('div', { class: 'stack' }, pageHead('Log a tour', 'Only people with edit access can log a tour.'), back);
    var k = 'tour-' + x.id, rooms = tourRoomsFor();
    var roomId = state.tourRoom[x.id] && rooms.some(function (r) { return r.id === state.tourRoom[x.id]; }) ? state.tourRoom[x.id] : rooms[0].id;
    var idx = 0; rooms.forEach(function (r, i) { if (r.id === roomId) idx = i; });
    var room = rooms[idx];
    function answered(r) { return r.fields.filter(function (f) { return (state.drafts[tourFieldKey(x, f.header)] || '') !== ''; }).length; }
    function goRoom(i) { state.tourRoom[x.id] = rooms[i].id; render(); try { window.scrollTo(0, 0); } catch (e) { /* ignore */ } }

    var date = h('input', { type: 'date' });
    var d0 = new Date(); date.value = d0.getFullYear() + '-' + pad(d0.getMonth() + 1, 2) + '-' + pad(d0.getDate(), 2); keep(k, 'date', date);
    var chips = rooms.map(function (r, i) {
      var n = answered(r);
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(r.id === roomId), onclick: function () { goRoom(i); } }, r.title + (n ? ' (' + n + ')' : ''));
    });

    var body = room.fields.map(function (f) {
      return h('div', { class: 'tfield' }, h('div', { class: 'ttitle' }, f.label), fieldControl(x, f));
    });
    var decision = keep(k, 'decision', h('select', null, STATUS_ORDER.map(function (o) { return h('option', { value: o, selected: o === 'Toured' ? true : null }, o); })));
    var syncOn = (state.drafts[k + '.sync'] === undefined ? '1' : state.drafts[k + '.sync']) === '1';
    var sync = h('input', { type: 'checkbox', checked: syncOn ? true : null, 'aria-label': 'Also set the home status to the Decision' });
    sync.addEventListener('change', function () { setDraft(k + '.sync', sync.checked ? '1' : '0'); });
    var boxes = REASONS.map(function (r) {
      var b = h('input', { type: 'checkbox', checked: state.drafts[k + '.r:' + r] === '1' ? true : null, 'aria-label': r });
      b.addEventListener('change', function () { setDraft(k + '.r:' + r, b.checked ? '1' : '0'); });
      return b;
    });
    var group = h('fieldset', { class: 'reasons', hidden: decision.value === 'Rejected' ? null : true }, h('legend', null, 'Why was it rejected? Pick all that apply.'),
      REASONS.map(function (r, i) { return h('label', null, boxes[i], r); }));
    decision.addEventListener('change', function () { group.hidden = decision.value !== 'Rejected'; decisionNote.textContent = 'Decision: ' + decision.value; });
    var decisionNote = h('span', { class: 'muted small' }, 'Decision: ' + decision.value + (room.id === 'overall' ? '' : ' (change it under Overall)'));
    var overall = room.id === 'overall' ? h('div', { class: 'stack' },
      h('div', { class: 'tfield' }, h('div', { class: 'ttitle' }, 'Decision'), decision), group,
      h('label', { class: 'sync' }, sync, 'Also set this home\'s status in Home Listing to the Decision')) : null;

    function onSave() {
      if (!date.value) { toast('Choose the visit date.', true); return; }
      var dec = state.drafts[k + '.decision'] || 'Toured';
      var useSync = (state.drafts[k + '.sync'] === undefined ? '1' : state.drafts[k + '.sync']) === '1';
      var reasons = REASONS.filter(function (r) { return state.drafts[k + '.r:' + r] === '1'; });
      if (useSync && dec === 'Rejected' && !reasons.length) { toast('Pick at least one reason for the rejection.', true); goRoom(rooms.length - 1); return; }
      var head = state.data.tourHead, answers = [];
      TOUR_ROOMS.forEach(function (r) { r.fields.forEach(function (f) {
        var header = matchHeader(head, f.h), v = header ? (state.drafts[tourFieldKey(x, header)] || '') : '';
        if (header && v !== '') answers.push({ header: header, value: v });
      }); });
      var decHeader = matchHeader(head, 'Decision'); if (decHeader) answers.push({ header: decHeader, value: dec });
      submit(k, save(addTourRow(x, { date: date.value, decision: dec, answers: answers, syncStatus: useSync, reasons: reasons }), 'Tour logged'), function () { location.hash = '#/housing'; });
    }
    function discard() {
      if (!window.confirm('Discard this tour draft?')) return;
      clearDraft(k); state.tourRoom[x.id] = null; render();
    }
    var saveBar = h('div', { class: 'savebar' }, decisionNote,
      h('div', { class: 'chips', style: 'gap:8px' },
        h('button', { class: 'btn', type: 'button', disabled: state.saving ? true : null, onclick: onSave }, 'Save tour'),
        h('button', { class: 'btn ghost', type: 'button', onclick: discard }, 'Discard draft')));
    return h('div', { class: 'stack' },
      h('div', null, h('h1', null, homeName(x)), h('p', { class: 'lede' }, [x.community, x.city].filter(Boolean).join(', ') + '. Your answers are kept on this device as you go, until you save or discard.')),
      back,
      h('section', { class: 'card stack' },
        h('div', { class: 'tfield' }, h('div', { class: 'ttitle' }, 'Visit date'), date),
        h('div', { class: 'rooms', role: 'group', 'aria-label': 'Rooms' }, chips)),
      h('section', { class: 'card stack' }, h('h2', null, room.title), body, overall,
        h('div', { class: 'chips' },
          idx > 0 ? h('button', { type: 'button', class: 'btn ghost small', onclick: function () { goRoom(idx - 1); } }, 'Previous: ' + rooms[idx - 1].title) : null,
          idx < rooms.length - 1 ? h('button', { type: 'button', class: 'btn small', onclick: function () { goRoom(idx + 1); } }, 'Next: ' + rooms[idx + 1].title) : null)),
      saveBar);
  }
  var CHANNELS = ['In Person', 'Email', 'Phone', 'Text', 'Online form'];
  var DIRECTIONS = ['Inbound', 'Outbound', 'Meeting'];
  function contactForm(x) {
    if (!canEditHome() || !state.data.contactsHead.length) return null;
    var k = 'contact-' + x.id;
    function t(name, max, ph) { return keep(k, name, h('input', { type: 'text', maxlength: String(max), placeholder: ph || '' })); }
    function sel(name, list) { return keep(k, name, h('select', null, list.map(function (o) { return h('option', { value: o }, o); }))); }
    var name = t('name', 60), subject = t('subject', 200, 'What this was about'), next = t('next', 200, 'Only if action is required');
    if (state.drafts[k + '.name'] === undefined && x.contact) name.value = x.contact;
    var date = h('input', { type: 'date' });
    var d0 = new Date(); date.value = d0.getFullYear() + '-' + pad(d0.getMonth() + 1, 2) + '-' + pad(d0.getDate(), 2); keep(k, 'date', date);
    var channel = sel('channel', CHANNELS), direction = sel('direction', DIRECTIONS), action = sel('action', ['No', 'Yes']);
    var summary = keep(k, 'summary', h('textarea', { rows: '3', maxlength: '2000' }));
    var link = keep(k, 'link', h('input', { type: 'url', maxlength: '800', placeholder: 'https:// (optional)', inputmode: 'url' }));
    var due = keep(k, 'due', h('input', { type: 'date' }));
    return h('details', formAttrs(k, false, 'subform'), h('summary', null, 'Log a contact'),
      h('div', { class: 'stack', style: 'margin-top:12px' },
        field('Who you spoke with', name), field('Date', date), field('How', channel), field('Direction', direction), field('Subject', subject), field('Summary (optional)', summary),
        field('Link (optional)', link), field('Action required', action), field('Next action', next), field('Due date (optional)', due),
        h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!subject.value.trim()) { toast('Add a subject.', true); return; }
          if (link.value.trim() && !/^https:\/\//i.test(link.value.trim())) { toast('The link must start with https://', true); return; }
          if (action.value === 'Yes' && !next.value.trim()) { toast('Describe the next action.', true); return; }
          submit(k, save(addContact(x, { name: name.value.trim(), date: date.value, channel: channel.value, direction: direction.value, subject: subject.value.trim(),
            summary: summary.value.trim(), link: link.value.trim(), action: action.value, actionNotes: '', next: next.value.trim(), due: due.value }), 'Contact logged'));
        } }, 'Save contact')));
  }
  function planForm(x) {
    var k = 'plan-' + x.id;
    var date = keep(k, 'date', h('input', { type: 'date' }));
    var d0 = new Date(); date.min = d0.getFullYear() + '-' + pad(d0.getMonth() + 1, 2) + '-' + pad(d0.getDate(), 2);
    var slots = [h('option', { value: '' }, 'No set time (all-day event)')];
    for (var mins = 7 * 60; mins <= 19 * 60 + 30; mins += 30) {
      var label = ((Math.floor(mins / 60) % 12) || 12) + ':' + pad(mins % 60, 2) + ' ' + (mins >= 12 * 60 ? 'PM' : 'AM');
      slots.push(h('option', { value: label }, label));
    }
    var time = keep(k, 'time', h('select', null, slots));
    var note = keep(k, 'note', h('input', { type: 'text', maxlength: '200', placeholder: 'For example: meet the sales agent at the model home' }));
    return h('details', formAttrs(k, false, 'subform'), h('summary', null, 'Plan a tour'),
      h('div', { class: 'stack', style: 'margin-top:12px' },
        field('Date', date), field('Time', time), field('Note (optional)', note),
        h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!date.value) { toast('Choose the date.', true); return; }
          if (date.value < date.min) { toast('Choose today or a later date.', true); return; }
          var raw = String(time.value || '').trim(), t = timeFromInput(raw);
          if (!raw && time.validity && time.validity.badInput) { toast('The time is incomplete. Pick the hour, the minutes and AM or PM, or clear the time.', true); return; }
          if (raw && !t) { toast('Runway could not read that time. Try something like 1:00 PM.', true); return; }
          var when = isoToUs(date.value) + (t ? ' at ' + t : ' (no time set, so the calendar event will be all day)');
          submit(k, save(addPlan(x, { date: date.value, time: t, note: note.value.trim() }), 'Tour planned for ' + when));
        } }, 'Save plan')));
  }
  function planSection(x) {
    var P = state.data.plans, list = plannedFor(x.id);
    var form = canEditHome() ? (P.has ? planForm(x) : h('p', { class: 'muted small' }, 'To plan tours, add a tab named "Tour Plans" to the home-search sheet with the headers: Home ID, Planned date, Time, Note, Status, Planned by, Planned on.')) : null;
    if (!list.length && !form) return null;
    return h('div', { class: 'stack' },
      list.length ? h('ul', { class: 'tasks' }, list.map(function (p) {
        var link = calendarLink(x, p), past = p.date && p.date < startOfToday();
        return h('li', { class: 'req' },
          h('div', { class: 'tbody' }, h('div', { class: 'ttitle' }, (past ? 'Tour was planned for ' : 'Tour planned: ') + planWhen(p)),
            past ? h('div', { class: 'small' }, 'Log the tour to close this plan.') : null, p.note ? h('div', { class: 'muted small' }, p.note) : null),
          h('div', { class: 'chips', style: 'gap:6px' },
            link ? h('a', { class: 'btn small', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Add to Google Calendar') : null,
            h('button', { class: 'btn ghost small', type: 'button', onclick: function () { downloadIcs(x, p); } }, 'Download .ics'),
            canEditHome() ? h('button', { class: 'btn ghost small', type: 'button', disabled: state.saving ? true : null, onclick: function () { save(setPlanStatus(p, 'Cancelled'), 'Plan cancelled'); } }, 'Cancel plan') : null));
      })) : null, form);
  }
  function upcomingToursCard() {
    var d = state.data, today = startOfToday(), homes = {};
    d.homes.forEach(function (x) { homes[x.id] = x; });
    var all = d.plans.list.filter(function (p) { return p.status === 'Planned' && p.date && homes[p.id]; }).sort(function (a, b) { return a.date - b.date; });
    var up = all.filter(function (p) { return p.date >= today; }).slice(0, 5), late = all.filter(function (p) { return p.date < today; });
    if (!up.length && !late.length) return null;
    return h('section', { class: 'card stack' }, h('h2', null, 'Upcoming tours'),
      up.length ? h('ul', { class: 'list' }, up.map(function (p) {
        var x = homes[p.id], link = calendarLink(x, p);
        return h('li', null, h('strong', null, planWhen(p)), h('div', null, homeName(x)),
          p.note ? h('div', { class: 'muted small' }, p.note) : null,
          link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Add to Google Calendar') : null);
      })) : h('p', { class: 'muted' }, 'Nothing planned.'),
      late.length ? h('p', { class: 'small' }, 'Planned but not yet logged: ' + late.map(function (p) { return homeName(homes[p.id]) + ' (' + p.dateText + ')'; }).join(', ')) : null);
  }
  // Closes every open home card and the sections inside them.
  function collapseAllHomes() {
    state.openHomes = {}; state.openReq = {};
    Object.keys(state.openForms).forEach(function (k) { if (/^(contact|plan)-/.test(k)) delete state.openForms[k]; });
    render();
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }
  function reqSummary(x) {
    var P = state.planData; if (!P || !P.requirements.length) return null;
    var yes = 0, no = 0, unk = 0, mustFail = false;
    P.requirements.forEach(function (q) {
      var r = reqStatus(x, q).result;
      if (r === 'Yes') yes++; else if (r === 'No') { no++; if (/must/i.test(q.priority)) mustFail = true; } else unk++;
    });
    return { yes: yes, no: no, unk: unk, total: P.requirements.length, mustFail: mustFail };
  }
  function reqChecklist(x) {
    var P = state.planData; if (!P || !P.requirements.length) return null;
    var sm = reqSummary(x), editable = canEditHome() && state.data.checks.has;
    var sections = [], by = {};
    P.requirements.forEach(function (q) { if (!by[q.section]) { by[q.section] = []; sections.push(q.section); } by[q.section].push(q); });
    var body = sections.map(function (name) {
      return h('div', null, h('h3', null, name), h('ul', { class: 'tasks' }, by[name].map(function (q) {
        var st = reqStatus(x, q);
        var seg = editable ? ['Yes', 'No'].map(function (r) {
          var on = st.source === 'checked' && st.result === r;
          return h('button', { type: 'button', class: 'seg', 'aria-pressed': String(on), disabled: state.saving ? true : null,
            'aria-label': r + ': ' + q.text, onclick: function () { save(setCheck(x, q, on ? '' : r), on ? 'Cleared' : 'Saved: ' + r); } }, r);
        }) : null;
        var label = st.result + (st.source === 'tour' ? ' (Tour Notes)' : st.source === 'checked' ? ' (checked)' : '');
        return h('li', { class: 'req' },
          h('div', { class: 'tbody' }, h('div', { class: 'ttitle' }, q.text),
            st.hint ? h('div', { class: 'muted small' }, 'Tour Notes: ' + st.hint) : null,
            st.note ? h('div', { class: 'muted small' }, st.note) : null),
          h('div', { class: 'chips', style: 'gap:6px' },
            q.priority ? h('span', { class: 'tag' + (/must/i.test(q.priority) ? ' active' : '') }, q.priority) : null,
            h('span', { class: 'tag' + (st.result === 'No' ? ' warn' : st.result === 'Yes' ? ' active' : '') }, label), seg));
      })));
    });
    var hint = canEditHome() && !state.data.checks.has
      ? h('p', { class: 'muted small' }, 'To save checks, add a tab named "Home Checks" to the home-search sheet with the headers: Home ID, Req ID, Requirement, Result, Note, Checked by, Checked on.') : null;
    return h('details', { class: 'reqlist', open: state.openReq[x.id] ? true : null, ontoggle: function (e) { state.openReq[x.id] = e.target.open; } },
      h('summary', null, 'Requirements: ' + sm.yes + ' met, ' + sm.no + ' not met, ' + sm.unk + ' unknown of ' + sm.total),
      h('div', { class: 'stack', style: 'margin-top:10px' }, hint, body));
  }
  function statusEditor(x) {
    if (!canEditHome()) return null;
    var options = STATUS_ORDER.slice();
    if (options.indexOf(x.status) < 0) options.unshift(x.status);
    var sel = h('select', { 'aria-label': 'Status for ' + homeName(x) }, options.map(function (o) { return h('option', { value: o, selected: o === x.status ? true : null }, o); }));
    var current = splitReasons(x.reason);
    var boxes = REASONS.map(function (r) {
      return h('input', { type: 'checkbox', value: r, checked: current.indexOf(r) >= 0 ? true : null, 'aria-label': r });
    });
    var group = h('fieldset', { class: 'reasons', hidden: sel.value === 'Rejected' ? null : true },
      h('legend', null, 'Why was it rejected? Pick all that apply.'),
      REASONS.map(function (r, i) { return h('label', null, boxes[i], r); }));
    sel.addEventListener('change', function () { group.hidden = sel.value !== 'Rejected'; });
    function chosen() { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }); }
    var tour = x.tour, td = tour ? String(tour['Decision'] || '').trim() : '';
    var sync = tour ? h('input', { type: 'checkbox', checked: true, 'aria-label': 'Also update the Decision in the latest Tour Notes entry' }) : null;
    var syncRow = tour ? h('label', { class: 'sync' }, sync, 'Also set the Decision in the latest Tour Notes entry' + (tour['Visit Date'] ? ' (' + tour['Visit Date'] + ')' : '') + ' to match') : null;
    var mismatch = tour && td && td.toLowerCase() !== x.status.toLowerCase()
      ? h('p', { class: 'muted small' }, 'Tour Notes says "' + td + '", but Home Listing says "' + x.status + '".') : null;
    return h('div', { class: 'stack', style: 'gap:8px' }, field('Change status', sel), group, syncRow, mismatch,
      sel.value !== 'Rejected' && current.length ? h('p', { class: 'muted small' }, 'Changing a rejected home to another status clears its reason.') : null,
      h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
        var picked = chosen();
        var doSync = !!(sync && sync.checked);
        var tourOff = doSync && td.toLowerCase() !== sel.value.toLowerCase();
        var same = sel.value === x.status && (sel.value !== 'Rejected' || picked.slice().sort().join('|') === current.slice().sort().join('|'));
        if (same && !tourOff) { toast('Nothing has changed.', true); return; }
        save(setHomeStatus(x, sel.value, picked, doSync), (sel.value === 'Rejected' ? 'Rejected, with reasons saved' : 'Status updated to ' + sel.value) + (doSync ? '. Tour Notes updated.' : ''));
      } }, 'Save status'));
  }
  function homeCard(x) {
    var t = x.tour || {};
    var priceText = money(x.price) + (x.upgrade && x.upgrade !== x.price ? ' (' + money(x.upgrade) + ' with upgrades)' : '');
    return h('details', { class: 'home', open: state.openHomes[x.id] ? true : null, ontoggle: function (e) { state.openHomes[x.id] = e.target.open; } },
      h('summary', null,
        h('div', { class: 'head' }, h('h3', null, homeName(x)), h('strong', null, money(x.price))),
        h('div', { class: 'muted small' }, [x.community, x.city].filter(Boolean).join(', ')),
        h('div', { class: 'chips' }, tagFor(x.status), x.added ? h('span', { class: 'tag' }, 'Added ' + x.added) : null, (function () { var np = nextPlan(x.id); return np ? h('span', { class: 'tag warn' }, 'Tour planned ' + planWhen(np)) : null; })(), (function () { var m = reqSummary(x); return m ? h('span', { class: 'tag' + (m.mustFail ? ' warn' : '') }, m.yes + ' of ' + m.total + ' requirements met' + (m.no ? ', ' + m.no + ' not met' : '')) : null; })(), x.reason ? h('span', { class: 'tag' }, x.reason) : null, x.visit ? h('span', { class: 'tag' }, 'Toured ' + x.visit) : null)
      ),
      h('div', { class: 'body' },
        h('dl', { class: 'kv' },
          fact('Address', x.address), fact('List price', priceText), fact('Square feet', x.sqft ? String(x.sqft) : ''),
          fact('Enclosed WC', t['Enclosed WC']), fact('HOA monthly', col(t, /^HOA Monthly/i)), fact('Decision', t['Decision']),
          fact('Contact', [x.contact, x.phone].filter(Boolean).join(', ')), fact('Home ID', x.id)),
        h('div', { class: 'two' },
          t['Pros'] ? h('div', null, h('h3', null, 'Pros'), h('p', null, t['Pros'])) : null,
          t['Cons'] ? h('div', null, h('h3', null, 'Cons'), h('p', null, t['Cons'])) : null,
          t['Decision Notes'] ? h('div', null, h('h3', null, 'Decision notes'), h('p', null, t['Decision Notes'])) : null,
          x.notes ? h('div', null, h('h3', null, 'Notes'), h('p', null, x.notes)) : null),
        x.contacts.length ? h('div', null, h('h3', null, 'Contacts'), h('ul', { class: 'list' }, x.contacts.map(function (c) {
          return h('li', null, h('strong', null, (c['Date'] ? c['Date'] + ': ' : '') + (c['Subject'] || 'Contact')),
            h('div', { class: 'muted small' }, [c['Contact Name'], c['Channel'], c['Direction']].filter(Boolean).join(', ')),
            c['Summary'] ? h('div', { class: 'small' }, c['Summary']) : null);
        }))) : null,
        reqChecklist(x),
        planSection(x),
        tourStart(x),
        contactForm(x),
        statusEditor(x),
        h('div', { class: 'chips' }, homeLinks(x), x.url ? h('a', { class: 'btn ghost small', href: x.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open listing') : null)
      )
    );
  }
  function viewHousing() {
    var homes = state.data.homes;
    var seen = {};
    homes.forEach(function (x) { seen[x.status] = true; });
    var statuses = ['All'].concat(Object.keys(seen).sort(function (a, b) {
      var ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }));
    if (statuses.indexOf(state.filter) < 0) state.filter = 'All';
    var shown = homes.filter(function (x) { return state.filter === 'All' || x.status === state.filter; });
    shown.sort(function (a, b) {
      var ia = STATUS_ORDER.indexOf(a.status), ib = STATUS_ORDER.indexOf(b.status);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id);
    });
    var quick = null;
    if (effectiveRole() === 'editor') {
      var links = ((state.planData && state.planData.links) || []).filter(function (l) { return /housing/i.test(l.group) && formUrl(l.url); });
      quick = h('section', { class: 'card stack' }, h('h2', null, 'Add or update'),
        links.length ? h('div', { class: 'chips' }, links.map(function (l) {
          return h('a', { class: 'btn small', href: formUrl(l.url), target: '_blank', rel: 'noopener noreferrer' }, l.name || 'Open form');
        }))
        : null);
      if (!links.length) quick = null;
    }
    return h('div', { class: 'stack' },
      h('div', null, h('h1', null, 'Housing'), h('p', { class: 'lede' }, 'Every home in your listing sheet, joined with tour notes and builder contacts by Home ID.')),
      h('div', { class: 'chips' }, h('a', { class: 'btn small', href: '#/compare' }, 'Compare homes side by side')),
      quick, canEditHome() ? addHomeForm() : null,
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by status' }, statuses.map(function (s) {
        return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.filter === s), onclick: function () { state.filter = s; render(); } }, s + ' (' + (s === 'All' ? homes.length : homes.filter(function (x) { return x.status === s; }).length) + ')');
      }).concat([h('button', { class: 'btn ghost small', type: 'button', onclick: collapseAllHomes }, 'Collapse all')])),
      shown.length ? h('div', { class: 'homes' }, shown.map(homeCard)) : h('p', { class: 'muted' }, 'No homes match this filter.')
    );
  }

  /* ----- Requirements ----- */
  var TRACKED = ['Tour Notes', 'Home Listings', 'Pre-qualify', 'Not captured'];
  function trackedKind(text) {
    var t = String(text || '').toLowerCase();
    return t.indexOf('tour') === 0 ? 'Tour Notes' : t.indexOf('home listing') === 0 || t.indexOf('listing') === 0 ? 'Home Listings'
      : t.indexOf('pre-qual') === 0 || t.indexOf('prequal') === 0 ? 'Pre-qualify' : 'Not captured';
  }
  function viewRequirements() {
    var head = pageHead('Requirements', 'What you want in the new home, and where each item is checked.');
    if (!state.plan) return h('div', { class: 'stack' }, head, connectCard('Requirements'));
    if (state.planError) return h('div', { class: 'stack' }, head, planProblem());
    var P = state.planData; if (!P) return h('div', { class: 'stack' }, head);
    if (!P.hasRequirements) {
      return h('div', { class: 'stack' }, head, h('section', { class: 'card stack' }, h('h2', null, 'Add a Requirements tab'),
        h('p', null, 'In the Runway planning sheet, add a tab named "Requirements" with these headers in row 1, in this order:'),
        h('p', null, h('strong', null, 'Section, Group, Requirement, Detail, Where it is tracked, Priority')),
        h('p', { class: 'muted' }, 'Priority is optional. The quickest way is to copy the Requirements tab from the Retirement Research workbook: right-click its tab, choose Copy to > Existing spreadsheet, pick the planning sheet, and rename the copy to Requirements. Then choose Refresh.')));
    }
    var items = P.requirements;
    if (!items.length) return h('div', { class: 'stack' }, head, h('p', { class: 'muted' }, 'The Requirements tab has no rows yet.'));
    var counts = {}; TRACKED.forEach(function (k) { counts[k] = 0; });
    items.forEach(function (q) { counts[q.tracked]++; });
    var sections = []; var byName = {};
    items.forEach(function (q) { if (!byName[q.section]) { byName[q.section] = []; sections.push(q.section); } byName[q.section].push(q); });

    var kind = 'All', query = '', rowEls = [], cardEls = [];
    function apply() {
      var needle = query.trim().toLowerCase();
      rowEls.forEach(function (r) {
        var ok = (kind === 'All' || r.q.tracked === kind) && (!needle || (r.q.text + ' ' + r.q.detail + ' ' + r.q.group + ' ' + r.q.section).toLowerCase().indexOf(needle) >= 0);
        r.el.hidden = !ok;
      });
      cardEls.forEach(function (c) { c.el.hidden = !c.rows.some(function (r) { return !r.el.hidden; }); });
      empty.hidden = cardEls.some(function (c) { return !c.el.hidden; });
    }
    var chipEls = ['All'].concat(TRACKED).map(function (k) {
      var b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === 'All'), onclick: function () {
        kind = k; chipEls.forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.k === k)); }); apply();
      } }, k === 'All' ? 'All (' + items.length + ')' : k + ' (' + counts[k] + ')');
      b.dataset.k = k; return b;
    });
    var search = h('input', { type: 'search', placeholder: 'Search requirements', 'aria-label': 'Search requirements', class: 'searchbox' });
    search.addEventListener('input', function () { query = search.value; apply(); });
    var empty = h('p', { class: 'muted', hidden: true }, 'Nothing matches.');

    var cards = sections.map(function (name) {
      var rows = byName[name].map(function (q) {
        var li = h('li', { class: 'req' },
          h('div', { class: 'tbody' }, h('div', { class: 'ttitle' }, q.text),
            q.group || q.detail ? h('div', { class: 'muted small' }, [q.group, q.detail].filter(Boolean).join(' | ')) : null),
          h('div', { class: 'chips', style: 'gap:6px' },
            q.priority ? h('span', { class: 'tag' + (/must/i.test(q.priority) ? ' active' : '') }, q.priority) : null,
            h('span', { class: 'tag' + (q.tracked === 'Not captured' ? ' warn' : q.tracked === 'Pre-qualify' ? '' : ' active') }, q.tracked)));
        return { el: li, q: q };
      });
      var card = h('section', { class: 'card stack' }, h('div', { class: 'sechead' }, h('h2', null, name), h('span', { class: 'muted small' }, byName[name].length + (byName[name].length === 1 ? ' item' : ' items'))),
        h('ul', { class: 'tasks' }, rows.map(function (r) { return r.el; })));
      cardEls.push({ el: card, rows: rows }); rows.forEach(function (r) { rowEls.push(r); });
      return card;
    });
    return h('div', { class: 'stack' }, head,
      h('section', { class: 'card stack' },
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by where it is tracked' }, chipEls), search,
        h('p', { class: 'muted small' }, 'Tour Notes and Home Listings: captured when you log a tour or add a home. Pre-qualify: confirm before adding a home to the pipeline. Not captured: check it yourself on each visit.')),
      cards, empty);
  }

  /* ----- Compare ----- */
  function viewCompare() {
    var d = state.data, homes = d.homes.slice();
    var head = pageHead('Compare homes', 'Pick up to six homes and see them side by side. Active homes are chosen to start.');
    if (!homes.length) return h('div', { class: 'stack' }, head, h('p', { class: 'muted' }, 'No homes yet.'));
    var ids = state.compareIds;
    if (!ids) { ids = homes.filter(function (x) { return x.status === 'Active'; }).map(function (x) { return x.id; }).slice(0, 6); state.compareIds = ids; }
    ids = ids.filter(function (id) { return homes.some(function (x) { return x.id === id; }); });
    var picked = ids.map(function (id) { return homes.filter(function (x) { return x.id === id; })[0]; });
    var chips = homes.map(function (x) {
      var on = ids.indexOf(x.id) >= 0;
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), onclick: function () {
        var cur = (state.compareIds || []).slice(), i = cur.indexOf(x.id);
        if (i >= 0) cur.splice(i, 1); else { if (cur.length >= 6) { toast('Compare up to six homes at a time.', true); return; } cur.push(x.id); }
        state.compareIds = cur; render();
      } }, homeName(x));
    });
    var controls = h('section', { class: 'card stack' }, h('div', { class: 'chips', role: 'group', 'aria-label': 'Homes to compare' }, chips),
      h('div', { class: 'chips' }, h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.compareDiff), onclick: function () { state.compareDiff = !state.compareDiff; render(); } }, 'Show only requirement differences'),
        h('button', { class: 'chip', type: 'button', onclick: function () { state.compareIds = homes.filter(function (x) { return x.status === 'Active'; }).map(function (x) { return x.id; }).slice(0, 6); render(); } }, 'Reset to Active homes')));
    if (!picked.length) return h('div', { class: 'stack' }, head, controls, h('p', { class: 'muted' }, 'Choose at least one home above.'));

    var P = state.planData && state.planData.requirements && state.planData.requirements.length ? state.planData : null;
    var rows = [];
    function section(label) { rows.push(h('tr', { class: 'section' }, h('th', { colspan: String(picked.length + 1), scope: 'colgroup' }, label))); }
    function line(label, cells) { rows.push(h('tr', null, h('th', { scope: 'row' }, label), cells.map(function (c) { return h('td', null, c); }))); }
    function perSqft(x) { return x.price && x.sqft ? '$' + Math.round(x.price / x.sqft) + ' per sq ft' : ''; }
    function latestContact(x) {
      var best = null;
      x.contacts.forEach(function (c) { var dt = parseDate(c['Date']); if (!best || (dt && (!best.dt || dt > best.dt))) best = { c: c, dt: dt }; });
      return best ? (best.c['Date'] ? best.c['Date'] + ': ' : '') + (best.c['Subject'] || 'Contact') : '';
    }
    function followUp(x) {
      var f = x.contacts.filter(function (c) { return /^y/i.test(col(c, /^action required/i)); })[0];
      return f ? (col(f, /^next action/i) || f['Subject'] || 'Follow up') + (col(f, /^due date/i) ? ' (due ' + col(f, /^due date/i) + ')' : '') : '';
    }
    section('The basics');
    line('Status', picked.map(function (x) { return tagFor(x.status); }));
    line('Community', picked.map(function (x) { return [x.community, x.city].filter(Boolean).join(', '); }));
    line('List price', picked.map(function (x) { return x.price !== null ? money(x.price) : ''; }));
    line('With upgrades', picked.map(function (x) { return x.upgrade !== null && x.upgrade !== x.price ? money(x.upgrade) : ''; }));
    line('Price per sq ft', picked.map(perSqft));
    line('Square feet', picked.map(function (x) { return x.sqft ? String(x.sqft) : ''; }));
    line('Beds and baths', picked.map(function (x) { return [x.beds ? x.beds + ' bed' : '', x.baths ? x.baths + ' bath' : ''].filter(Boolean).join(', '); }));
    line('Garage', picked.map(function (x) { return x.garage; }));
    line('HOA monthly', picked.map(function (x) { var v = x.tour ? tourValue(x.tour, 'HOA Monthly') : ''; return v ? (/^\d/.test(v) ? '$' + v : v) : ''; }));
    section('Where you stand');
    line('Toured', picked.map(function (x) { return x.visit || (x.tour && x.tour['Visit Date']) || 'Not yet'; }));
    line('Tour decision', picked.map(function (x) { return x.tour ? x.tour['Decision'] || '' : ''; }));
    line('Latest contact', picked.map(latestContact));
    line('Open follow-up', picked.map(followUp));
    line('Pros', picked.map(function (x) { return x.tour ? x.tour['Pros'] || '' : ''; }));
    line('Cons', picked.map(function (x) { return x.tour ? x.tour['Cons'] || '' : ''; }));
    line('Listing', picked.map(function (x) { return x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open listing') : ''; }));
    if (P) {
      section('Requirements');
      line('Summary', picked.map(function (x) {
        var m = reqSummary(x);
        return h('span', { class: 'tag' + (m.mustFail ? ' warn' : '') }, m.yes + ' met, ' + m.no + ' not met, ' + m.unk + ' unknown');
      }));
      var shown = 0;
      P.requirements.forEach(function (q) {
        var st = picked.map(function (x) { return reqStatus(x, q); });
        var same = st.every(function (r) { return r.result === st[0].result; });
        if (state.compareDiff && same) return;
        shown++;
        line(q.text, st.map(function (r) { return h('span', { class: 'tag' + (r.result === 'No' ? ' warn' : r.result === 'Yes' ? ' active' : '') }, r.result === 'Unknown' ? '?' : r.result); }));
      });
      if (!shown) rows.push(h('tr', null, h('td', { colspan: String(picked.length + 1) }, 'The selected homes have the same answer on every requirement.')));
    }
    var grid = h('table', { class: 'cmp' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, ''), picked.map(function (x) { return h('th', { scope: 'col' }, h('div', null, homeName(x)), h('div', { class: 'muted small' }, x.id)); }))),
      h('tbody', null, rows));
    return h('div', { class: 'stack' }, head, controls, h('section', { class: 'card scroll' }, grid));
  }

  /* ----- Journal ----- */
  function addJournalForm(P) {
    var title = keep('journal', 'title', h('input', { type: 'text', maxlength: '200', placeholder: 'A moment worth remembering' }));
    var date = h('input', { type: 'date' });
    var d0 = new Date(); date.value = d0.getFullYear() + '-' + pad(d0.getMonth() + 1, 2) + '-' + pad(d0.getDate(), 2);
    keep('journal', 'date', date);
    var detail = keep('journal', 'detail', h('textarea', { rows: '4', maxlength: '2000', placeholder: 'What happened, and how it felt' }));
    return h('details', formAttrs('journal', true), h('summary', null, 'Add an entry'),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        field('Title', title), field('Date', date), field('Details (optional)', detail),
        h('button', { class: 'btn', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!title.value.trim()) { toast('Give the entry a title.', true); return; }
          submit('journal', save(addJournal({ title: title.value.trim(), date: date.value, detail: detail.value.trim() }), 'Entry added'));
        } }, 'Save entry')));
  }
  function viewJournal() {
    var head = pageHead('Journal', 'Moments from the journey, in your own words.');
    if (!state.plan) return h('div', { class: 'stack' }, head, connectCard('The journal'));
    if (state.planError) return h('div', { class: 'stack' }, head, planProblem());
    var P = state.planData; if (!P) return h('div', { class: 'stack' }, head);
    if (!P.hasJournal) {
      return h('div', { class: 'stack' }, head, h('section', { class: 'card stack' }, h('h2', null, 'Add a Journal tab'),
        h('p', null, 'In the Runway planning sheet, add a tab named "Journal" with these headers in row 1, in this order:'),
        h('p', null, h('strong', null, 'Entry ID, Date, Title, Detail, Logged by')),
        h('p', { class: 'muted' }, 'Then choose Refresh.')));
    }
    var list = P.journal.slice().sort(function (a, b) { return (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0); });
    return h('div', { class: 'stack' }, head,
      canEditPlan() ? addJournalForm(P) : h('p', { class: 'muted small' }, 'You can read every entry. Only people with edit access to the planning sheet can add them.'),
      list.length ? list.map(function (e) {
        return h('section', { class: 'card stack', style: 'gap:6px' }, h('h2', null, e.title),
          h('div', { class: 'muted small' }, [e.dateText, e.by].filter(Boolean).join(' | ')),
          e.detail ? h('p', { style: 'white-space:pre-wrap' }, e.detail) : null);
      }) : h('p', { class: 'muted' }, 'No entries yet.'));
  }

  function viewChronology() {
    var d = state.data, names = {}, ev = [], seen = {};
    d.homes.forEach(function (x) { names[x.id] = homeName(x); });
    function addTour(id, dateStr, detail) {
      var dt = parseDate(dateStr); if (!dt) return;
      var key = id + '|' + dt.getTime(); if (seen[key]) return; seen[key] = true;
      ev.push({ date: dt, tag: 'Tour', title: 'Toured ' + (names[id] || id || 'a home'), detail: detail || '' });
    }
    d.tours.forEach(function (t) { addTour(t['Home ID'], t['Visit Date'], [t['Decision'], t['Decision Notes']].filter(Boolean).join('. ')); });
    d.homes.forEach(function (x) { addTour(x.id, x.visit, x.reason); });
    d.contacts.forEach(function (c) {
      var dt = parseDate(c['Date']); if (!dt) return;
      ev.push({ date: dt, tag: 'Contact', title: c['Subject'] || 'Contact',
        detail: [c['Contact Name'], c['Builder']].filter(Boolean).join(', ') + (c['Summary'] ? ': ' + c['Summary'] : '') });
    });
    if (state.planData) {
      state.planData.tasks.forEach(function (t) {
        var dt = t.status === 'Done' ? parseDate(t.completedOn) : null;
        if (dt) ev.push({ date: dt, tag: 'Task', title: 'Done: ' + t.title, detail: [t.stream, t.completedBy ? 'by ' + t.completedBy : ''].filter(Boolean).join(', ') });
      });
      state.planData.journal.forEach(function (e) {
        if (e.date) ev.push({ date: e.date, tag: 'Journal', title: e.title, detail: e.detail });
      });
      state.planData.decisions.forEach(function (x) {
        var dt = x.status === 'Decided' ? parseDate(x.decidedOn) : null;
        if (dt) ev.push({ date: dt, tag: 'Decision', title: 'Decided: ' + x.title, detail: x.reasoning });
      });
    }
    d.plans.list.forEach(function (p) {
      if (p.status !== 'Planned' || !p.date) return;
      var late = p.date < startOfToday();
      ev.push({ date: p.date, tag: 'Planned', title: (late ? 'Planned tour, not yet logged: ' : 'Planned tour: ') + (names[p.id] || p.id), detail: [p.time ? 'At ' + clockText(p.time) : '', p.note].filter(Boolean).join('. ') });
    });
    var target = new Date(C.TARGET_DATE + 'T00:00:00');
    ev.push({ date: target, tag: 'Milestone', title: 'Target date', detail: '' });
    ev.sort(function (a, b) { return a.date - b.date; });
    var now = new Date(), rows = [], placed = false;
    function row(e, kind) {
      return h('div', { class: 'ev' + (kind === 'today' ? ' today-row' : '') },
        h('div', { class: 'when' }, kind === 'today' ? 'Today' : fmtDate(e.date).replace(/, (\d{4})$/, ''), h('small', null, kind === 'today' ? '' : String(e.date.getFullYear()))),
        h('div', { class: 'rail' }, h('div', { class: 'dot ' + kind }), h('div', { class: 'line' })),
        h('div', { class: 'what' }, kind === 'today' ? h('h3', null, 'You are here') : [h('span', { class: 'tag' }, e.tag), h('h3', null, e.title), e.detail ? h('p', { class: 'muted' }, e.detail) : null]));
    }
    ev.forEach(function (e) {
      if (!placed && e.date > now) { rows.push(row({ date: now }, 'today')); placed = true; }
      rows.push(row(e, e.date > now ? 'future' : ''));
    });
    if (!placed) rows.push(row({ date: now }, 'today'));
    return h('div', { class: 'stack' },
      pageHead('Chronology', 'The journey in order: tours, builder contacts, finished tasks, decisions and journal entries.'),
      h('section', { class: 'card' }, h('div', { class: 'tl' }, rows)));
  }

  function addDocForm() {
    var d = state.data;
    var title = keep('doc', 'title', h('input', { type: 'text', maxlength: '200', placeholder: 'What the document is' }));
    var url = keep('doc', 'url', h('input', { type: 'url', maxlength: '800', placeholder: 'https://', inputmode: 'url' }));
    var names = {};
    ((state.planData && state.planData.streams) || []).forEach(function (n) { names[n] = true; });
    (d.docs || []).forEach(function (r) { if (r['Workstream']) names[r['Workstream']] = true; });
    var stream = keep('doc', 'stream', h('input', { type: 'text', list: 'doc-streams', maxlength: '60' }));
    var dl = h('datalist', { id: 'doc-streams' }, Object.keys(names).map(function (n) { return h('option', { value: n }); }));
    var home = keep('doc', 'home', h('select', null, h('option', { value: '' }, 'Not about one home'), d.homes.map(function (x) { return h('option', { value: x.id }, homeFormLabel(x)); })));
    var owner = keep('doc', 'owner', h('input', { type: 'text', maxlength: '40' }));
    var sens = keep('doc', 'sens', h('select', null, h('option', { value: 'Normal' }, 'Normal'), h('option', { value: 'Sensitive' }, 'Sensitive')));
    var review = keep('doc', 'review', h('input', { type: 'date' }));
    return h('details', formAttrs('doc'), h('summary', null, 'Add a document link'),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        h('p', { class: 'muted small' }, 'Add the link only. The file stays in Drive, and Runway does not change who can open it, so share the file in Drive first. Never add account numbers, SSNs or passwords.'),
        field('Title', title), field('Link (https)', url), field('Workstream', stream), dl, field('About a home (optional)', home), field('Owner (optional)', owner),
        field('Sensitivity', sens), field('Review date (optional)', review),
        h('button', { class: 'btn', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          var link = url.value.trim();
          if (!title.value.trim()) { toast('Give the document a title.', true); return; }
          if (!/^https:\/\//i.test(link)) { toast('The link must start with https://', true); return; }
          var dup = (d.docs || []).some(function (r) { return String(r['URL'] || '').trim() === link; });
          if (dup) { toast('That link is already in the list.', true); return; }
          submit('doc', save(addDocument({ title: title.value.trim(), url: link, stream: stream.value.trim(), homeId: home.value, owner: owner.value.trim(), sensitivity: sens.value, review: review.value }), 'Document added'));
        } }, 'Add document')));
  }
  function viewDocuments() {
    var docs = state.data.docs;
    var head = h('div', null, h('h1', null, 'Documents'), h('p', { class: 'lede' }, 'Links and files, indexed from the Documents & Links tab. Runway lists them; the files stay in Drive.'));
    if (docs === null) return h('div', { class: 'stack' }, head, h('section', { class: 'card' }, h('p', null, 'Runway could not find a tab named "Documents & Links". Add it, then choose Refresh.')));
    var form = canEditHome() && state.data.docsHead.length ? addDocForm() : null;
    if (!docs.length) return h('div', { class: 'stack' }, head, form, h('section', { class: 'card' }, h('p', null, 'No documents yet.' + (form ? '' : ' Add a row in the Documents & Links tab.'))));
    return h('div', { class: 'stack' }, head, form,
      h('section', { class: 'card scroll' }, h('table', null,
        h('thead', null, h('tr', null, ['Title', 'Workstream', 'Home', 'Owner', 'Review date'].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, docs.map(function (r) {
          var url = r['URL'] || (r['Drive file ID'] ? 'https://drive.google.com/open?id=' + encodeURIComponent(r['Drive file ID']) : '');
          return h('tr', null,
            h('td', null, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, r['Title'] || 'Untitled') : (r['Title'] || 'Untitled'), ' ',
              /sensitive/i.test(r['Sensitivity'] || '') ? h('span', { class: 'tag warn' }, 'Sensitive') : null),
            h('td', null, r['Workstream'] || ''), h('td', null, r['Home ID'] || ''), h('td', null, r['Owner'] || ''), h('td', null, r['Review date'] || ''));
        })))));
  }

  function viewSheets() {
    function row(title, file, onChange, role, extra) {
      return h('section', { class: 'card stack' }, h('h2', null, title),
        file ? h('p', null, h('strong', null, file.name || 'Chosen sheet'), role ? h('span', { class: 'tag', style: 'margin-left:8px' }, role === 'editor' ? 'You can edit' : role === 'viewer' ? 'View only' : 'Role unknown') : null) : h('p', { class: 'muted' }, 'Not connected.'),
        extra || null,
        h('div', { class: 'chips' }, h('button', { class: 'btn small', type: 'button', onclick: onChange }, file ? 'Change sheet' : 'Choose sheet')));
    }
    return h('div', { class: 'stack' }, pageHead('Sheets', 'The two Google Sheets Runway reads. Runway can open only the files you choose here.'),
      row('Home-search sheet', state.sheet, doPick, state.role),
      row('Runway planning sheet', state.plan, doPickPlan, state.planRole),
      h('section', { class: 'card stack' }, h('h2', null, 'About'),
        h('p', null, 'Runway version ' + APP_VERSION), h('p', null, h('a', { href: 'privacy.html' }, 'Privacy policy'))));
  }

  /* ---------- shell ---------- */
  var ROUTES = {
    overview: ['Overview', viewOverview], tasks: ['Tasks', viewTasks], decisions: ['Decisions', viewDecisions],
    housing: ['Housing', viewHousing], tour: ['Log a tour', viewTour], compare: ['Compare homes', viewCompare], requirements: ['Requirements', viewRequirements], chronology: ['Chronology', viewChronology], journal: ['Journal', viewJournal], documents: ['Documents', viewDocuments], sheets: ['Sheets', viewSheets]
  };
  var NAV = ['overview', 'tasks', 'decisions', 'housing', 'requirements', 'chronology', 'journal', 'documents'];

  function go(r) { location.hash = '#/' + r; }
  function readRoute() {
    var parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    state.route = ROUTES[parts[0]] ? parts[0] : 'overview';
    state.routeArg = parts[1] ? decodeURIComponent(parts[1]) : '';
  }

  function logo() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '28'); svg.setAttribute('height', '28'); svg.setAttribute('viewBox', '0 0 28 28');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke-width', '2.5'); svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    ['M3 22 L11 14 L16 18 L25 6', 'M19 6 H25 V12'].forEach(function (d) {
      var p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.appendChild(p);
    });
    return svg;
  }
  function errorBox() {
    var e = state.error; if (!e) return null;
    return h('div', { class: 'alert', role: 'alert' }, h('strong', null, e.title), h('span', null, e.body),
      e.action === 'pick' ? h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn small', type: 'button', onclick: doPick }, 'Choose sheet')) : null,
      e.action === 'signin' ? h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn small', type: 'button', onclick: function () { doSignIn(''); } }, 'Sign in again')) : null);
  }

  function screenSignIn() {
    return h('div', { class: 'center' }, h('div', { class: 'box' },
      h('div', { class: 'brand' }, logo(), 'Runway'),
      h('h1', null, 'One shared plan for what comes next.'),
      h('p', { class: 'muted' }, 'Sign in with the Google account the owner shared Runway with. Runway reads only the sheets you choose.'),
      h('button', { class: 'btn', type: 'button', onclick: function () { doSignIn(''); } }, 'Continue with Google'),
      errorBox(),
      h('p', { class: 'muted small' }, 'Private. Invitation only. ', h('a', { href: 'privacy.html' }, 'Privacy policy'))));
  }
  function screenChoose() {
    return h('div', { class: 'center' }, h('div', { class: 'box' },
      h('div', { class: 'brand' }, logo(), 'Runway'),
      h('h1', null, 'Choose your sheet'),
      h('p', { class: 'muted' }, 'Pick your home-search sheet once. Runway remembers the choice on this device and can open only the files you choose.'),
      h('button', { class: 'btn', type: 'button', onclick: doPick }, 'Choose sheet'),
      errorBox(),
      h('button', { class: 'btn ghost small', type: 'button', onclick: doSignOut }, 'Sign out')));
  }
  function screenLoading() {
    return h('div', { class: 'center' }, h('div', { class: 'spin', role: 'status', 'aria-label': 'Loading' }), h('p', { class: 'muted' }, 'Loading your sheets'));
  }

  function effectiveRole() {
    if (state.role === 'viewer' || (state.plan && state.planRole === 'viewer')) return 'viewer';
    if (state.role === 'editor' && (!state.plan || state.planRole === 'editor')) return 'editor';
    return 'unknown';
  }

  function screenApp() {
    var name = (state.user && (state.user.given_name || state.user.email)) || 'you';
    var role = effectiveRole(), banner = null;
    if (role === 'viewer') {
      banner = h('div', { class: 'banner', role: 'status' }, h('div', { class: 'in' },
        h('strong', null, 'View only.'), h('span', null, 'You\'re signed in as ' + name + '. You can see everything in Runway. Only the sheet\'s owner and editors can make changes.'),
        h('span', { class: 'pill' }, 'Role: viewer')));
    } else if (role === 'unknown') {
      banner = h('div', { class: 'banner', role: 'status' }, h('div', { class: 'in' },
        h('span', null, 'Runway could not confirm whether you can edit. Changes are blocked unless Google confirms your access.')));
    }
    var links = NAV.map(function (k) { return h('a', { href: '#/' + k, 'aria-current': state.route === k ? 'page' : null }, ROUTES[k][0]); });
    var top = h('header', { class: 'top' }, h('div', { class: 'in' },
      h('div', { class: 'brand' }, logo(), 'Runway'),
      h('nav', { 'aria-label': 'Main' }, links),
      h('div', { class: 'who' },
        state.user ? h('span', null, state.user.email) : null,
        role === 'editor' ? h('span', { class: 'pill' }, 'Role: editor') : null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: loadAll }, 'Refresh'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: function () { go('sheets'); } }, 'Sheets'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: doSignOut }, 'Sign out'))));
    var content = state.route === 'sheets' ? viewSheets() : state.error ? errorBox() : (state.data ? ROUTES[state.route][1]() : null);
    var foot = h('div', { class: 'foot' },
      'Runway v' + APP_VERSION + '. ',
      state.loadedAt ? 'Loaded ' + state.loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '. ' : '',
      'Housing changes are made in Runway or in the home-search sheet. ',
      h('a', { href: 'privacy.html' }, 'Privacy policy'));
    var note = state.notice ? h('div', { class: 'notice', role: 'status' }, h('span', null, state.notice),
      h('button', { class: 'btn ghost small', type: 'button', onclick: function () { state.notice = null; render(); } }, 'Dismiss')) : null;
    return h('div', null, banner, top, note, h('main', null, content), foot);
  }

  function render() {
    readRoute();
    var y = window.scrollY || 0;
    app.replaceChildren(
      state.needSignIn || !state.token && !state.data ? screenSignIn()
        : !state.sheet ? screenChoose()
        : state.busy && !state.data ? screenLoading()
        : screenApp()
    );
    try { if (y) window.scrollTo(0, y); } catch (e) { /* ignore */ }
    document.title = (state.needSignIn ? 'Runway' : ROUTES[state.route][0] + ' | Runway');
  }

  window.addEventListener('hashchange', render);
  render();
})();
