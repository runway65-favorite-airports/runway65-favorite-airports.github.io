/* Runway: read-only first version.
   - Signs in with Google (token flow, token kept in memory only).
   - Opens the one sheet the person picks (drive.file scope).
   - Shows Overview, Housing, Chronology and Documents from that sheet.
   Sheet text is always inserted as text (never as HTML). */
(function () {
  'use strict';

  var C = window.RUNWAY_CONFIG;
  var SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
  var STORE_KEY = 'runway.sheet'; // only the sheet's id and name; not secret
  var TABS = { listing: 'Home Listing', tours: 'Home Tour Notes', contacts: 'Contacts Log' };
  var DOCS_TAB = 'Documents & Links';
  var STATUS_ORDER = ['Active', 'To tour', 'Researching', 'Toured', 'Rejected', 'Purchased'];

  var state = {
    token: null, expires: 0, user: null, sheet: loadSheet(), role: null,
    data: null, loadedAt: null, busy: false, error: null,
    route: 'overview', filter: 'All', needSignIn: true
  };

  var app = document.getElementById('app');

  /* ---------- small helpers ---------- */
  function loadSheet() {
    try { var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return s && s.id ? s : null; }
    catch (e) { return null; }
  }
  function saveSheet(s) {
    try { if (s) localStorage.setItem(STORE_KEY, JSON.stringify({ id: s.id, name: s.name })); else localStorage.removeItem(STORE_KEY); }
    catch (e) { /* storage unavailable */ }
  }
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
    return values.slice(1).map(function (r, i) {
      var o = { _row: i + 2 };
      head.forEach(function (k, j) { if (k && o[k] === undefined) o[k] = r[j] == null ? '' : String(r[j]).trim(); });
      return o;
    }).filter(function (o) {
      return Object.keys(o).some(function (k) { return k !== '_row' && o[k] !== ''; });
    });
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
  function api(url) {
    return ensureToken().then(function () {
      return fetch(url, { headers: { Authorization: 'Bearer ' + state.token } });
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
  function pickSheet() {
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
          .setTitle('Choose the Retirement Home Listings sheet')
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
        id: id, builder: r['Builder'] || '', model: r['Model'] || '', community: r['Community'] || '', city: r['City'] || '',
        status: r['Status'] || 'Unknown', price: num(r['List Price']), upgrade: num(r['Upgrade Price']), sqft: num(r['Sq Ft']),
        visit: r['Visit Date'] || '', reason: r['Rejected Reason'] || '', url: r['Listing URL'] || '', address: r['Address'] || '',
        notes: r['Notes'] || '', contact: r['Contact'] || '', phone: r['Tel. #'] || '',
        tour: (tours[id] || [])[0] || null, contacts: contacts[id] || []
      };
    });
  }
  function homeName(x) { return (x.builder + (x.model ? ': ' + x.model : '')).trim() || x.id; }

  function loadAll() {
    state.busy = true; state.error = null; render();
    var id = state.sheet && encodeURIComponent(state.sheet.id);
    var p = Promise.resolve();
    if (!state.user) {
      p = api('https://www.googleapis.com/oauth2/v3/userinfo').then(function (u) { state.user = u; });
    }
    return p.then(function () {
      return api('https://www.googleapis.com/drive/v3/files/' + id + '?fields=name,capabilities(canEdit)&supportsAllDrives=true')
        .then(function (f) { state.sheet.name = f.name; state.role = f.capabilities && f.capabilities.canEdit ? 'editor' : 'viewer'; saveSheet(state.sheet); })
        .catch(function (e) { if (e.status === 404) throw e; state.role = 'unknown'; });
    }).then(function () {
      var ranges = Object.keys(TABS).map(function (k) { return 'ranges=' + encodeURIComponent("'" + TABS[k] + "'"); }).join('&');
      return api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values:batchGet?' + ranges + '&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE');
    }).then(function (j) {
      var keys = Object.keys(TABS), by = {};
      (j.valueRanges || []).forEach(function (vr, i) { by[keys[i]] = table(vr.values); });
      return api('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent("'" + DOCS_TAB + "'") + '?valueRenderOption=FORMATTED_VALUE')
        .then(function (d) { by.docs = table(d.values); })
        .catch(function () { by.docs = null; })
        .then(function () { return by; });
    }).then(function (by) {
      state.data = { homes: buildHomes(by), tours: by.tours || [], contacts: by.contacts || [], docs: by.docs };
      state.loadedAt = new Date();
    }).catch(function (e) { state.error = explain(e); })
      .then(function () { state.busy = false; render(); });
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
  function doPick() {
    pickSheet().then(function (s) {
      if (!s) return;
      state.sheet = s; state.data = null; saveSheet(s);
      return loadAll();
    }).catch(function (e) { state.error = explain(e); render(); });
  }
  function doSignOut() {
    var t = state.token;
    state.token = null; state.expires = 0; state.user = null; state.data = null; state.role = null; state.needSignIn = true; state.error = null;
    try { if (t && window.google && google.accounts) google.accounts.oauth2.revoke(t, function () {}); } catch (e) { /* ignore */ }
    render();
  }

  /* ---------- views ---------- */
  function tagFor(status) { return h('span', { class: 'tag' + (status === 'Active' ? ' active' : status === 'To tour' ? ' warn' : '') }, status); }

  function viewOverview() {
    var d = state.data, homes = d.homes;
    var target = new Date(C.RETIREMENT_DATE + 'T00:00:00Z');
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

    return h('div', { class: 'stack' },
      h('div', null, h('h1', null, 'Overview'), h('p', { class: 'lede' }, 'Where the road to retirement stands today.')),
      h('div', { class: 'row' },
        h('section', { class: 'card hero stack' },
          h('div', { class: 'small' }, 'Retirement from ATPCO'),
          h('div', { class: 'big' }, label),
          h('div', null, days > 0 ? 'About ' + months + (months === 1 ? ' month' : ' months') + ' to go (' + days + ' days)' : 'Your retirement date has arrived.')
        ),
        h('section', { class: 'card col stack' },
          h('h2', null, 'Housing at a glance'),
          h('div', { class: 'chips' }, statuses.map(function (s) {
            return h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: function () { state.filter = s; go('housing'); } }, s + ' (' + counts[s] + ')');
          })),
          homes.length ? null : h('p', { class: 'muted' }, 'No homes with a Home ID yet. Add IDs in the Home Listing tab.'),
          h('a', { class: 'btn ghost small', href: '#/housing', style: 'align-self:flex-start' }, 'See all homes')
        )
      ),
      h('div', { class: 'row' },
        h('section', { class: 'card col stack' },
          h('h2', null, 'Active candidates'),
          active.length ? h('ul', { class: 'list' }, active.map(function (x) {
            return h('li', null,
              h('div', { class: 'head', style: 'display:flex;justify-content:space-between;gap:12px' }, h('strong', null, homeName(x)), h('span', null, money(x.price))),
              h('div', { class: 'muted small' }, [x.community, x.city].filter(Boolean).join(', ')),
              h('div', { class: 'small' }, x.visit ? 'Toured ' + x.visit : 'Not toured yet'));
          })) : h('p', { class: 'muted' }, 'No homes marked Active.')
        ),
        h('section', { class: 'card col stack' },
          h('h2', null, 'Open follow-ups'),
          follow.length ? h('ul', { class: 'list' }, follow.map(function (c) {
            return h('li', null,
              h('strong', null, col(c, /^next action/i) || c['Subject'] || 'Follow up'),
              h('div', { class: 'muted small' }, [c['Builder'], c['Contact Name']].filter(Boolean).join(', ')),
              col(c, /^due date/i) ? h('div', { class: 'small' }, 'Due ' + col(c, /^due date/i)) : null);
          })) : h('p', { class: 'muted' }, 'No follow-ups marked Yes in the Contacts Log.'),
          toTour.length ? h('div', { class: 'stack' }, h('h3', null, 'Homes to tour'),
            h('ul', { class: 'list' }, toTour.map(function (x) { return h('li', null, homeName(x), h('span', { class: 'muted small' }, ' (' + [x.community, x.city].filter(Boolean).join(', ') + ')')); }))) : null
        )
      )
    );
  }

  function fact(label, value) {
    return value ? [h('dt', null, label), h('dd', null, value)] : null;
  }
  function homeCard(x) {
    var t = x.tour || {};
    var priceText = money(x.price) + (x.upgrade && x.upgrade !== x.price ? ' (' + money(x.upgrade) + ' with upgrades)' : '');
    return h('details', { class: 'home' },
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
        x.url ? h('a', { class: 'btn ghost small', href: x.url, target: '_blank', rel: 'noopener noreferrer', style: 'align-self:flex-start' }, 'Open listing') : null
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
    return h('div', { class: 'stack' },
      h('div', null, h('h1', null, 'Housing'), h('p', { class: 'lede' }, 'Every home in your listing sheet, joined with tour notes and builder contacts by Home ID.')),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by status' }, statuses.map(function (s) {
        return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.filter === s), onclick: function () { state.filter = s; render(); } }, s);
      })),
      shown.length ? h('div', { class: 'homes' }, shown.map(homeCard)) : h('p', { class: 'muted' }, 'No homes match this filter.')
    );
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
    var target = new Date(C.RETIREMENT_DATE + 'T00:00:00');
    ev.push({ date: target, tag: 'Milestone', title: 'Retirement from ATPCO begins', detail: '' });
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
    return h('div', { class: 'stack' },
      h('div', null, h('h1', null, 'Chronology'), h('p', { class: 'lede' }, 'The journey in order. Tours and builder contacts come from your sheet. More event types arrive as Runway grows.')),
      h('section', { class: 'card' }, h('div', { class: 'tl' }, rows))
    );
  }

  function viewDocuments() {
    var docs = state.data.docs;
    var head = h('div', null, h('h1', null, 'Documents'), h('p', { class: 'lede' }, 'Links and files, indexed from the Documents & Links tab. Runway lists them; the files stay in Drive.'));
    if (docs === null) return h('div', { class: 'stack' }, head, h('section', { class: 'card' }, h('p', null, 'Runway could not find a tab named "Documents & Links". Add it, then choose Refresh.')));
    if (!docs.length) return h('div', { class: 'stack' }, head, h('section', { class: 'card' }, h('p', null, 'No documents yet. Add a row in the Documents & Links tab.')));
    return h('div', { class: 'stack' }, head,
      h('section', { class: 'card scroll' }, h('table', null,
        h('thead', null, h('tr', null, ['Title', 'Workstream', 'Home', 'Owner', 'Review date', ''].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, docs.map(function (r) {
          var url = r['URL'] || (r['Drive file ID'] ? 'https://drive.google.com/open?id=' + encodeURIComponent(r['Drive file ID']) : '');
          return h('tr', null,
            h('td', null, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, r['Title'] || 'Untitled') : (r['Title'] || 'Untitled'), ' ',
              /sensitive/i.test(r['Sensitivity'] || '') ? h('span', { class: 'tag warn' }, 'Sensitive') : null),
            h('td', null, r['Workstream'] || ''), h('td', null, r['Home ID'] || ''), h('td', null, r['Owner'] || ''), h('td', null, r['Review date'] || ''), h('td', null, ''));
        })))));
  }

  /* ---------- shell ---------- */
  var ROUTES = { overview: ['Overview', viewOverview], housing: ['Housing', viewHousing], chronology: ['Chronology', viewChronology], documents: ['Documents', viewDocuments] };

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
      h('h1', null, 'One shared plan for the road to June 2027.'),
      h('p', { class: 'muted' }, 'Sign in with the Google account Steve shared Runway with. Runway reads only the sheet you choose.'),
      h('button', { class: 'btn', type: 'button', onclick: function () { doSignIn(''); } }, 'Continue with Google'),
      errorBox(),
      h('p', { class: 'muted small' }, 'Private. Invitation only.')));
  }
  function screenChoose() {
    return h('div', { class: 'center' }, h('div', { class: 'box' },
      h('div', { class: 'brand' }, logo(), 'Runway'),
      h('h1', null, 'Choose your sheet'),
      h('p', { class: 'muted' }, 'Pick the Retirement Home Listings sheet once. Runway remembers the choice on this device and can open only that file.'),
      h('button', { class: 'btn', type: 'button', onclick: doPick }, 'Choose sheet'),
      errorBox(),
      h('button', { class: 'btn ghost small', type: 'button', onclick: doSignOut }, 'Sign out')));
  }
  function screenLoading() {
    return h('div', { class: 'center' }, h('div', { class: 'spin', role: 'status', 'aria-label': 'Loading' }), h('p', { class: 'muted' }, 'Loading your sheet'));
  }

  function screenApp() {
    var name = (state.user && (state.user.given_name || state.user.email)) || 'you';
    var banner = null;
    if (state.role === 'viewer') {
      banner = h('div', { class: 'banner', role: 'status' }, h('div', { class: 'in' },
        h('strong', null, 'View only.'), h('span', null, 'You\'re signed in as ' + name + '. You can see everything in Runway. Only Steve and Kam can make changes.'),
        h('span', { class: 'pill' }, 'Role: viewer')));
    } else if (state.role === 'unknown') {
      banner = h('div', { class: 'banner', role: 'status' }, h('div', { class: 'in' },
        h('span', null, 'Runway could not confirm whether you can edit this sheet. This version is read-only either way.')));
    }
    var links = Object.keys(ROUTES).map(function (k) {
      return h('a', { href: '#/' + k, 'aria-current': state.route === k ? 'page' : null }, ROUTES[k][0]);
    });
    var top = h('header', { class: 'top' }, h('div', { class: 'in' },
      h('div', { class: 'brand' }, logo(), 'Runway'),
      h('nav', { 'aria-label': 'Main' }, links),
      h('div', { class: 'who' },
        state.user ? h('span', null, state.user.email) : null,
        state.role === 'editor' ? h('span', { class: 'pill' }, 'Role: editor') : null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: loadAll }, 'Refresh'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: doPick }, 'Change sheet'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: doSignOut }, 'Sign out'))));
    var content = state.error ? errorBox() : (state.data ? ROUTES[state.route][1]() : null);
    var foot = h('div', { class: 'foot' },
      state.loadedAt ? 'Loaded ' + state.loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '. ' : '',
      'This version is read-only. Make changes in the sheet or its Forms.',
      state.sheet && state.sheet.id ? [' ', h('a', { href: 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(state.sheet.id) + '/edit', target: '_blank', rel: 'noopener noreferrer' }, 'Open the sheet')] : null);
    return h('div', null, banner, top, h('main', null, content), foot);
  }

  function render() {
    readRoute();
    app.replaceChildren(
      state.needSignIn || !state.token && !state.data ? screenSignIn()
        : !state.sheet ? screenChoose()
        : state.busy && !state.data ? screenLoading()
        : screenApp()
    );
    document.title = (state.needSignIn ? 'Runway' : ROUTES[state.route][0] + ' | Runway');
  }

  window.addEventListener('hashchange', render);
  render();
})();
