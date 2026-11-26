/* Ta7seel — core logic. Pure functions, no DOM, no storage.
   Loaded in the browser (window.Ta7seelCore) and in Node (module.exports) for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ta7seelCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 86400000;

  /* ---------- dates ---------- */

  function parseDate(s) {
    // 'YYYY-MM-DD' -> ms (UTC). Returns NaN for bad input.
    if (typeof s !== 'string') return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return NaN;
    var d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var check = new Date(d);
    if (check.getUTCFullYear() !== +m[1] || check.getUTCMonth() !== +m[2] - 1 || check.getUTCDate() !== +m[3]) return NaN;
    return d;
  }

  function toDateStr(ms) {
    var d = new Date(ms);
    var y = d.getUTCFullYear();
    var mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    var da = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + mo + '-' + da;
  }

  function todayStr(now) {
    var d = now ? new Date(now) : new Date();
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    var da = String(d.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + da;
  }

  function addDays(dateStr, n) {
    var ms = parseDate(dateStr);
    if (isNaN(ms)) return null;
    return toDateStr(ms + n * DAY_MS);
  }

  function diffDays(fromStr, toStr) {
    // whole days from `fromStr` to `toStr` (toStr - fromStr)
    var a = parseDate(fromStr), b = parseDate(toStr);
    if (isNaN(a) || isNaN(b)) return NaN;
    return Math.round((b - a) / DAY_MS);
  }

  /* ---------- money ---------- */

  function round2(n) { return Math.round((+n + Number.EPSILON) * 100) / 100; }

  function paidTotal(invoice) {
    if (!invoice || !Array.isArray(invoice.payments)) return 0;
    return round2(invoice.payments.reduce(function (s, p) { return s + (+p.amount || 0); }, 0));
  }

  function balance(invoice) {
    if (!invoice) return 0;
    return round2(Math.max(0, (+invoice.amount || 0) - paidTotal(invoice)));
  }

  function fmtMoney(amount, currency, locale) {
    var n = +amount || 0;
    try {
      return new Intl.NumberFormat(locale || 'en', {
        style: 'currency', currency: currency || 'USD',
        minimumFractionDigits: (Math.abs(n) % 1 > 0 ? 2 : 0),
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) {
      return n.toFixed(2) + ' ' + (currency || '');
    }
  }

  function fmtDate(dateStr, locale, opts) {
    var ms = parseDate(dateStr);
    if (isNaN(ms)) return dateStr || '';
    try {
      return new Intl.DateTimeFormat(locale || 'en', opts || { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(ms));
    } catch (e) { return dateStr; }
  }

  /* ---------- invoice status ---------- */

  // Derived status. invoice.baseStatus is 'draft' or 'sent'.
  function invoiceStatus(invoice, today) {
    if (!invoice) return 'draft';
    var amount = +invoice.amount || 0;
    var paid = paidTotal(invoice);
    if (amount > 0 && paid >= amount) return 'paid';
    // drafts never age or get chased
    if (invoice.baseStatus === 'draft') return 'draft';
    var t = today || todayStr();
    var od = daysOverdue(invoice, t);
    if (od > 0) return 'overdue';
    if (paid > 0) return 'partial';
    return 'sent';
  }

  function daysOverdue(invoice, today) {
    if (!invoice || !invoice.dueDate) return 0;
    var t = today || todayStr();
    var d = diffDays(invoice.dueDate, t);
    return isNaN(d) ? 0 : Math.max(0, d);
  }

  function isOpen(invoice, today) {
    var s = invoiceStatus(invoice, today);
    return s !== 'paid' && s !== 'draft';
  }

  /* Aging bucket for an open invoice: current, 1-7, 8-14, 15-30, 31+. */
  var AGING_BUCKETS = ['current', '1-7', '8-14', '15-30', '31+'];

  function agingBucket(invoice, today) {
    var d = daysOverdue(invoice, today);
    if (d <= 0) return 'current';
    if (d <= 7) return '1-7';
    if (d <= 14) return '8-14';
    if (d <= 30) return '15-30';
    return '31+';
  }

  /* ---------- reminder ladder ---------- */

  function defaultLadder() {
    return [
      { id: 'predue',   offset: -3, enabled: true  },
      { id: 'due',      offset: 0,  enabled: true  },
      { id: 'nudge',    offset: 3,  enabled: true  },
      { id: 'firm',     offset: 7,  enabled: true  },
      { id: 'final',    offset: 14, enabled: true  },
      { id: 'escalate', offset: 30, enabled: true  }
    ];
  }

  function ladderLevel(ladder, id) {
    for (var i = 0; i < (ladder || []).length; i++) if (ladder[i].id === id) return ladder[i];
    return null;
  }

  // Days from due date (negative = before due).
  function daysFromDue(invoice, today) {
    if (!invoice || !invoice.dueDate) return NaN;
    return diffDays(invoice.dueDate, today || todayStr());
  }

  // Highest enabled level whose trigger point is reached (or null).
  function dueReminderLevel(invoice, ladder, today) {
    if (!isOpen(invoice, today)) return null;
    var dfd = daysFromDue(invoice, today);
    if (isNaN(dfd)) return null;
    var best = null;
    (ladder || []).forEach(function (lv) {
      if (!lv.enabled) return;
      if (dfd >= lv.offset) {
        if (!best || lv.offset > best.offset) best = lv;
      }
    });
    return best;
  }

  // The next level to actually send: the highest triggered level not yet logged
  // for this invoice. Sending a level "catches up" lower ones.
  function nextReminder(invoice, ladder, reminderLog, today) {
    var lvl = dueReminderLevel(invoice, ladder, today);
    if (!lvl) return null;
    var sent = {};
    (reminderLog || []).forEach(function (r) {
      if (r.invoiceId === invoice.id) {
        var l = ladderLevel(ladder, r.levelId);
        if (l) sent[r.levelId] = l.offset;
      }
    });
    if (sent[lvl.id] !== undefined) return null; // highest reached level already sent
    return lvl;
  }

  // Reminder date for a level: dueDate + offset, clamped not before issue date for negatives.
  function reminderDate(invoice, level) {
    var d = addDays(invoice.dueDate, level.offset);
    if (d && invoice.issueDate && parseDate(d) < parseDate(invoice.issueDate)) return invoice.issueDate;
    return d;
  }

  /* ---------- message templates ---------- */

  function interpolate(template, ctx) {
    if (typeof template !== 'string') return '';
    return template.replace(/\{([a-z_]+)\}/g, function (m, key) {
      return ctx && ctx[key] !== undefined && ctx[key] !== null ? String(ctx[key]) : m;
    });
  }

  function buildContext(invoice, client, settings, today) {
    var lang = (settings && settings.lang) || 'ar';
    var locale = lang === 'ar' ? 'ar-EG' : 'en-GB';
    var days = daysOverdue(invoice, today);
    var daysStr;
    try { daysStr = new Intl.NumberFormat(locale).format(days); } catch (e) { daysStr = String(days); }
    return {
      client_name: client ? client.name : '',
      invoice_no: invoice.number || '',
      amount: fmtMoney(balance(invoice), settings.currency, locale),
      total: fmtMoney(+invoice.amount || 0, settings.currency, locale),
      due_date: fmtDate(invoice.dueDate, locale),
      issue_date: fmtDate(invoice.issueDate, locale),
      days_overdue: daysStr,
      business_name: settings.businessName || '',
      description: invoice.description || ''
    };
  }

  function renderReminder(invoice, client, settings, levelId, today) {
    var lang = (settings && settings.lang) || 'ar';
    var tpl = settings.templates && settings.templates[lang] && settings.templates[lang][levelId];
    if (!tpl) tpl = settings.templates && settings.templates.en && settings.templates.en[levelId];
    return interpolate(tpl || '', buildContext(invoice, client, settings, today));
  }

  /* ---------- KPIs & reports ---------- */

  function kpis(invoices, today) {
    var t = today || todayStr();
    var out = { outstanding: 0, overdue: 0, overdueCount: 0, openCount: 0,
                collectedThisMonth: 0, paidCount: 0, avgDaysToPay: null };
    var monthStart = t.slice(0, 8) + '01';
    var payDays = [];
    (invoices || []).forEach(function (inv) {
      var st = invoiceStatus(inv, t);
      var bal = balance(inv);
      if (st === 'overdue' || st === 'partial' || st === 'sent') {
        out.outstanding = round2(out.outstanding + bal);
        out.openCount++;
      }
      if (st === 'overdue') {
        out.overdue = round2(out.overdue + bal);
        out.overdueCount++;
      }
      if (st === 'paid') {
        out.paidCount++;
        var last = inv.payments[inv.payments.length - 1];
        if (last && inv.issueDate) {
          var d = diffDays(inv.issueDate, last.date);
          if (!isNaN(d)) payDays.push(Math.max(0, d));
        }
      }
      (inv.payments || []).forEach(function (p) {
        if (p.date && p.date >= monthStart && p.date <= t) {
          out.collectedThisMonth = round2(out.collectedThisMonth + (+p.amount || 0));
        }
      });
    });
    if (payDays.length) {
      out.avgDaysToPay = Math.round(payDays.reduce(function (a, b) { return a + b; }, 0) / payDays.length);
    }
    return out;
  }

  function agingReport(invoices, today) {
    var t = today || todayStr();
    var buckets = {};
    AGING_BUCKETS.forEach(function (b) { buckets[b] = { amount: 0, count: 0 }; });
    (invoices || []).forEach(function (inv) {
      if (!isOpen(inv, t)) return;
      var b = agingBucket(inv, t);
      buckets[b].amount = round2(buckets[b].amount + balance(inv));
      buckets[b].count++;
    });
    return buckets;
  }

  // Collected totals for the last n months (oldest first). Keys: 'YYYY-MM'.
  function collectedByMonth(invoices, n, today) {
    var t = today || todayStr();
    var y = +t.slice(0, 4), m = +t.slice(5, 7);
    var months = [];
    for (var i = n - 1; i >= 0; i--) {
      var mm = m - i, yy = y;
      while (mm <= 0) { mm += 12; yy--; }
      months.push(yy + '-' + String(mm).padStart(2, '0'));
    }
    var totals = {};
    months.forEach(function (k) { totals[k] = 0; });
    (invoices || []).forEach(function (inv) {
      (inv.payments || []).forEach(function (p) {
        var k = (p.date || '').slice(0, 7);
        if (totals[k] !== undefined) totals[k] = round2(totals[k] + (+p.amount || 0));
      });
    });
    return months.map(function (k) { return { month: k, total: totals[k] }; });
  }

  /* ---------- CSV ---------- */

  function csvEscape(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function invoicesToCSV(invoices, clients, today, headers) {
    var t = today || todayStr();
    var h = headers || ['number', 'client', 'description', 'issue_date', 'due_date', 'amount', 'paid', 'balance', 'status', 'days_overdue'];
    var clientName = {};
    (clients || []).forEach(function (c) { clientName[c.id] = c.name; });
    var lines = [h.map(csvEscape).join(',')];
    (invoices || []).forEach(function (inv) {
      lines.push([
        inv.number, clientName[inv.clientId] || '', inv.description,
        inv.issueDate, inv.dueDate, (+inv.amount || 0).toFixed(2),
        paidTotal(inv).toFixed(2), balance(inv).toFixed(2),
        invoiceStatus(inv, t), daysOverdue(inv, t)
      ].map(csvEscape).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }

  /* ---------- misc ---------- */

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function nextInvoiceNumber(invoices, prefix) {
    var max = 0;
    (invoices || []).forEach(function (inv) {
      var m = /(\d+)\s*$/.exec(inv.number || '');
      if (m) max = Math.max(max, +m[1]);
    });
    return (prefix || 'INV-') + String(max + 1).padStart(4, '0');
  }

  function validateInvoice(inv) {
    var errs = [];
    if (!inv.clientId) errs.push('client');
    if (!(+inv.amount > 0)) errs.push('amount');
    if (isNaN(parseDate(inv.issueDate))) errs.push('issueDate');
    if (isNaN(parseDate(inv.dueDate))) errs.push('dueDate');
    if (!errs.includes('issueDate') && !errs.includes('dueDate') &&
        parseDate(inv.dueDate) < parseDate(inv.issueDate)) errs.push('dueBeforeIssue');
    return errs;
  }

  /* ---------- sanitising (stored state and imported files) ---------- */

  function latinDigits(v) {
    return String(v == null ? '' : v).replace(/[\u0660-\u0669]/g, function (c) { return c.charCodeAt(0) - 0x0660; })
      .replace(/[\u06F0-\u06F9]/g, function (c) { return c.charCodeAt(0) - 0x06F0; });
  }
  /** Parse a typed amount: Arabic digits, decimal comma or Arabic decimal mark. NaN when invalid. */
  function parseAmount(v) {
    var s = latinDigits(v).trim().replace(/[\u066B,]/g, '.').replace(/\u066C/g, '');
    return /^\d+(\.\d+)?$|^\.\d+$/.test(s) ? parseFloat(s) : NaN;
  }
  function txt(v, max, fb) { return typeof v === 'string' ? v.slice(0, max) : (fb == null ? '' : fb); }
  function amt(v, fb) { var n = Number(v); return isFinite(n) && n >= 0 && n <= 1e12 ? n : fb; }
  var CURRENCY_OK = /^[A-Z]{3}$/;
  var IMG_OK = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  var PAY_METHODS = ['cash', 'transfer', 'wallet', 'card', 'other'];
  var DEFAULT_LEVEL_IDS = ['predue', 'due', 'nudge', 'firm', 'final', 'escalate'];

  function sanitizeSettings(raw, defaults, templates) {
    var r = raw && typeof raw === 'object' ? raw : {}, o = JSON.parse(JSON.stringify(defaults));
    o.businessName = txt(r.businessName, 60, defaults.businessName).trim() || defaults.businessName;
    o.logoEmoji = txt(r.logoEmoji, 8, defaults.logoEmoji) || defaults.logoEmoji;
    o.logoImage = typeof r.logoImage === 'string' && r.logoImage.length < 300000 && IMG_OK.test(r.logoImage) ? r.logoImage : null;
    o.accent = /^#[0-9a-fA-F]{6}$/.test(r.accent) ? r.accent : defaults.accent;
    o.currency = CURRENCY_OK.test(r.currency) ? r.currency : defaults.currency;
    o.lang = r.lang === 'en' ? 'en' : 'ar';
    o.countryCode = latinDigits(r.countryCode == null ? defaults.countryCode : r.countryCode).replace(/\D/g, '').slice(0, 4);
    var ladder = (Array.isArray(r.ladder) ? r.ladder : []).filter(function (l) { return l && DEFAULT_LEVEL_IDS.indexOf(l.id) >= 0 && isFinite(Number(l.offset)); })
      .map(function (l) { return { id: l.id, offset: Math.max(-365, Math.min(365, Math.round(Number(l.offset)))), enabled: l.enabled !== false }; });
    o.ladder = ladder.length ? ladder : defaultLadder();
    var tp = r.templates && typeof r.templates === 'object' ? r.templates : {};
    o.templates = {};
    ['en', 'ar'].forEach(function (lng) {
      var src = tp[lng] && typeof tp[lng] === 'object' ? tp[lng] : {}, out = {};
      Object.keys(templates[lng]).forEach(function (k) { out[k] = typeof src[k] === 'string' && src[k].trim() ? src[k].slice(0, 1500) : templates[lng][k]; });
      o.templates[lng] = out;
    });
    return o;
  }

  function sanitizeState(raw, defaults, templates) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var clients = [], cids = {};
    (Array.isArray(r.clients) ? r.clients : []).forEach(function (c) {
      if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || cids[c.id]) return;
      var name = txt(c.name, 80).trim(); if (!name) return;
      cids[c.id] = 1;
      clients.push({ id: c.id.slice(0, 60), name: name, company: txt(c.company, 80), phone: txt(c.phone, 30), email: txt(c.email, 120), notes: txt(c.notes, 1000), createdAt: txt(c.createdAt, 40) });
    });
    var invoices = [], iids = {};
    (Array.isArray(r.invoices) ? r.invoices : []).forEach(function (i) {
      if (!i || typeof i !== 'object' || typeof i.id !== 'string' || !i.id || iids[i.id]) return;
      var amount = amt(i.amount, null);
      if (amount === null || !cids[i.clientId] || isNaN(parseDate(i.issueDate)) || isNaN(parseDate(i.dueDate))) return;
      iids[i.id] = 1;
      var pays = (Array.isArray(i.payments) ? i.payments : []).filter(function (p) { return p && typeof p === 'object' && amt(p.amount, null) !== null && amt(p.amount, 0) > 0; }).map(function (p, n) {
        return { id: txt(p.id, 60) || ('pay-' + n), date: isNaN(parseDate(p.date)) ? i.issueDate : p.date, amount: round2(Number(p.amount)), method: PAY_METHODS.indexOf(p.method) >= 0 ? p.method : 'other', note: txt(p.note, 200) };
      });
      invoices.push({ id: i.id.slice(0, 60), number: txt(i.number, 30).trim() || 'INV', clientId: i.clientId, description: txt(i.description, 300), amount: amount, issueDate: i.issueDate, dueDate: i.dueDate,
        baseStatus: i.baseStatus === 'draft' ? 'draft' : 'sent', payments: pays, createdAt: txt(i.createdAt, 40) });
    });
    var reminders = (Array.isArray(r.reminders) ? r.reminders : []).filter(function (m) { return m && typeof m === 'object' && iids[m.invoiceId]; })
      .map(function (m, n) { return { id: txt(m.id, 60) || ('rem-' + n), invoiceId: m.invoiceId, levelId: DEFAULT_LEVEL_IDS.indexOf(m.levelId) >= 0 ? m.levelId : 'nudge', channel: m.channel === 'whatsapp' ? 'whatsapp' : 'manual', sentAt: txt(m.sentAt, 40) }; });
    return { settings: sanitizeSettings(r.settings, defaults, templates), clients: clients, invoices: invoices, reminders: reminders };
  }

  function whatsappLink(phone, text, cc) {
    var d = latinDigits(phone).replace(/[^\d]/g, '');
    if (!d) return null;
    cc = latinDigits(cc == null ? '' : cc).replace(/\D/g, '');
    if (d.indexOf('00') === 0) d = d.slice(2);
    else if (d.charAt(0) === '0' && cc) d = cc + d.slice(1);
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text || '');
  }

  return {
    DAY_MS: DAY_MS,
    parseDate: parseDate, toDateStr: toDateStr, todayStr: todayStr,
    addDays: addDays, diffDays: diffDays,
    round2: round2, paidTotal: paidTotal, balance: balance,
    fmtMoney: fmtMoney, fmtDate: fmtDate,
    invoiceStatus: invoiceStatus, daysOverdue: daysOverdue, isOpen: isOpen,
    AGING_BUCKETS: AGING_BUCKETS, agingBucket: agingBucket,
    defaultLadder: defaultLadder, ladderLevel: ladderLevel,
    daysFromDue: daysFromDue, dueReminderLevel: dueReminderLevel,
    nextReminder: nextReminder, reminderDate: reminderDate,
    interpolate: interpolate, buildContext: buildContext, renderReminder: renderReminder,
    kpis: kpis, agingReport: agingReport, collectedByMonth: collectedByMonth,
    invoicesToCSV: invoicesToCSV, csvEscape: csvEscape,
    uid: uid, nextInvoiceNumber: nextInvoiceNumber,
    validateInvoice: validateInvoice, whatsappLink: whatsappLink,
    sanitizeState: sanitizeState, sanitizeSettings: sanitizeSettings, parseAmount: parseAmount, latinDigits: latinDigits
  };
});
