'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../js/core.js');
const I = require('../js/i18n.js');

const TODAY = '2026-11-26';

function inv(over) {
  return Object.assign({
    id: 'inv-1', number: 'INV-0001', clientId: 'c1',
    amount: 1000, issueDate: '2026-11-01', dueDate: '2026-11-15',
    baseStatus: 'sent', payments: []
  }, over || {});
}

/* ---------- dates ---------- */

test('parseDate round-trips valid dates', () => {
  assert.equal(C.toDateStr(C.parseDate('2026-02-28')), '2026-02-28');
  assert.ok(Number.isNaN(C.parseDate('2026-02-30'))); // invalid real-world date
  assert.ok(Number.isNaN(C.parseDate('26-11-2026')));
  assert.ok(Number.isNaN(C.parseDate('')));
});

test('addDays and diffDays handle month boundaries', () => {
  assert.equal(C.addDays('2026-01-30', 3), '2026-02-02');
  assert.equal(C.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(C.diffDays('2026-11-01', '2026-11-15'), 14);
  assert.equal(C.diffDays('2026-11-15', '2026-11-01'), -14);
});

/* ---------- money ---------- */

test('paidTotal and balance with partial payments', () => {
  const i = inv({ payments: [{ amount: 300 }, { amount: 250.55 }] });
  assert.equal(C.paidTotal(i), 550.55);
  assert.equal(C.balance(i), 449.45);
});

test('balance never goes negative', () => {
  const i = inv({ payments: [{ amount: 1200 }] });
  assert.equal(C.balance(i), 0);
});

test('round2 kills float dust', () => {
  assert.equal(C.round2(0.1 + 0.2), 0.3);
});

test('fmtMoney renders currency and falls back on bad currency', () => {
  const s = C.fmtMoney(1500, 'EGP', 'en-GB');
  assert.match(s, /1,?500/);
  const fb = C.fmtMoney(10, 'NOTREAL', 'en');
  assert.match(fb, /10/);
});

/* ---------- status ---------- */

test('status lifecycle: draft -> sent -> overdue -> partial -> paid', () => {
  assert.equal(C.invoiceStatus(inv({ baseStatus: 'draft', dueDate: '2026-12-01' }), TODAY), 'draft');
  assert.equal(C.invoiceStatus(inv({ dueDate: '2026-12-01' }), TODAY), 'sent');
  assert.equal(C.invoiceStatus(inv({ dueDate: '2026-11-20' }), TODAY), 'overdue');
  assert.equal(C.invoiceStatus(inv({ dueDate: '2026-11-20', payments: [{ amount: 400 }] }), TODAY), 'overdue'); // still overdue even if partly paid
  assert.equal(C.invoiceStatus(inv({ dueDate: '2026-12-20', payments: [{ amount: 400 }] }), TODAY), 'partial');
  assert.equal(C.invoiceStatus(inv({ payments: [{ amount: 1000 }] }), TODAY), 'paid');
});

test('daysOverdue never negative', () => {
  assert.equal(C.daysOverdue(inv({ dueDate: '2026-12-31' }), TODAY), 0);
  assert.equal(C.daysOverdue(inv({ dueDate: '2026-11-20' }), TODAY), 6);
});

test('draft is not open; overdue partial paid flags', () => {
  assert.equal(C.isOpen(inv({ baseStatus: 'draft' }), TODAY), false);
  assert.equal(C.isOpen(inv({ dueDate: '2026-11-20' }), TODAY), true);
  assert.equal(C.isOpen(inv({ payments: [{ amount: 1000 }] }), TODAY), false);
});

/* ---------- aging ---------- */

test('aging buckets land on the right ranges', () => {
  const mk = (due) => inv({ dueDate: due });
  assert.equal(C.agingBucket(mk('2026-12-01'), TODAY), 'current');
  assert.equal(C.agingBucket(mk(TODAY), TODAY), 'current');
  assert.equal(C.agingBucket(mk('2026-11-25'), TODAY), '1-7');
  assert.equal(C.agingBucket(mk('2026-11-19'), TODAY), '1-7');
  assert.equal(C.agingBucket(mk('2026-11-18'), TODAY), '8-14');
  assert.equal(C.agingBucket(mk('2026-11-12'), TODAY), '8-14');
  assert.equal(C.agingBucket(mk('2026-11-11'), TODAY), '15-30');
  assert.equal(C.agingBucket(mk('2026-10-27'), TODAY), '15-30');
  assert.equal(C.agingBucket(mk('2026-10-26'), TODAY), '31+');
});

test('agingReport sums balances per bucket and skips paid', () => {
  const invoices = [
    inv({ id: 'a', dueDate: '2026-12-01', amount: 100 }),
    inv({ id: 'b', dueDate: '2026-11-20', amount: 200 }),
    inv({ id: 'c', dueDate: '2026-11-20', amount: 300, payments: [{ amount: 300 }] }),
    inv({ id: 'd', dueDate: '2026-10-01', amount: 50, payments: [{ amount: 20 }] })
  ];
  const rep = C.agingReport(invoices, TODAY);
  assert.equal(rep['current'].amount, 100);
  assert.equal(rep['1-7'].amount, 200);
  assert.equal(rep['31+'].amount, 30);
  assert.equal(rep['1-7'].count, 1);
});

/* ---------- reminder ladder ---------- */

test('dueReminderLevel picks the highest reached enabled level', () => {
  const ladder = C.defaultLadder();
  // 4 days before due: nothing triggered yet (predue fires at -3)
  assert.equal(C.dueReminderLevel(inv({ dueDate: '2026-11-30' }), ladder, TODAY), null);
  // due +0: the due-date level is the highest reached (offset 0 beats -3)
  assert.equal(C.dueReminderLevel(inv({ dueDate: TODAY }), ladder, TODAY).id, 'due');
  // due 4 days ago: nudge reached
  assert.equal(C.dueReminderLevel(inv({ dueDate: '2026-11-22' }), ladder, TODAY).id, 'nudge');
  // 40 days late: escalate
  assert.equal(C.dueReminderLevel(inv({ dueDate: '2026-10-17' }), ladder, TODAY).id, 'escalate');
});

test('disabled levels are skipped', () => {
  const ladder = C.defaultLadder().map(l => l.id === 'nudge' ? Object.assign({}, l, { enabled: false }) : l);
  // 4 days late, nudge disabled -> firm not reached, so 'due' (offset 0)
  assert.equal(C.dueReminderLevel(inv({ dueDate: '2026-11-22' }), ladder, TODAY).id, 'due');
});

test('nextReminder is null once highest reached level was logged', () => {
  const ladder = C.defaultLadder();
  const i = inv({ dueDate: '2026-11-22' }); // nudge reached
  assert.equal(C.nextReminder(i, ladder, [], TODAY).id, 'nudge');
  const log = [{ invoiceId: 'inv-1', levelId: 'nudge', sentAt: '2026-11-19T10:00:00Z' }];
  assert.equal(C.nextReminder(i, ladder, log, TODAY), null);
  // lower level logged but higher reached -> still chase
  const log2 = [{ invoiceId: 'inv-1', levelId: 'due', sentAt: '2026-11-15T10:00:00Z' }];
  assert.equal(C.nextReminder(i, ladder, log2, TODAY).id, 'nudge');
});

test('reminderDate clamps pre-due dates to issue date', () => {
  const lvl = { id: 'predue', offset: -3 };
  assert.equal(C.reminderDate(inv({ issueDate: '2026-11-13', dueDate: '2026-11-15' }), lvl), '2026-11-13');
  assert.equal(C.reminderDate(inv({ issueDate: '2026-11-01', dueDate: '2026-11-15' }), lvl), '2026-11-12');
});

/* ---------- templates ---------- */

test('interpolate replaces known placeholders, keeps unknown ones', () => {
  assert.equal(C.interpolate('Hi {a}, {b}!', { a: 'Sara', b: 5 }), 'Hi Sara, 5!');
  assert.equal(C.interpolate('Hi {a} {zzz}', { a: 'Sara' }), 'Hi Sara {zzz}');
});

test('renderReminder fills a full bilingual message', () => {
  const settings = {
    lang: 'ar', currency: 'EGP', businessName: 'ستوديو تست',
    templates: JSON.parse(JSON.stringify(I.TEMPLATES))
  };
  const client = { name: 'سارة' };
  const i = inv({ dueDate: '2026-11-20', payments: [{ amount: 200 }] });
  const msg = C.renderReminder(i, client, settings, 'nudge', TODAY);
  assert.match(msg, /سارة/);
  assert.match(msg, /INV-0001/);
  assert.match(msg, /[8٨]/); // balance, not total (ar-EG uses Eastern Arabic digits)
  assert.match(msg, /ستوديو تست/);
  assert.ok(!msg.includes('{'));
});

test('renderReminder falls back to en template when lang template missing', () => {
  const settings = { lang: 'ar', currency: 'EGP', businessName: 'X', templates: { ar: {}, en: I.TEMPLATES.en } };
  const msg = C.renderReminder(inv(), { name: 'Sam' }, settings, 'due', TODAY);
  assert.match(msg, /Sam/);
});

/* ---------- KPIs ---------- */

test('kpis: outstanding, overdue, collected-this-month, avg days', () => {
  const invoices = [
    inv({ id: 'a', dueDate: '2026-12-10', amount: 500 }),                                    // open current
    inv({ id: 'b', dueDate: '2026-11-10', amount: 300, payments: [{ amount: 100, date: '2026-11-05' }] }), // overdue 200
    inv({ id: 'c', dueDate: '2026-11-01', amount: 400, issueDate: '2026-10-20',
          payments: [{ amount: 400, date: '2026-11-03' }] })                                 // paid in 14 days
  ];
  const k = C.kpis(invoices, TODAY);
  assert.equal(k.outstanding, 700);
  assert.equal(k.overdue, 200);
  assert.equal(k.overdueCount, 1);
  assert.equal(k.openCount, 2);
  assert.equal(k.collectedThisMonth, 500); // Nov payments: 100 + 400
  assert.equal(k.paidCount, 1);
  assert.equal(k.avgDaysToPay, 14);
});

test('collectedByMonth buckets payments, oldest first', () => {
  const invoices = [inv({ payments: [
    { amount: 10, date: '2026-11-02' },
    { amount: 20, date: '2026-09-15' },
    { amount: 99, date: '2024-01-01' } // out of window
  ] })];
  const rows = C.collectedByMonth(invoices, 6, TODAY);
  assert.equal(rows.length, 6);
  assert.equal(rows[5].month, '2026-11');
  assert.equal(rows[5].total, 10);
  assert.equal(rows[3].month, '2026-09');
  assert.equal(rows[3].total, 20);
  assert.equal(rows.reduce((s, r) => s + r.total, 0), 30);
});

/* ---------- CSV ---------- */

test('invoicesToCSV escapes commas and quotes', () => {
  const csv = C.invoicesToCSV(
    [inv({ number: 'A,1', description: 'said "hi"' })],
    [{ id: 'c1', name: 'Sara, Inc' }], TODAY);
  assert.match(csv, /"A,1"/);
  assert.match(csv, /"Sara, Inc"/);
  assert.match(csv, /"said ""hi"""/);
  const lines = csv.trim().split(/\r\n/);
  assert.equal(lines.length, 2);
});

/* ---------- misc ---------- */

test('nextInvoiceNumber increments the highest trailing number', () => {
  assert.equal(C.nextInvoiceNumber([{ number: 'INV-0007' }, { number: 'INV-0002' }]), 'INV-0008');
  assert.equal(C.nextInvoiceNumber([]), 'INV-0001');
});

test('validateInvoice catches the real problems', () => {
  assert.deepEqual(C.validateInvoice(inv()), []);
  assert.ok(C.validateInvoice(inv({ clientId: '' })).includes('client'));
  assert.ok(C.validateInvoice(inv({ amount: 0 })).includes('amount'));
  assert.ok(C.validateInvoice(inv({ dueDate: 'junk' })).includes('dueDate'));
  assert.ok(C.validateInvoice(inv({ issueDate: '2026-11-20', dueDate: '2026-11-10' })).includes('dueBeforeIssue'));
});

test('whatsappLink strips non-digits and encodes the text', () => {
  const url = C.whatsappLink('+20 101-234-5678', 'hi there');
  assert.match(url, /^https:\/\/wa\.me\/201012345678\?text=/);
  assert.match(url, /hi%20there|hi\+there/);
  assert.equal(C.whatsappLink('', 'x'), null);
});

/* ---------- i18n ---------- */

test('every i18n key exists in both languages', () => {
  for (const key of Object.keys(I.STR.en)) {
    assert.ok(I.STR.ar[key] !== undefined, 'missing ar: ' + key);
  }
  for (const key of Object.keys(I.STR.ar)) {
    assert.ok(I.STR.en[key] !== undefined, 'missing en: ' + key);
  }
});

test('every ladder level has a template in both languages', () => {
  for (const lvl of C.defaultLadder()) {
    assert.ok(I.TEMPLATES.en[lvl.id], 'missing en template ' + lvl.id);
    assert.ok(I.TEMPLATES.ar[lvl.id], 'missing ar template ' + lvl.id);
  }
});

test('t() interpolates vars and falls back to en', () => {
  assert.equal(I.t('en', 'days_over', { n: 5 }), '5 days over');
  assert.equal(I.t('ar', 'days_over', { n: 5 }), 'متأخرة 5 يوم');
  assert.equal(I.t('ar', 'nonexistent_key'), 'nonexistent_key');
});
