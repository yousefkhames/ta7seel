/* Ta7seel — UI app. Renders views, owns state and localStorage. */
(function () {
  'use strict';

  var C = window.Ta7seelCore;
  var I = window.Ta7seelI18n;
  var STORE_KEY = 'ta7seel.v1';

  /* ---------- state ---------- */

  var DEFAULT_SETTINGS = {
    businessName: 'Ta7seel',
    logoEmoji: '💸',
    logoImage: null,
    accent: '#0f766e',
    currency: 'EGP',
    lang: 'ar',
    ladder: C.defaultLadder(),
    templates: JSON.parse(JSON.stringify(I.TEMPLATES))
  };

  var state = null;

  function freshState() {
    return {
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      clients: [],
      invoices: [],
      reminders: []
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) { state = freshState(); return; }
      var parsed = JSON.parse(raw);
      state = freshState();
      if (parsed.settings) {
        state.settings = Object.assign(state.settings, parsed.settings);
        // deep-merge templates so new keys survive old backups
        ['en', 'ar'].forEach(function (lng) {
          state.settings.templates[lng] = Object.assign(
            {}, I.TEMPLATES[lng], (parsed.settings.templates || {})[lng] || {});
        });
        if (!Array.isArray(state.settings.ladder) || !state.settings.ladder.length) {
          state.settings.ladder = C.defaultLadder();
        }
      }
      state.clients = Array.isArray(parsed.clients) ? parsed.clients : [];
      state.invoices = Array.isArray(parsed.invoices) ? parsed.invoices : [];
      state.reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
    } catch (e) {
      console.warn('state load failed', e);
      state = freshState();
    }
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function today() { return C.todayStr(); }

  /* ---------- i18n helpers ---------- */

  function lang() { return state.settings.lang; }
  function t(key, vars) { return I.t(lang(), key, vars); }
  function locale() { return lang() === 'ar' ? 'ar-EG' : 'en-GB'; }
  function money(n) { return C.fmtMoney(n, state.settings.currency, locale()); }
  function fdate(s, opts) { return C.fmtDate(s, locale(), opts); }

  /* ---------- dom helpers ---------- */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, root) { return (root || document).querySelector(sel); }

  function toast(msg) {
    var root = $('#toast-root');
    var node = el('div', 'toast', esc(msg));
    root.appendChild(node);
    setTimeout(function () { node.remove(); }, 2600);
  }

  /* ---------- lookups ---------- */

  function clientById(id) {
    for (var i = 0; i < state.clients.length; i++) if (state.clients[i].id === id) return state.clients[i];
    return null;
  }
  function invoiceById(id) {
    for (var i = 0; i < state.invoices.length; i++) if (state.invoices[i].id === id) return state.invoices[i];
    return null;
  }
  function clientStats(clientId) {
    var open = 0, overdue = 0, count = 0;
    state.invoices.forEach(function (inv) {
      if (inv.clientId !== clientId) return;
      count++;
      var st = C.invoiceStatus(inv, today());
      if (st === 'sent' || st === 'partial' || st === 'overdue') open += C.balance(inv);
      if (st === 'overdue') overdue += C.balance(inv);
    });
    return { open: C.round2(open), overdue: C.round2(overdue), count: count };
  }

  /* ---------- shell ---------- */

  var NAV = [
    { route: 'dashboard', icon: '📊', key: 'nav_dashboard' },
    { route: 'invoices', icon: '🧾', key: 'nav_invoices' },
    { route: 'clients', icon: '👥', key: 'nav_clients' },
    { route: 'reminders', icon: '⏰', key: 'nav_reminders' },
    { route: 'settings', icon: '⚙️', key: 'nav_settings' }
  ];

  function applyBrand() {
    var s = state.settings;
    document.documentElement.lang = s.lang;
    document.documentElement.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
    document.title = s.businessName + ' — ' + t('app_tagline');
    $('#brand-name').textContent = s.businessName;
    $('#brand-tagline').textContent = t('app_tagline');
    var logo = $('#brand-logo');
    logo.innerHTML = s.logoImage
      ? '<img src="' + s.logoImage + '" alt="">'
      : esc(s.logoEmoji || '💸');
    document.documentElement.style.setProperty('--accent', s.accent);
    document.documentElement.style.setProperty('--accent-600', s.accent);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', s.accent);
    $('#lang-toggle').textContent = s.lang === 'ar' ? 'EN' : 'عربي';
  }

  function buildNav() {
    var side = $('#side-nav'), bottom = $('#bottom-nav');
    side.innerHTML = ''; bottom.innerHTML = '';
    NAV.forEach(function (n) {
      var a = el('a', null, '<span class="ico">' + n.icon + '</span><span>' + t(n.key) + '</span>');
      a.href = '#/' + n.route; a.dataset.route = n.route;
      side.appendChild(a);
      var b = el('a', null, '<span class="ico">' + n.icon + '</span><span>' + t(n.key) + '</span>');
      b.href = '#/' + n.route; b.dataset.route = n.route;
      bottom.appendChild(b);
    });
  }

  function markActiveNav(route) {
    document.querySelectorAll('#side-nav a, #bottom-nav a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.route === route);
    });
  }

  /* ---------- routing ---------- */

  var ROUTES = {
    dashboard: { title: 'nav_dashboard', render: renderDashboard },
    invoices: { title: 'nav_invoices', render: renderInvoices },
    clients: { title: 'nav_clients', render: renderClients },
    reminders: { title: 'nav_reminders', render: renderReminders },
    settings: { title: 'nav_settings', render: renderSettings }
  };

  function route() {
    var hash = location.hash.replace(/^#\//, '') || 'dashboard';
    var name = hash.split('/')[0];
    var r = ROUTES[name] || ROUTES.dashboard;
    markActiveNav(ROUTES[name] ? name : 'dashboard');
    $('#page-title').textContent = t(r.title);
    var actions = $('#topbar-actions');
    actions.innerHTML = '';
    var langBtn = el('button', 'btn neutral small topbar-lang', lang() === 'ar' ? 'EN' : 'عربي');
    langBtn.type = 'button';
    langBtn.onclick = function () {
      state.settings.lang = lang() === 'ar' ? 'en' : 'ar';
      save(); applyBrand(); buildNav(); route();
    };
    actions.appendChild(langBtn);
    var view = $('#view');
    view.innerHTML = '';
    r.render(view, hash);
    closeDrawer();
    window.scrollTo(0, 0);
  }

  /* ---------- drawer & modal ---------- */

  function openDrawer(node) {
    var bd = $('#drawer-backdrop'), dr = $('#drawer');
    dr.innerHTML = '';
    dr.appendChild(node);
    bd.hidden = false; dr.hidden = false;
    requestAnimationFrame(function () { bd.classList.add('show'); });
  }
  function closeDrawer() {
    var bd = $('#drawer-backdrop'), dr = $('#drawer');
    bd.classList.remove('show');
    bd.hidden = true; dr.hidden = true;
    dr.innerHTML = '';
  }
  $('#drawer-backdrop').addEventListener('click', closeDrawer);

  function openModal(titleText, bodyNode, onSubmit, submitLabel) {
    var root = $('#modal-root');
    root.innerHTML = '';
    var backdrop = el('div', 'modal-backdrop');
    var modal = el('div', 'modal');
    var h = el('h2', null, esc(titleText));
    modal.appendChild(h);
    modal.appendChild(bodyNode);
    var actions = el('div', 'form-actions');
    var cancel = el('button', 'btn neutral', esc(t('cancel')));
    cancel.type = 'button';
    cancel.onclick = function () { root.innerHTML = ''; };
    actions.appendChild(cancel);
    if (onSubmit) {
      var ok = el('button', 'btn', esc(submitLabel || t('save')));
      ok.type = 'button';
      ok.onclick = function () { if (onSubmit() !== false) root.innerHTML = ''; };
      actions.appendChild(ok);
    }
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) root.innerHTML = ''; });
    root.appendChild(backdrop);
    var first = modal.querySelector('input, select, textarea');
    if (first) first.focus();
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }

  /* ================= DASHBOARD ================= */

  function renderDashboard(view) {
    var t0 = today();
    var k = C.kpis(state.invoices, t0);

    var grid = el('div', 'kpi-grid');
    grid.appendChild(kpiCard(t('kpi_outstanding'), money(k.outstanding),
      k.openCount + ' ' + t('open_invoices'), false));
    grid.appendChild(kpiCard(t('kpi_overdue'), money(k.overdue),
      k.overdueCount + ' ' + t('overdue_invoices'), k.overdue > 0));
    grid.appendChild(kpiCard(t('kpi_collected'), money(k.collectedThisMonth), '', false));
    grid.appendChild(kpiCard(t('kpi_avg_pay'),
      k.avgDaysToPay === null ? '—' : String(k.avgDaysToPay), '', false));
    view.appendChild(grid);

    // due reminders
    var due = dueReminders(t0);
    var remCard = el('div', 'card');
    remCard.appendChild(el('h3', null, '⏰ ' + esc(t('reminders_due_today')) +
      ' <span class="hint">' + esc(t('reminders_due_hint')) + '</span>'));
    if (!due.length) {
      remCard.appendChild(el('p', 'hint', esc(t('no_reminders_due'))));
    } else {
      due.slice(0, 3).forEach(function (d) { remCard.appendChild(todoItem(d)); });
      if (due.length > 3) {
        var more = el('a', 'btn soft small', esc(t('view_all') + ' (' + due.length + ')'));
        more.href = '#/reminders';
        remCard.appendChild(more);
      }
    }
    view.appendChild(remCard);

    var two = el('div', 'two-col');

    // aging
    var agingCard = el('div', 'card');
    agingCard.appendChild(el('h3', null, esc(t('aging_title'))));
    var rep = C.agingReport(state.invoices, t0);
    var max = 0;
    C.AGING_BUCKETS.forEach(function (b) { max = Math.max(max, rep[b].amount); });
    var bars = el('div', 'bars');
    var labels = { 'current': t('aging_current'), '1-7': t('aging_1_7'), '8-14': t('aging_8_14'), '15-30': t('aging_15_30'), '31+': t('aging_31') };
    C.AGING_BUCKETS.forEach(function (b) {
      var row = el('div', 'bar-row');
      row.appendChild(el('span', 'lbl', esc(labels[b])));
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill' + (b !== 'current' ? ' hot' : ''));
      fill.style.width = max > 0 ? Math.max(2, Math.round(rep[b].amount / max * 100)) + '%' : '0%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'amt', esc(money(rep[b].amount))));
      bars.appendChild(row);
    });
    agingCard.appendChild(bars);
    two.appendChild(agingCard);

    // trend
    var trendCard = el('div', 'card');
    trendCard.appendChild(el('h3', null, esc(t('collected_trend'))));
    var months = C.collectedByMonth(state.invoices, 6, t0);
    var mMax = Math.max.apply(null, months.map(function (m) { return m.total; }).concat([1]));
    var spark = el('div', 'spark');
    months.forEach(function (m) {
      var col = el('div', 'col');
      var bar = el('i');
      // pixel heights: percentage heights collapse in this grid context
      bar.style.height = Math.max(3, Math.round(m.total / mMax * 60)) + 'px';
      bar.title = money(m.total);
      col.appendChild(bar);
      var lbl = m.month.slice(5) + '/' + m.month.slice(2, 4);
      col.appendChild(el('span', null, esc(lbl)));
      spark.appendChild(col);
    });
    trendCard.appendChild(spark);
    two.appendChild(trendCard);

    view.appendChild(two);

    // activity
    var actCard = el('div', 'card');
    actCard.appendChild(el('h3', null, esc(t('recent_activity'))));
    var acts = recentActivity(8);
    if (!acts.length) actCard.appendChild(el('p', 'hint', esc(t('no_activity'))));
    else {
      var list = el('div', 'activity');
      acts.forEach(function (a) {
        var row = el('div', 'row');
        row.appendChild(el('span', 'dot', a.icon));
        var body = el('div', null, '<b>' + esc(a.title) + '</b><br><span class="hint">' + esc(a.sub) + '</span>');
        row.appendChild(body);
        row.appendChild(el('time', null, esc(fdate(a.date, { day: 'numeric', month: 'short' }))));
        list.appendChild(row);
      });
      actCard.appendChild(list);
    }
    view.appendChild(actCard);
  }

  function kpiCard(label, value, sub, warn) {
    var card = el('div', 'kpi' + (warn ? ' warn' : ''));
    card.appendChild(el('label', null, esc(label)));
    card.appendChild(el('div', 'val', esc(value)));
    if (sub) card.appendChild(el('small', null, esc(sub)));
    return card;
  }

  function dueReminders(t0) {
    var out = [];
    state.invoices.forEach(function (inv) {
      var lvl = C.nextReminder(inv, state.settings.ladder, state.reminders, t0);
      if (lvl) out.push({ invoice: inv, client: clientById(inv.clientId), level: lvl });
    });
    out.sort(function (a, b) { return b.level.offset - a.level.offset; });
    return out;
  }

  function todoItem(d) {
    var item = el('div', 'todo-item');
    var info = el('div', 'grow');
    info.appendChild(el('div', 'who', esc(d.client ? d.client.name : '—') + ' · ' + esc(d.invoice.number)));
    info.appendChild(el('div', 'what',
      esc(money(C.balance(d.invoice)) + ' · ' + dueLabel(d.invoice))));
    item.appendChild(info);
    item.appendChild(el('span', 'lvl', esc(t('lvl_' + d.level.id))));
    var actions = el('div', 'actions');
    var open = el('button', 'btn small soft', esc(t('preview')));
    open.onclick = function () { openInvoiceDrawer(d.invoice.id); };
    actions.appendChild(open);
    item.appendChild(actions);
    return item;
  }

  function dueLabel(inv) {
    var d = C.daysFromDue(inv, today());
    if (d > 0) return d === 1 ? t('days_over_1') : t('days_over', { n: d });
    if (d === 0) return t('due_today');
    if (d === -1) return t('due_in_1');
    return t('due_in', { n: -d });
  }

  function recentActivity(limit) {
    var acts = [];
    state.invoices.forEach(function (inv) {
      var cl = clientById(inv.clientId);
      if (inv.createdAt) acts.push({
        date: inv.createdAt.slice(0, 10), icon: '🧾',
        title: t('act_invoice') + ' ' + inv.number,
        sub: (cl ? cl.name : '') + ' · ' + money(inv.amount)
      });
      (inv.payments || []).forEach(function (p) {
        acts.push({
          date: p.date, icon: '💰',
          title: t('act_payment') + ' ' + money(p.amount),
          sub: inv.number + (cl ? ' · ' + cl.name : '')
        });
      });
    });
    state.reminders.forEach(function (r) {
      var inv = invoiceById(r.invoiceId);
      if (!inv) return;
      var cl = clientById(inv.clientId);
      acts.push({
        date: r.sentAt.slice(0, 10), icon: '📨',
        title: t('act_reminder') + ' · ' + t('lvl_' + r.levelId),
        sub: inv.number + (cl ? ' · ' + cl.name : '')
      });
    });
    acts.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return acts.slice(0, limit);
  }

  /* ================= INVOICES ================= */

  var invoiceFilter = { q: '', status: 'all' };

  function renderInvoices(view) {
    var bar = el('div', 'filter-bar');
    var searchWrap = el('div', 'search');
    var search = el('input');
    search.type = 'search';
    search.placeholder = t('search_invoices');
    search.value = invoiceFilter.q;
    search.oninput = function () { invoiceFilter.q = search.value; renderInvoiceTable(tableHost); };
    searchWrap.appendChild(search);
    bar.appendChild(searchWrap);
    var add = el('button', 'btn', '＋ ' + esc(t('add_invoice')));
    add.onclick = function () { openInvoiceForm(null); };
    bar.appendChild(add);
    view.appendChild(bar);

    var pills = el('div', 'pills');
    ['all', 'overdue', 'sent', 'partial', 'paid', 'draft'].forEach(function (st) {
      var p = el('button', 'pill' + (invoiceFilter.status === st ? ' active' : ''), esc(t('filter_' + st)));
      p.onclick = function () {
        invoiceFilter.status = st;
        pills.querySelectorAll('.pill').forEach(function (x) { x.classList.remove('active'); });
        p.classList.add('active');
        renderInvoiceTable(tableHost);
      };
      pills.appendChild(p);
    });
    view.appendChild(pills);

    var tableHost = el('div');
    view.appendChild(tableHost);
    renderInvoiceTable(tableHost);
  }

  function renderInvoiceTable(host) {
    host.innerHTML = '';
    var t0 = today();
    var q = invoiceFilter.q.trim().toLowerCase();
    var rows = state.invoices.filter(function (inv) {
      var st = C.invoiceStatus(inv, t0);
      if (invoiceFilter.status !== 'all' && st !== invoiceFilter.status) return false;
      if (!q) return true;
      var cl = clientById(inv.clientId);
      return (inv.number + ' ' + (inv.description || '') + ' ' + (cl ? cl.name : '')).toLowerCase().indexOf(q) !== -1;
    });
    rows.sort(function (a, b) { return a.dueDate < b.dueDate ? 1 : -1; });

    if (!rows.length) {
      var e = el('div', 'empty', '<span class="big">🧾</span><p>' + esc(t('no_invoices')) + '</p>');
      var btn = el('button', 'btn', esc(t('empty_state_cta')));
      btn.onclick = function () { openInvoiceForm(null); };
      e.appendChild(btn);
      host.appendChild(e);
      return;
    }

    var wrap = el('div', 'table-wrap');
    var table = el('table');
    table.innerHTML = '<thead><tr>' +
      '<th>' + esc(t('th_invoice')) + '</th>' +
      '<th>' + esc(t('th_client')) + '</th>' +
      '<th>' + esc(t('th_due')) + '</th>' +
      '<th class="num">' + esc(t('th_amount')) + '</th>' +
      '<th class="num">' + esc(t('th_balance')) + '</th>' +
      '<th>' + esc(t('th_status')) + '</th></tr></thead>';
    var tbody = el('tbody');
    rows.forEach(function (inv) {
      var st = C.invoiceStatus(inv, t0);
      var cl = clientById(inv.clientId);
      var tr = el('tr');
      tr.appendChild(el('td', null, '<span class="mono">' + esc(inv.number) + '</span>' +
        (inv.description ? '<span class="sub">' + esc(inv.description) + '</span>' : '')));
      tr.appendChild(el('td', null, esc(cl ? cl.name : '—')));
      tr.appendChild(el('td', null, esc(fdate(inv.dueDate)) + '<span class="sub">' + esc(dueLabel(inv)) + '</span>'));
      tr.appendChild(el('td', 'num', esc(money(inv.amount))));
      tr.appendChild(el('td', 'num', esc(money(C.balance(inv)))));
      var chip = el('span', 'chip ' + st, esc(t('st_' + st)));
      var td = el('td'); td.appendChild(chip);
      tr.appendChild(td);
      tr.onclick = function () { openInvoiceDrawer(inv.id); };
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* ---------- invoice form ---------- */

  function openInvoiceForm(existing) {
    if (!state.clients.length) {
      openClientForm(null, function () { openInvoiceForm(existing); });
      return;
    }
    var inv = existing || {
      number: C.nextInvoiceNumber(state.invoices),
      clientId: state.clients[0].id,
      description: '',
      amount: '',
      issueDate: today(),
      dueDate: C.addDays(today(), 14),
      baseStatus: 'sent',
      payments: []
    };
    var body = el('div');

    function field(labelText, input, errKey) {
      var f = el('div', 'field');
      f.appendChild(el('label', null, esc(labelText)));
      f.appendChild(input);
      var err = el('span', 'err');
      err.style.display = 'none';
      f.appendChild(err);
      f.dataset.err = errKey;
      return f;
    }

    var numIn = el('input'); numIn.value = inv.number;
    var clientSel = el('select');
    state.clients.forEach(function (c) {
      var o = el('option', null, esc(c.name)); o.value = c.id;
      clientSel.appendChild(o);
    });
    clientSel.value = inv.clientId;
    var descIn = el('input'); descIn.value = inv.description || '';
    var amtIn = el('input'); amtIn.type = 'number'; amtIn.min = '0'; amtIn.step = '0.01'; amtIn.value = inv.amount;
    var issueIn = el('input'); issueIn.type = 'date'; issueIn.value = inv.issueDate;
    var dueIn = el('input'); dueIn.type = 'date'; dueIn.value = inv.dueDate;

    body.appendChild(field(t('inv_number'), numIn, 'number'));
    body.appendChild(field(t('inv_client'), clientSel, 'client'));
    body.appendChild(field(t('inv_description'), descIn, 'description'));
    body.appendChild(field(t('inv_amount') + ' (' + state.settings.currency + ')', amtIn, 'amount'));
    var row = el('div', 'form-row');
    row.appendChild(field(t('inv_issue'), issueIn, 'issueDate'));
    row.appendChild(field(t('inv_due'), dueIn, 'dueDate'));
    body.appendChild(row);

    openModal(existing ? t('edit_invoice') : t('add_invoice'), body, function () {
      var data = {
        clientId: clientSel.value,
        amount: parseFloat(amtIn.value),
        issueDate: issueIn.value,
        dueDate: dueIn.value
      };
      var errs = C.validateInvoice(data);
      if (errs.length) {
        body.querySelectorAll('.field').forEach(function (f) {
          var bad = errs.indexOf(f.dataset.err) !== -1 ||
            (f.dataset.err === 'dueDate' && errs.indexOf('dueBeforeIssue') !== -1);
          f.classList.toggle('invalid', bad);
          var errNode = f.querySelector('.err');
          if (bad) {
            errNode.style.display = 'block';
            errNode.textContent = errs.indexOf('dueBeforeIssue') !== -1 && f.dataset.err === 'dueDate'
              ? t('err_due_before_issue')
              : t('err_' + (f.dataset.err === 'amount' ? 'amount' : f.dataset.err === 'client' ? 'client' : 'dates'));
          } else errNode.style.display = 'none';
        });
        toast(t('form_errors'));
        return false;
      }
      if (existing) {
        existing.number = numIn.value.trim() || existing.number;
        existing.clientId = data.clientId;
        existing.description = descIn.value.trim();
        existing.amount = data.amount;
        existing.issueDate = data.issueDate;
        existing.dueDate = data.dueDate;
      } else {
        state.invoices.push({
          id: C.uid('inv'),
          number: numIn.value.trim() || inv.number,
          clientId: data.clientId,
          description: descIn.value.trim(),
          amount: data.amount,
          issueDate: data.issueDate,
          dueDate: data.dueDate,
          baseStatus: 'sent',
          payments: [],
          createdAt: new Date().toISOString()
        });
      }
      save();
      toast(t('saved_toast'));
      route();
    });
  }

  /* ---------- invoice drawer ---------- */

  function openInvoiceDrawer(invId) {
    var inv = invoiceById(invId);
    if (!inv) return;
    var t0 = today();
    var cl = clientById(inv.clientId);
    var st = C.invoiceStatus(inv, t0);

    var node = el('div');

    var head = el('div', 'drawer-head');
    var h = el('h2', null, esc(inv.number));
    head.appendChild(h);
    var close = el('button', 'icon-btn', '✕');
    close.onclick = closeDrawer;
    head.appendChild(close);
    node.appendChild(head);

    var dh = el('div', 'detail-head');
    var grow = el('div', 'grow');
    grow.appendChild(el('div', 'num', esc(cl ? cl.name : '—')));
    grow.appendChild(el('span', 'hint', esc(inv.description || '')));
    dh.appendChild(grow);
    dh.appendChild(el('span', 'chip ' + st, esc(t('st_' + st))));
    node.appendChild(dh);

    if (st === 'draft') {
      node.appendChild(el('p', 'hint', esc(t('draft_hint'))));
    }

    var amounts = el('div', 'card');
    var line = el('div', 'amount-line');
    line.appendChild(el('span', null, esc(t('th_amount')) + '<b>' + esc(money(inv.amount)) + '</b>'));
    line.appendChild(el('span', null, esc(t('total_collected')) + '<b>' + esc(money(C.paidTotal(inv))) + '</b>'));
    line.appendChild(el('span', null, esc(t('th_balance')) + '<b>' + esc(money(C.balance(inv))) + '</b>'));
    amounts.appendChild(line);
    var dates = el('div', 'amount-line');
    dates.style.marginTop = '10px';
    dates.appendChild(el('span', null, esc(t('inv_issue')) + '<b>' + esc(fdate(inv.issueDate)) + '</b>'));
    dates.appendChild(el('span', null, esc(t('inv_due')) + '<b>' + esc(fdate(inv.dueDate)) + '</b>'));
    dates.appendChild(el('span', null, '<b>' + esc(dueLabel(inv)) + '</b>'));
    amounts.appendChild(dates);
    node.appendChild(amounts);

    // reminder engine
    var rem = el('div', 'card');
    rem.appendChild(el('h3', null, '⏰ ' + esc(t('drawer_reminder_title'))));
    var ladder = state.settings.ladder;
    var mini = el('div', 'ladder-mini');
    var nextLvl = C.nextReminder(inv, ladder, state.reminders, t0);
    var reached = C.dueReminderLevel(inv, ladder, t0);
    ladder.forEach(function (lv) {
      var seg = el('i');
      if (lv.enabled) {
        var wasSent = state.reminders.some(function (r) {
          if (r.invoiceId !== inv.id) return false;
          var l = C.ladderLevel(ladder, r.levelId);
          return l && l.offset >= lv.offset;
        });
        if (wasSent) seg.className = 'done';
        else if (nextLvl && nextLvl.id === lv.id) seg.className = 'now';
      }
      seg.title = t('lvl_' + lv.id);
      mini.appendChild(seg);
    });
    rem.appendChild(mini);

    if (nextLvl) {
      rem.appendChild(el('p', 'hint', esc(t('next_reminder') + ': ' + t('lvl_' + nextLvl.id) + ' (' + t('lvl_' + nextLvl.id + '_when') + ')')));
      var msg = C.renderReminder(inv, cl, state.settings, nextLvl.id, t0);
      var msgBox = el('div', 'msg', esc(msg));
      msgBox.style.cssText = 'background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:11px 13px;font-size:.83rem;white-space:pre-wrap;line-height:1.7;margin-block:8px';
      rem.appendChild(msgBox);
      var rActions = el('div', 'actions');
      rActions.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap';
      var copy = el('button', 'btn small neutral', '📋 ' + esc(t('send_copy')));
      copy.onclick = function () { copyText(msg); };
      rActions.appendChild(copy);
      var waUrl = cl && C.whatsappLink(cl.phone, msg);
      if (waUrl) {
        var wa = el('a', 'btn small soft', '🟢 ' + esc(t('send_whatsapp')));
        wa.href = waUrl; wa.target = '_blank'; wa.rel = 'noopener';
        wa.onclick = function () { logReminder(inv, nextLvl, 'whatsapp'); };
        rActions.appendChild(wa);
      }
      var mark = el('button', 'btn small', '✓ ' + esc(t('mark_as_sent')));
      mark.onclick = function () {
        logReminder(inv, nextLvl, 'manual');
        openInvoiceDrawer(inv.id);
      };
      rActions.appendChild(mark);
      rem.appendChild(rActions);
    } else {
      rem.appendChild(el('p', 'hint', esc(st === 'paid' ? t('all_caught_up') : t('reminder_none'))));
    }
    node.appendChild(rem);

    // payments
    var pay = el('div', 'card');
    pay.appendChild(el('h3', null, '💰 ' + esc(t('payments_title'))));
    if (!inv.payments.length) pay.appendChild(el('p', 'hint', esc(t('no_payments'))));
    inv.payments.slice().reverse().forEach(function (p) {
      var row = el('div', 'pay-row');
      row.appendChild(el('span', 'grow', '<b>' + esc(money(p.amount)) + '</b> · ' + esc(t('method_' + (p.method || 'other'))) + (p.note ? ' · ' + esc(p.note) : '')));
      row.appendChild(el('time', null, esc(fdate(p.date))));
      var del = el('button', 'icon-btn', '🗑');
      del.title = t('delete');
      del.onclick = function () {
        inv.payments = inv.payments.filter(function (x) { return x.id !== p.id; });
        save(); openInvoiceDrawer(inv.id); routeSoft();
      };
      row.appendChild(del);
      pay.appendChild(row);
    });
    if (st !== 'paid' && st !== 'draft') {
      var addPay = el('button', 'btn small', '＋ ' + esc(t('record_payment')));
      addPay.style.marginTop = '10px';
      addPay.onclick = function () { openPaymentForm(inv); };
      pay.appendChild(addPay);
    }
    node.appendChild(pay);

    // log
    var logCard = el('div', 'card');
    logCard.appendChild(el('h3', null, '📨 ' + esc(t('reminder_history'))));
    var logs = state.reminders.filter(function (r) { return r.invoiceId === inv.id; });
    if (!logs.length) logCard.appendChild(el('p', 'hint', esc(t('no_reminders'))));
    logs.slice().reverse().forEach(function (r) {
      var row = el('div', 'log-row');
      row.appendChild(el('span', 'grow', esc(t('lvl_' + r.levelId) + ' · ' + t('sent_via') + ' ' + r.channel)));
      row.appendChild(el('time', null, esc(fdate(r.sentAt.slice(0, 10)))));
      logCard.appendChild(row);
    });
    node.appendChild(logCard);

    // actions
    var acts = el('div', 'form-actions no-print');
    acts.style.justifyContent = 'flex-start';
    var edit = el('button', 'btn neutral small', '✏️ ' + esc(t('edit')));
    edit.onclick = function () { openInvoiceForm(inv); };
    acts.appendChild(edit);
    if (st === 'draft') {
      var send = el('button', 'btn soft small', esc(t('mark_sent')));
      send.onclick = function () { inv.baseStatus = 'sent'; save(); openInvoiceDrawer(inv.id); routeSoft(); };
      acts.appendChild(send);
    }
    if (st !== 'paid' && st !== 'draft') {
      var full = el('button', 'btn soft small', esc(t('mark_paid_full')));
      full.onclick = function () {
        inv.payments.push({ id: C.uid('pay'), date: today(), amount: C.balance(inv), method: 'other', note: '' });
        save(); toast(t('payment_added')); openInvoiceDrawer(inv.id); routeSoft();
      };
      acts.appendChild(full);
    }
    var pr = el('button', 'btn neutral small', '🖨 ' + esc(t('print_invoice')));
    pr.onclick = function () { window.print(); };
    acts.appendChild(pr);
    var del = el('button', 'btn danger small', esc(t('delete')));
    del.onclick = function () {
      if (!confirm(t('confirm_delete_invoice'))) return;
      state.invoices = state.invoices.filter(function (x) { return x.id !== inv.id; });
      state.reminders = state.reminders.filter(function (r) { return r.invoiceId !== inv.id; });
      save(); toast(t('deleted_toast')); closeDrawer(); route();
    };
    acts.appendChild(del);
    node.appendChild(acts);

    openDrawer(node);
  }

  function routeSoft() {
    // re-render current view without closing the drawer
    var hash = location.hash.replace(/^#\//, '') || 'dashboard';
    var name = hash.split('/')[0];
    var r = ROUTES[name] || ROUTES.dashboard;
    var view = $('#view');
    view.innerHTML = '';
    r.render(view, hash);
  }

  function logReminder(inv, level, channel) {
    state.reminders.push({
      id: C.uid('rem'),
      invoiceId: inv.id,
      levelId: level.id,
      channel: channel,
      sentAt: new Date().toISOString()
    });
    save();
    toast(t('reminder_logged'));
    routeSoft();
  }

  function copyText(text) {
    function done() { toast(t('copied_toast')); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
    } else { legacyCopy(text); done(); }
  }
  function legacyCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  function openPaymentForm(inv) {
    var body = el('div');
    function field(labelText, input) {
      var f = el('div', 'field');
      f.appendChild(el('label', null, esc(labelText)));
      f.appendChild(input);
      return f;
    }
    var amt = el('input'); amt.type = 'number'; amt.min = '0'; amt.step = '0.01'; amt.value = C.balance(inv);
    var date = el('input'); date.type = 'date'; date.value = today();
    var method = el('select');
    ['cash', 'transfer', 'wallet', 'card', 'other'].forEach(function (m) {
      var o = el('option', null, t('method_' + m)); o.value = m;
      method.appendChild(o);
    });
    method.value = 'transfer';
    var note = el('input');
    body.appendChild(field(t('payment_amount') + ' (' + state.settings.currency + ')', amt));
    body.appendChild(field(t('payment_date'), date));
    body.appendChild(field(t('payment_method'), method));
    body.appendChild(field(t('payment_note'), note));
    var bal = C.balance(inv);
    var fullBtn = el('button', 'btn small soft', esc(t('pay_full') + ': ' + money(bal)));
    fullBtn.style.marginBottom = '10px';
    fullBtn.onclick = function () { amt.value = bal; };
    body.insertBefore(fullBtn, body.firstChild);

    openModal(t('record_payment'), body, function () {
      var amount = parseFloat(amt.value);
      if (!(amount > 0)) { toast(t('err_amount')); return false; }
      inv.payments.push({
        id: C.uid('pay'),
        date: date.value || today(),
        amount: C.round2(amount),
        method: method.value,
        note: note.value.trim()
      });
      save();
      toast(t('payment_added'));
      openInvoiceDrawer(inv.id);
      routeSoft();
    });
  }

  /* ================= CLIENTS ================= */

  function renderClients(view) {
    var bar = el('div', 'filter-bar');
    var searchWrap = el('div', 'search');
    var search = el('input');
    search.type = 'search';
    search.placeholder = t('search_clients');
    search.oninput = function () { draw(grid, search.value); };
    searchWrap.appendChild(search);
    bar.appendChild(searchWrap);
    var add = el('button', 'btn', '＋ ' + esc(t('add_client')));
    add.onclick = function () { openClientForm(null); };
    bar.appendChild(add);
    view.appendChild(bar);

    var grid = el('div', 'client-grid');
    view.appendChild(grid);
    draw(grid, '');

    function draw(host, q) {
      host.innerHTML = '';
      var needle = q.trim().toLowerCase();
      var list = state.clients.filter(function (c) {
        if (!needle) return true;
        return (c.name + ' ' + (c.company || '') + ' ' + (c.email || '')).toLowerCase().indexOf(needle) !== -1;
      });
      if (!list.length) {
        var e = el('div', 'empty', '<span class="big">👥</span><p>' + esc(t('no_clients')) + '</p>');
        var b = el('button', 'btn', esc(t('empty_state_cta')));
        b.onclick = function () { openClientForm(null); };
        e.appendChild(b);
        host.appendChild(e);
        return;
      }
      list.forEach(function (c) {
        var s = clientStats(c.id);
        var card = el('div', 'client-card');
        card.appendChild(el('div', 'avatar', esc(initials(c.name))));
        card.appendChild(el('h4', null, esc(c.name)));
        card.appendChild(el('div', 'meta', esc([c.company, c.phone].filter(Boolean).join(' · ')) || '&nbsp;'));
        var stats = el('div', 'stats');
        stats.appendChild(el('span', null, esc(t('invoices_n', { n: s.count })) + '<b>' + s.count + '</b>'));
        stats.appendChild(el('span', null, esc(t('client_open_balance')) + '<b>' + esc(money(s.open)) + '</b>'));
        if (s.overdue > 0) stats.appendChild(el('span', null, esc(t('client_overdue')) + '<b style="color:var(--bad)">' + esc(money(s.overdue)) + '</b>'));
        card.appendChild(stats);
        card.onclick = function () { openClientDrawer(c.id); };
        host.appendChild(card);
      });
    }
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return (parts[0][0] || '?') + (parts.length > 1 ? parts[1][0] : '');
  }

  function openClientForm(existing, afterSave) {
    var c = existing || { name: '', company: '', phone: '', email: '', notes: '' };
    var body = el('div');
    function field(labelText, input) {
      var f = el('div', 'field');
      f.appendChild(el('label', null, esc(labelText)));
      f.appendChild(input);
      return f;
    }
    var name = el('input'); name.value = c.name;
    var company = el('input'); company.value = c.company || '';
    var phone = el('input'); phone.value = c.phone || ''; phone.dir = 'ltr'; phone.placeholder = '+2010…';
    var email = el('input'); email.type = 'email'; email.value = c.email || ''; email.dir = 'ltr';
    var notes = el('textarea'); notes.value = c.notes || ''; notes.rows = 2;
    body.appendChild(field(t('name'), name));
    body.appendChild(field(t('company'), company));
    body.appendChild(field(t('phone') + ' (WhatsApp)', phone));
    body.appendChild(field(t('email'), email));
    body.appendChild(field(t('notes'), notes));

    openModal(existing ? t('edit_client') : t('add_client'), body, function () {
      if (!name.value.trim()) { toast(t('err_client')); name.focus(); return false; }
      if (existing) {
        existing.name = name.value.trim();
        existing.company = company.value.trim();
        existing.phone = phone.value.trim();
        existing.email = email.value.trim();
        existing.notes = notes.value.trim();
      } else {
        state.clients.push({
          id: C.uid('cli'),
          name: name.value.trim(),
          company: company.value.trim(),
          phone: phone.value.trim(),
          email: email.value.trim(),
          notes: notes.value.trim(),
          createdAt: new Date().toISOString()
        });
      }
      save();
      toast(t('saved_toast'));
      route();
      if (afterSave) afterSave();
    });
  }

  function openClientDrawer(clientId) {
    var c = clientById(clientId);
    if (!c) return;
    var t0 = today();
    var node = el('div');
    var head = el('div', 'drawer-head');
    head.appendChild(el('h2', null, esc(c.name)));
    var close = el('button', 'icon-btn', '✕');
    close.onclick = closeDrawer;
    head.appendChild(close);
    node.appendChild(head);

    var meta = el('div', 'card');
    meta.appendChild(el('p', null, '<b>' + esc(c.company || '') + '</b>'));
    if (c.phone) meta.appendChild(el('p', 'hint', esc('📞 ' + c.phone)));
    if (c.email) meta.appendChild(el('p', 'hint', esc('✉️ ' + c.email)));
    if (c.notes) meta.appendChild(el('p', 'hint', esc(c.notes)));
    node.appendChild(meta);

    var s = clientStats(c.id);
    var sums = el('div', 'card');
    var line = el('div', 'amount-line');
    var billed = 0, collected = 0;
    state.invoices.forEach(function (inv) {
      if (inv.clientId !== c.id) return;
      billed += +inv.amount || 0;
      collected += C.paidTotal(inv);
    });
    line.appendChild(el('span', null, esc(t('total_billed')) + '<b>' + esc(money(billed)) + '</b>'));
    line.appendChild(el('span', null, esc(t('total_collected')) + '<b>' + esc(money(collected)) + '</b>'));
    line.appendChild(el('span', null, esc(t('total_open')) + '<b>' + esc(money(s.open)) + '</b>'));
    sums.appendChild(line);
    node.appendChild(sums);

    var listCard = el('div', 'card');
    listCard.appendChild(el('h3', null, esc(t('invoices_title'))));
    var invs = state.invoices.filter(function (inv) { return inv.clientId === c.id; });
    if (!invs.length) listCard.appendChild(el('p', 'hint', esc(t('no_invoices'))));
    invs.forEach(function (inv) {
      var st = C.invoiceStatus(inv, t0);
      var row = el('div', 'pay-row');
      row.style.cursor = 'pointer';
      row.appendChild(el('span', 'grow', '<b>' + esc(inv.number) + '</b> · ' + esc(money(C.balance(inv)))));
      var chip = el('span', 'chip ' + st, esc(t('st_' + st)));
      row.appendChild(chip);
      row.onclick = function () { openInvoiceDrawer(inv.id); };
      listCard.appendChild(row);
    });
    node.appendChild(listCard);

    var acts = el('div', 'form-actions');
    acts.style.justifyContent = 'flex-start';
    var edit = el('button', 'btn neutral small', '✏️ ' + esc(t('edit')));
    edit.onclick = function () { openClientForm(c); };
    acts.appendChild(edit);
    var newInv = el('button', 'btn soft small', '＋ ' + esc(t('add_invoice')));
    newInv.onclick = function () { openInvoiceForm(null); };
    acts.appendChild(newInv);
    var del = el('button', 'btn danger small', esc(t('delete')));
    del.onclick = function () {
      if (!confirm(t('confirm_delete_client'))) return;
      state.clients = state.clients.filter(function (x) { return x.id !== c.id; });
      save(); toast(t('deleted_toast')); closeDrawer(); route();
    };
    acts.appendChild(del);
    node.appendChild(acts);

    openDrawer(node);
  }

  /* ================= REMINDER CENTER ================= */

  function renderReminders(view) {
    var t0 = today();
    var due = dueReminders(t0);

    var headCard = el('div', 'card');
    headCard.appendChild(el('h3', null, '⏰ ' + esc(t('reminders_due_today')) + ' (' + due.length + ')'));
    if (!due.length) headCard.appendChild(el('p', 'hint', esc(t('no_reminders_due'))));
    view.appendChild(headCard);

    due.forEach(function (d) {
      var card = el('div', 'rem-card');
      var top = el('div', 'top');
      top.appendChild(el('span', 'lvl', esc(t('lvl_' + d.level.id))));
      var grow = el('div', 'grow');
      grow.appendChild(el('div', 'who', esc(d.client ? d.client.name : '—') + ' · ' + esc(d.invoice.number)));
      grow.appendChild(el('div', 'what hint', esc(money(C.balance(d.invoice)) + ' · ' + dueLabel(d.invoice))));
      top.appendChild(grow);
      card.appendChild(top);
      var msg = C.renderReminder(d.invoice, d.client, state.settings, d.level.id, t0);
      card.appendChild(el('div', 'msg', esc(msg)));
      var actions = el('div', 'actions');
      var copy = el('button', 'btn small neutral', '📋 ' + esc(t('send_copy')));
      copy.onclick = function () { copyText(msg); };
      actions.appendChild(copy);
      var waUrl = d.client && C.whatsappLink(d.client.phone, msg);
      if (waUrl) {
        var wa = el('a', 'btn small soft', '🟢 ' + esc(t('send_whatsapp')));
        wa.href = waUrl; wa.target = '_blank'; wa.rel = 'noopener';
        wa.onclick = function () { logReminder(d.invoice, d.level, 'whatsapp'); };
        actions.appendChild(wa);
      }
      var mark = el('button', 'btn small', '✓ ' + esc(t('mark_as_sent')));
      mark.onclick = function () {
        logReminder(d.invoice, d.level, 'manual');
        route();
      };
      actions.appendChild(mark);
      var open = el('button', 'btn small neutral', esc(t('preview')));
      open.onclick = function () { openInvoiceDrawer(d.invoice.id); };
      actions.appendChild(open);
      card.appendChild(actions);
      view.appendChild(card);
    });

    // upcoming: earliest future reminder per invoice
    var upcoming = [];
    state.invoices.forEach(function (inv) {
      if (!C.isOpen(inv, t0)) return;
      var current = C.nextReminder(inv, state.settings.ladder, state.reminders, t0);
      if (current) return; // already actionable
      var best = null;
      state.settings.ladder.forEach(function (lv) {
        if (!lv.enabled) return;
        var rd = C.reminderDate(inv, lv);
        if (!rd) return;
        var sent = state.reminders.some(function (r) { return r.invoiceId === inv.id && r.levelId === lv.id; });
        if (sent) return;
        var inDays = C.diffDays(t0, rd);
        if (inDays > 0 && inDays <= 7 && (!best || rd < best.date)) {
          best = { invoice: inv, client: clientById(inv.clientId), level: lv, date: rd, inDays: inDays };
        }
      });
      if (best) upcoming.push(best);
    });
    upcoming.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (upcoming.length) {
      var up = el('div', 'card');
      up.appendChild(el('h3', null, '🗓 ' + esc(lang() === 'ar' ? 'قادم خلال ٧ أيام' : 'Coming up in 7 days')));
      upcoming.forEach(function (u) {
        var row = el('div', 'pay-row');
        row.appendChild(el('span', 'grow', '<b>' + esc(u.client ? u.client.name : '—') + '</b> · ' + esc(u.invoice.number) + ' · ' + esc(t('lvl_' + u.level.id))));
        row.appendChild(el('time', null, esc(fdate(u.date))));
        up.appendChild(row);
      });
      view.appendChild(up);
    }
  }

  /* ================= SETTINGS ================= */

  var SWATCHES = ['#0f766e', '#1d4ed8', '#7c3aed', '#be185d', '#b45309', '#15803d', '#0f172a', '#dc2626'];

  function renderSettings(view) {
    var s = state.settings;
    var grid = el('div', 'settings-grid');

    /* --- brand --- */
    var brand = el('div', 'card');
    brand.appendChild(el('h3', null, '🎨 ' + esc(t('settings_brand'))));
    brand.appendChild(el('p', 'hint', esc(t('settings_brand_hint'))));
    brand.appendChild(el('div', null, '&nbsp;'));

    var nameF = el('div', 'field');
    nameF.appendChild(el('label', null, esc(t('business_name'))));
    var nameIn = el('input'); nameIn.value = s.businessName;
    nameIn.onchange = function () { s.businessName = nameIn.value.trim() || 'Ta7seel'; save(); applyBrand(); };
    nameF.appendChild(nameIn);
    brand.appendChild(nameF);

    var logoF = el('div', 'field');
    logoF.appendChild(el('label', null, esc(t('logo_emoji'))));
    var emojiRow = el('div', 'swatch-row');
    ['💸', '🧾', '💰', '🏦', '📮', '🐪', '⚡', '🤝'].forEach(function (em) {
      var b = el('button', 'swatch' + (s.logoEmoji === em && !s.logoImage ? ' active' : ''), em);
      b.style.fontSize = '1.1rem';
      b.onclick = function () {
        s.logoEmoji = em; s.logoImage = null; save(); applyBrand();
        emojiRow.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      };
      emojiRow.appendChild(b);
    });
    logoF.appendChild(emojiRow);
    var upload = el('input'); upload.type = 'file'; upload.accept = 'image/*';
    upload.style.marginTop = '8px';
    upload.onchange = function () {
      var f = upload.files[0];
      if (!f) return;
      if (f.size > 300 * 1024) { toast(lang() === 'ar' ? 'الصورة كبيرة (الحد 300KB)' : 'Image too large (300KB max)'); return; }
      var rd = new FileReader();
      rd.onload = function () { s.logoImage = rd.result; save(); applyBrand(); toast(t('saved_toast')); };
      rd.readAsDataURL(f);
    };
    var upLabel = el('label', 'hint', esc(t('logo_image')));
    logoF.appendChild(upLabel);
    logoF.appendChild(upload);
    brand.appendChild(logoF);

    var accF = el('div', 'field');
    accF.appendChild(el('label', null, esc(t('accent_color'))));
    var swRow = el('div', 'swatch-row');
    SWATCHES.forEach(function (hex) {
      var b = el('button', 'swatch' + (s.accent === hex ? ' active' : ''));
      b.style.background = hex;
      b.onclick = function () {
        s.accent = hex; save(); applyBrand();
        swRow.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      };
      swRow.appendChild(b);
    });
    var custom = el('input'); custom.type = 'color'; custom.value = s.accent;
    custom.style.cssText = 'width:34px;height:34px;border:none;background:none;padding:0';
    custom.onchange = function () { s.accent = custom.value; save(); applyBrand(); };
    swRow.appendChild(custom);
    accF.appendChild(swRow);
    brand.appendChild(accF);

    var row = el('div', 'form-row');
    var curF = el('div', 'field');
    curF.appendChild(el('label', null, esc(t('currency'))));
    var curSel = el('select');
    I.CURRENCIES.forEach(function (c) {
      var o = el('option', null, c); o.value = c;
      curSel.appendChild(o);
    });
    curSel.value = s.currency;
    curSel.onchange = function () { s.currency = curSel.value; save(); toast(t('saved_toast')); };
    curF.appendChild(curSel);
    row.appendChild(curF);
    var langF = el('div', 'field');
    langF.appendChild(el('label', null, esc(t('language'))));
    var langSel = el('select');
    langSel.innerHTML = '<option value="ar">العربية</option><option value="en">English</option>';
    langSel.value = s.lang;
    langSel.onchange = function () { s.lang = langSel.value; save(); applyBrand(); buildNav(); route(); };
    langF.appendChild(langSel);
    row.appendChild(langF);
    brand.appendChild(row);
    grid.appendChild(brand);

    /* --- data --- */
    var data = el('div', 'card');
    data.appendChild(el('h3', null, '💾 ' + esc(t('settings_data'))));
    var acts = el('div', 'data-actions');

    var exJson = el('button', 'btn neutral', '⬇️ ' + esc(t('export_json')));
    exJson.onclick = function () {
      download('ta7seel-backup-' + today() + '.json',
        JSON.stringify({ app: 'ta7seel', version: 1, exportedAt: new Date().toISOString(),
          settings: s, clients: state.clients, invoices: state.invoices, reminders: state.reminders }, null, 2),
        'application/json');
    };
    acts.appendChild(exJson);

    var exCsv = el('button', 'btn neutral', '📄 ' + esc(t('export_csv')));
    exCsv.onclick = function () {
      download('ta7seel-invoices-' + today() + '.csv',
        C.invoicesToCSV(state.invoices, state.clients, today()), 'text/csv');
    };
    acts.appendChild(exCsv);

    var exBrand = el('button', 'btn neutral', '🏷 ' + esc(t('export_brand')));
    exBrand.onclick = function () {
      download('ta7seel-brand-' + s.businessName.toLowerCase().replace(/\s+/g, '-') + '.json',
        JSON.stringify({ app: 'ta7seel-brandkit', version: 1,
          businessName: s.businessName, logoEmoji: s.logoEmoji, logoImage: s.logoImage,
          accent: s.accent, currency: s.currency, lang: s.lang,
          ladder: s.ladder, templates: s.templates }, null, 2),
        'application/json');
    };
    acts.appendChild(exBrand);

    var imJson = el('button', 'btn neutral', '⬆️ ' + esc(t('import_json')));
    imJson.onclick = function () {
      pickFile(function (text) {
        try {
          var d = JSON.parse(text);
          if (d.app === 'ta7seel-brandkit') {
            ['businessName', 'logoEmoji', 'logoImage', 'accent', 'currency', 'lang'].forEach(function (k) {
              if (d[k] !== undefined) s[k] = d[k];
            });
            if (Array.isArray(d.ladder)) s.ladder = d.ladder;
            if (d.templates) {
              ['en', 'ar'].forEach(function (lng) {
                if (d.templates[lng]) s.templates[lng] = Object.assign({}, I.TEMPLATES[lng], d.templates[lng]);
              });
            }
            save(); applyBrand(); buildNav(); route(); toast(t('import_ok'));
            return;
          }
          if (d.app !== 'ta7seel' || !Array.isArray(d.invoices)) throw new Error('bad file');
          state.clients = d.clients || [];
          state.invoices = d.invoices || [];
          state.reminders = d.reminders || [];
          if (d.settings) {
            state.settings = Object.assign(freshState().settings, d.settings);
          }
          save(); applyBrand(); buildNav(); route(); toast(t('import_ok'));
        } catch (e) {
          toast(t('import_bad'));
        }
      });
    };
    acts.appendChild(imJson);

    var seed = el('button', 'btn soft', '🧪 ' + esc(t('seed_sample')));
    seed.title = t('seed_hint');
    seed.onclick = function () {
      seedSample();
      save(); applyBrand(); buildNav(); route(); toast(t('saved_toast'));
    };
    acts.appendChild(seed);

    var wipe = el('button', 'btn danger', '🗑 ' + esc(t('wipe_data')));
    wipe.onclick = function () {
      if (!confirm(t('confirm_wipe'))) return;
      state = freshState();
      save(); applyBrand(); buildNav(); route(); toast(t('deleted_toast'));
    };
    acts.appendChild(wipe);

    data.appendChild(el('div', null, '&nbsp;'));
    data.appendChild(acts);
    grid.appendChild(data);

    /* --- reminder engine --- */
    var engine = el('div', 'card');
    engine.style.gridColumn = '1 / -1';
    engine.appendChild(el('h3', null, '⏰ ' + esc(t('settings_reminders'))));
    engine.appendChild(el('p', 'hint', esc(t('settings_reminders_hint') + ' · ' + t('ladder_offset_label'))));
    engine.appendChild(el('div', null, '&nbsp;'));

    s.ladder.forEach(function (lv) {
      var row = el('div', 'ladder-row');
      var sw = el('label', 'switch');
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = lv.enabled;
      cb.onchange = function () { lv.enabled = cb.checked; save(); };
      sw.appendChild(cb);
      sw.appendChild(el('i'));
      row.appendChild(sw);
      var mid = el('div');
      mid.appendChild(el('div', 'lvl-name', esc(t('lvl_' + lv.id))));
      mid.appendChild(el('div', 'lvl-when', esc(t('lvl_' + lv.id + '_when'))));
      // template editor
      var tplBox = el('div', 'tpl-edit');
      tplBox.appendChild(el('label', 'hint', esc(t('template_label') + ' (' + (lang() === 'ar' ? 'العربية' : 'English') + ')')));
      var ta = el('textarea');
      ta.value = s.templates[lang()][lv.id] || '';
      ta.onchange = function () { s.templates[lang()][lv.id] = ta.value; save(); };
      tplBox.appendChild(ta);
      mid.appendChild(tplBox);
      row.appendChild(mid);
      var off = el('input'); off.type = 'number'; off.value = lv.offset;
      off.title = t('ladder_offset_label');
      off.onchange = function () { lv.offset = parseInt(off.value, 10) || 0; save(); };
      row.appendChild(off);
      engine.appendChild(row);
    });

    engine.appendChild(el('p', 'hint', esc(t('template_placeholders'))));
    var reset = el('button', 'btn small neutral', esc(t('reset_templates')));
    reset.style.marginTop = '8px';
    reset.onclick = function () {
      s.templates = JSON.parse(JSON.stringify(I.TEMPLATES));
      s.ladder = C.defaultLadder();
      save(); route(); toast(t('saved_toast'));
    };
    engine.appendChild(reset);
    grid.appendChild(engine);

    view.appendChild(grid);
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function pickFile(cb) {
    var inp = el('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { cb(rd.result); };
      rd.readAsText(f);
    };
    inp.click();
  }

  /* ---------- sample data ---------- */

  function seedSample() {
    var t0 = today();
    var c1 = { id: C.uid('cli'), name: lang() === 'ar' ? 'سارة محمود' : 'Sara Mahmoud', company: lang() === 'ar' ? 'استوديو نون' : 'Noon Studio', phone: '+201012345678', email: 'sara@noonstudio.co', notes: '', createdAt: new Date().toISOString() };
    var c2 = { id: C.uid('cli'), name: lang() === 'ar' ? 'كريم عادل' : 'Karim Adel', company: lang() === 'ar' ? 'مقهى ريف' : 'Reef Cafe', phone: '+201223456789', email: 'karim@reef.cafe', notes: '', createdAt: new Date().toISOString() };
    var c3 = { id: C.uid('cli'), name: lang() === 'ar' ? 'منى حسن' : 'Mona Hassan', company: lang() === 'ar' ? 'متجر قطن' : 'Cotton Store', phone: '+201334567890', email: '', notes: '', createdAt: new Date().toISOString() };
    state.clients = [c1, c2, c3];
    function inv(client, num, desc, amount, issueOff, dueOff, pays, base) {
      return {
        id: C.uid('inv'), number: num, clientId: client.id, description: desc,
        amount: amount, issueDate: C.addDays(t0, issueOff), dueDate: C.addDays(t0, dueOff),
        baseStatus: base || 'sent', payments: pays || [], createdAt: new Date(Date.now() + issueOff * 86400000).toISOString()
      };
    }
    var ar = lang() === 'ar';
    state.invoices = [
      inv(c1, 'INV-0001', ar ? 'تصميم هوية بصرية' : 'Brand identity design', 8500, -45, -31, [
        { id: C.uid('pay'), date: C.addDays(t0, -40), amount: 3000, method: 'transfer', note: ar ? 'دفعة أولى' : 'First installment' }
      ]),
      inv(c1, 'INV-0004', ar ? 'تصميم منشورات سوشيال' : 'Social media kit', 2400, -12, -5, []),
      inv(c2, 'INV-0002', ar ? 'تصوير قائمة الطعام' : 'Menu photography', 4000, -20, -6, [
        { id: C.uid('pay'), date: C.addDays(t0, -10), amount: 2000, method: 'wallet', note: '' }
      ]),
      inv(c3, 'INV-0003', ar ? 'تطوير متجر إلكتروني' : 'Online store build', 12000, -9, 5, []),
      inv(c2, 'INV-0005', ar ? 'لوحة إعلانية' : 'Billboard design', 1500, -60, -45, [
        { id: C.uid('pay'), date: C.addDays(t0, -42), amount: 1500, method: 'cash', note: '' }
      ])
    ];
    state.reminders = [{
      id: C.uid('rem'), invoiceId: state.invoices[0].id, levelId: 'nudge',
      channel: 'whatsapp', sentAt: new Date(Date.now() - 6 * 86400000).toISOString()
    }];
  }

  /* ---------- boot ---------- */

  $('#lang-toggle').addEventListener('click', function () {
    state.settings.lang = lang() === 'ar' ? 'en' : 'ar';
    save(); applyBrand(); buildNav(); route();
  });

  load();
  applyBrand();
  buildNav();
  window.addEventListener('hashchange', route);
  route();
})();
