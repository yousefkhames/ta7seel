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
    return {
      client_name: client ? client.name : '',
      invoice_no: invoice.number || '',
      amount: fmtMoney(balance(invoice), settings.currency, locale),
      total: fmtMoney(+invoice.amount || 0, settings.currency, locale),
      due_date: fmtDate(invoice.dueDate, locale),
      issue_date: fmtDate(invoice.issueDate, locale),
      days_overdue: String(daysOverdue(invoice, today)),
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

  function whatsappLink(phone, text) {
    var digits = String(phone || '').replace(/[^\d]/g, '');
    if (!digits) return null;
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text || '');
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
    validateInvoice: validateInvoice, whatsappLink: whatsappLink
  };
});
