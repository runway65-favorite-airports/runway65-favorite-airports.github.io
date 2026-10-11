/* Runway v0.10.0.
   - Signs in with Google (token flow, token kept in memory only).
   - Opens the sheets the person picks (drive.file scope): the home-search sheet and the Runway planning sheet.
   - Shows Overview, Tasks, Decisions, Housing, Chronology, Journal and Documents.
   - Editors (by Google's sharing settings) can check off tasks, add tasks, decisions and journal entries, and change a home's status pick why a home was rejected, and add document links.
   Sheet text is always inserted as text (never as HTML). */
(function () {
  'use strict';

  var APP_VERSION = '0.10.0';
  var C = window.RUNWAY_CONFIG;
  var SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
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
    loadedAt: null, busy: false, error: null, saving: false, toast: null,
    route: 'overview', openHomes: {}, filter: 'All', taskStream: 'All', showDone: false, needSignIn: true
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
    if (/Unable to parse range/i.test(m)) return { title: 'A tab is missing', body: m };
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
  function buildHomes(t) {
    var tours = groupBy(t.tours, 'Home ID');
    var contacts = groupBy(t.contacts, 'Home ID');
    return t.listing.filter(function (r) { return r['Home ID']; }).map(function (r) {
      var id = r['Home ID'];
      return {
        id: id, row: r._row, builder: r['Builder'] || '', model: r['Model'] || '', community: r['Community'] || '', city: r['City'] || '',
        status: canonStatus(r['Status']), price: num(r['List Price']), upgrade: num(r['Upgrade Price']), sqft: num(r['Sq Ft']),
        visit: r['Visit Date'] || '', reason: r['Rejected Reason'] || '', url: r['Listing URL'] || '', address: r['Address'] || '',
        notes: r['Notes'] || '', contact: r['Contact'] || '', phone: r['Tel. #'] || '',
        tour: (tours[id] || [])[0] || null, contacts: contacts[id] || []
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
        .then(function () { return by; });
    }).then(function (by) {
      state.data = { homes: buildHomes(by), tours: by.tours || [], contacts: by.contacts || [], docs: by.docs, listingHead: (by.listing && by.listing.head) || [], docsHead: (by.docs && by.docs.head) || [] };
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
  function setHomeStatus(x, status, reasons) {
    var head = state.data.listingHead, iS = head.indexOf('Status'), iId = head.indexOf('Home ID'), iR = head.indexOf('Rejected Reason');
    if (iS < 0 || iId < 0) return Promise.reject(new Error('The Home Listing tab needs Status and Home ID columns.'));
    if (STATUS_ORDER.indexOf(status) < 0) return Promise.reject(new Error('Choose one of the standard statuses.'));
    var rejected = status === 'Rejected';
    reasons = rejected ? (reasons || []) : [];
    if (rejected && !reasons.length) return Promise.reject(new Error('Pick at least one reason for the rejection.'));
    if (reasons.some(function (r) { return REASONS.indexOf(r) < 0; })) return Promise.reject(new Error('Choose reasons from the list.'));
    var reasonText = reasons.join(', ');
    return api(homeBase() + '/values/' + enc("'Home Listing'!" + colLetter(iId) + x.row)).then(function (j) {
      var v = j.values && j.values[0] ? String(j.values[0][0]).trim() : '';
      if (v !== x.id) throw new Error('The sheet changed since it was loaded. Runway refreshed it. Please try again.');
      var data = [{ range: "'Home Listing'!" + colLetter(iS) + x.row, values: [[safeText(status)]] }];
      if (iR >= 0) data.push({ range: "'Home Listing'!" + colLetter(iR) + x.row, values: [[safeText(reasonText)]] });
      return api(homeBase() + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data: data } });
    }).then(function () { x.status = status; if (state.data.listingHead.indexOf('Rejected Reason') >= 0) x.reason = reasonText; });
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
  function toast(text, bad) {
    state.toast = { text: text, bad: !!bad }; render();
    setTimeout(function () { state.toast = null; render(); }, 4500);
  }
  function save(promise, okText) {
    state.saving = true; render();
    return promise.then(function () { state.saving = false; toast(okText); })
      .catch(function (e) {
        state.saving = false;
        var msg = e && e.message ? e.message : 'Could not save.';
        if (/changed since/.test(msg)) loadAll().then(function () { toast(msg, true); }); else toast(msg, true);
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
    state.token = null; state.expires = 0; state.user = null; state.data = null; state.planData = null;
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
    return state.planError ? h('div', { class: 'alert', role: 'alert' }, h('strong', null, state.planError.title), h('span', null, state.planError.body)) : null;
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
      h('div', { class: 'row' },
        h('section', { class: 'card col stack' },
          h('h2', null, 'Active candidates'),
          active.length ? h('ul', { class: 'list' }, active.map(function (x) {
            return h('li', null,
              h('div', { style: 'display:flex;justify-content:space-between;gap:12px' }, h('strong', null, homeName(x)), h('span', null, money(x.price))),
              h('div', { class: 'muted small' }, [x.community, x.city].filter(Boolean).join(', ')),
              h('div', { class: 'small' }, x.visit ? 'Toured ' + x.visit : 'Not toured yet'));
          })) : h('p', { class: 'muted' }, 'No homes marked Active.')),
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
    var title = h('input', { type: 'text', maxlength: '200', placeholder: 'What needs doing' });
    var stream = h('select', null, (P.streams.length ? P.streams : ['Other']).map(function (s) { return h('option', { value: s }, s); }));
    var owner = h('input', { type: 'text', list: 'owners', maxlength: '40' });
    var owners = {}; P.tasks.forEach(function (t) { if (t.owner) owners[t.owner] = true; });
    var dl = h('datalist', { id: 'owners' }, Object.keys(owners).map(function (o) { return h('option', { value: o }); }));
    var due = h('input', { type: 'date' });
    var notes = h('input', { type: 'text', maxlength: '300' });
    return h('details', { class: 'card addform' }, h('summary', null, 'Add a task'),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        field('Task', title), field('Workstream', stream), field('Owner', owner), dl, field('Due date (optional)', due), field('Notes (optional)', notes),
        h('button', { class: 'btn', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!title.value.trim()) { toast('Give the task a title.', true); return; }
          save(addTask({ title: title.value.trim(), stream: stream.value, owner: owner.value.trim(), due: due.value, notes: notes.value.trim() }), 'Task added');
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
    var title = h('input', { type: 'text', maxlength: '200' });
    var stream = h('select', null, (P.streams.length ? P.streams : ['Other']).map(function (s) { return h('option', { value: s }, s); }));
    var options = h('input', { type: 'text', maxlength: '400' });
    var owners = h('input', { type: 'text', maxlength: '80' });
    var cfp = h('select', null, h('option', { value: 'No' }, 'No'), h('option', { value: 'Yes' }, 'Yes'));
    return h('details', { class: 'card addform' }, h('summary', null, 'Add a decision'),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        field('Decision', title), field('Workstream', stream), field('Options (optional)', options), field('Who decides', owners), field('Needs CFP input', cfp),
        h('button', { class: 'btn', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!title.value.trim()) { toast('Give the decision a title.', true); return; }
          save(addDecision({ title: title.value.trim(), stream: stream.value, options: options.value.trim(), owners: owners.value.trim(), cfp: cfp.value }), 'Decision added');
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
    return h('div', { class: 'stack', style: 'gap:8px' }, field('Change status', sel), group,
      sel.value !== 'Rejected' && current.length ? h('p', { class: 'muted small' }, 'Changing a rejected home to another status clears its reason.') : null,
      h('button', { class: 'btn small', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
        var picked = chosen();
        var same = sel.value === x.status && (sel.value !== 'Rejected' || picked.slice().sort().join('|') === current.slice().sort().join('|'));
        if (same) { toast('Nothing has changed.', true); return; }
        save(setHomeStatus(x, sel.value, picked), sel.value === 'Rejected' ? 'Rejected, with reasons saved' : 'Status updated to ' + sel.value);
      } }, 'Save status'));
  }
  function homeCard(x) {
    var t = x.tour || {};
    var priceText = money(x.price) + (x.upgrade && x.upgrade !== x.price ? ' (' + money(x.upgrade) + ' with upgrades)' : '');
    return h('details', { class: 'home', open: state.openHomes[x.id] ? true : null, ontoggle: function (e) { state.openHomes[x.id] = e.target.open; } },
      h('summary', null,
        h('div', { class: 'head' }, h('h3', null, homeName(x)), h('strong', null, money(x.price))),
        h('div', { class: 'muted small' }, [x.community, x.city].filter(Boolean).join(', ')),
        h('div', { class: 'chips' }, tagFor(x.status), x.reason ? h('span', { class: 'tag' }, x.reason) : null, x.visit ? h('span', { class: 'tag' }, 'Toured ' + x.visit) : null)
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
        }), state.sheet ? h('a', { class: 'btn ghost small', href: 'https://docs.google.com/spreadsheets/d/' + enc(state.sheet.id) + '/edit', target: '_blank', rel: 'noopener noreferrer' }, 'Open the sheet') : null)
        : h('p', { class: 'muted' }, 'Add your Google Form links to a tab named Links in the Runway planning sheet (Name, URL, Group = Housing forms), then choose Refresh. Buttons for each form will appear here.'));
    }
    return h('div', { class: 'stack' },
      h('div', null, h('h1', null, 'Housing'), h('p', { class: 'lede' }, 'Every home in your listing sheet, joined with tour notes and builder contacts by Home ID.')),
      quick,
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by status' }, statuses.map(function (s) {
        return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.filter === s), onclick: function () { state.filter = s; render(); } }, s);
      })),
      shown.length ? h('div', { class: 'homes' }, shown.map(homeCard)) : h('p', { class: 'muted' }, 'No homes match this filter.')
    );
  }

  /* ----- Journal ----- */
  function addJournalForm(P) {
    var title = h('input', { type: 'text', maxlength: '200', placeholder: 'A moment worth remembering' });
    var date = h('input', { type: 'date' });
    var d0 = new Date(); date.value = d0.getFullYear() + '-' + pad(d0.getMonth() + 1, 2) + '-' + pad(d0.getDate(), 2);
    var detail = h('textarea', { rows: '4', maxlength: '2000', placeholder: 'What happened, and how it felt' });
    return h('details', { class: 'card addform', open: true }, h('summary', null, 'Add an entry'),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        field('Title', title), field('Date', date), field('Details (optional)', detail),
        h('button', { class: 'btn', type: 'button', style: 'align-self:flex-start', disabled: state.saving ? true : null, onclick: function () {
          if (!title.value.trim()) { toast('Give the entry a title.', true); return; }
          save(addJournal({ title: title.value.trim(), date: date.value, detail: detail.value.trim() }), 'Entry added');
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
    var title = h('input', { type: 'text', maxlength: '200', placeholder: 'What the document is' });
    var url = h('input', { type: 'url', maxlength: '800', placeholder: 'https://', inputmode: 'url' });
    var names = {};
    ((state.planData && state.planData.streams) || []).forEach(function (n) { names[n] = true; });
    (d.docs || []).forEach(function (r) { if (r['Workstream']) names[r['Workstream']] = true; });
    var stream = h('input', { type: 'text', list: 'doc-streams', maxlength: '60' });
    var dl = h('datalist', { id: 'doc-streams' }, Object.keys(names).map(function (n) { return h('option', { value: n }); }));
    var home = h('select', null, h('option', { value: '' }, 'Not about one home'), d.homes.map(function (x) { return h('option', { value: x.id }, homeFormLabel(x)); }));
    var owner = h('input', { type: 'text', maxlength: '40' });
    var sens = h('select', null, h('option', { value: 'Normal' }, 'Normal'), h('option', { value: 'Sensitive' }, 'Sensitive'));
    var review = h('input', { type: 'date' });
    return h('details', { class: 'card addform' }, h('summary', null, 'Add a document link'),
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
          save(addDocument({ title: title.value.trim(), url: link, stream: stream.value.trim(), homeId: home.value, owner: owner.value.trim(), sensitivity: sens.value, review: review.value }), 'Document added');
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
        h('div', { class: 'chips' }, h('button', { class: 'btn small', type: 'button', onclick: onChange }, file ? 'Change sheet' : 'Choose sheet'),
          file ? h('a', { class: 'btn ghost small', href: 'https://docs.google.com/spreadsheets/d/' + enc(file.id) + '/edit', target: '_blank', rel: 'noopener noreferrer' }, 'Open in Google Sheets') : null));
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
    housing: ['Housing', viewHousing], chronology: ['Chronology', viewChronology], journal: ['Journal', viewJournal], documents: ['Documents', viewDocuments], sheets: ['Sheets', viewSheets]
  };
  var NAV = ['overview', 'tasks', 'decisions', 'housing', 'chronology', 'journal', 'documents'];

  function go(r) { location.hash = '#/' + r; }
  function readRoute() {
    var r = (location.hash || '').replace(/^#\/?/, '');
    state.route = ROUTES[r] ? r : 'overview';
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
    var content = state.error ? errorBox() : (state.data ? ROUTES[state.route][1]() : null);
    var foot = h('div', { class: 'foot' },
      'Runway v' + APP_VERSION + '. ',
      state.loadedAt ? 'Loaded ' + state.loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '. ' : '',
      'Changes to housing happen in the home-search sheet or its Forms. ',
      h('a', { href: 'privacy.html' }, 'Privacy policy'));
    var t = state.toast ? h('div', { class: 'toast' + (state.toast.bad ? ' bad' : ''), role: 'status' }, state.toast.text) : null;
    return h('div', null, banner, top, h('main', null, content), foot, t);
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
