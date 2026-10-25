/**
 * TPW Collective Impact – STEP 4: impact dashboards
 *
 * Calculates the TPW impact numbers from the "TPW Records" tab and keeps a
 * "TPW Impact Summary" tab (organization × program year) up to date in the sheet.
 *
 * HOW TO INSTALL (same Apps Script project as Steps 1–3)
 *  1. Extensions → Apps Script → "+" next to Files → Script. Name it Step4_Dashboard. Paste this file.
 *  2. Reload the sheet → TPW Tools → "Refresh impact summary".
 */

const DASH = {
  SUMMARY_SHEET: 'TPW Impact Summary',

  // Estimates shown on every page (see the footnotes on the dashboard)
  CREDIT_HOURS: 52,      // every 52 participant hours delivered …
  CREDIT_DAYS: 10,       // … earn about 10 days of rehabilitative credit
  COST_PER_YEAR: 21534,  // taxpayer cost of one year in prison (USD)

  SUMMARY_HEADERS: [
    'Organization', 'Program Year', 'Programs', 'Prisons', 'Participants', 'Participants Completed',
    'Completion Rate', 'Participant Hours Delivered', 'Rehab Credits (days, est.)', 'Taxpayer Savings (est.)',
  ],
};

// ───────────────────────────── Menu hook (called from Step 1's onOpen) ─────────────────────────────

function onOpenStep4_(menu) {
  menu
    .addSeparator()
    .addItem('Refresh impact summary', 'refreshDashboardData');
}

// ───────────────────────────── Impact calculations ─────────────────────────────

/** Records the dashboards count: not cancelled, with a start date. */
function dashboardRows_() {
  const number = v => (typeof v === 'number' ? v : null);
  return readRecordRows_(recordsSheet_())
    .filter(r => r[C['Status']] !== 'Cancelled' && r[C['Start Date']] instanceof Date)
    .map(r => ({
      org: String(r[C['Organization Name']]).trim(),
      program: String(r[C['Program Name']]).trim(),
      facility: String(r[C['CDCR Facility']]).trim(),
      status: r[C['Status']],
      start: startOfDay_(r[C['Start Date']]),
      hours: number(r[C['Total Programming Hours']]),
      participants: number(r[C['Number of Participants']]),
      completed: number(r[C['Number of Participants Completed']]),
      participantHours: number(r[C['Total Participant Programming Hours']]),
      synthetic: String(r[C['Notes']]).indexOf(SYNTHETIC_TAG) >= 0,
    }));
}

/**
 * The dashboard numbers for a set of records:
 *  • Participants: runs that have started (planned runs don't count yet).
 *  • Completion rate: completed ÷ participants, in finished runs that report both numbers.
 *  • Participant hours delivered: completed × course hours (calculated by Step 2).
 *  • Rehab credits (days) = participant hours ÷ 52 × 10; taxpayer savings = credit days ÷ 365 × $21,534.
 */
function impact_(rows) {
  let participants = 0;
  let completed = 0;
  let participantHours = 0;
  let rateParticipants = 0;
  let rateCompleted = 0;
  rows.forEach(r => {
    if (r.status !== 'Planned') participants += r.participants || 0;
    completed += r.completed || 0;
    participantHours += r.participantHours || 0;
    if (r.status === 'Completed' && r.participants !== null && r.completed !== null) {
      rateParticipants += r.participants;
      rateCompleted += r.completed;
    }
  });
  const creditDays = (participantHours / DASH.CREDIT_HOURS) * DASH.CREDIT_DAYS;
  return {
    orgs: new Set(rows.map(r => norm_(r.org))).size,
    programs: new Set(rows.map(r => norm_(r.org) + '|' + norm_(r.program))).size,
    prisons: new Set(rows.map(r => norm_(r.facility)).filter(Boolean)).size,
    participants,
    completed,
    participantHours,
    rate: rateParticipants > 0 ? rateCompleted / rateParticipants : null,
    rateParticipants,
    rateCompleted,
    creditDays,
    savings: (creditDays / 365) * DASH.COST_PER_YEAR,
  };
}

// ───────────────────────────── Summary tab in the sheet ─────────────────────────────

/** Rewrites the "TPW Impact Summary" tab. Step 2 calls this whenever records change. */
function refreshDashboardData() {
  const rows = dashboardRows_();
  const ss = ss_();
  let sh = ss.getSheetByName(DASH.SUMMARY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DASH.SUMMARY_SHEET);
    sh.getRange(1, 1, 1, DASH.SUMMARY_HEADERS.length).setValues([DASH.SUMMARY_HEADERS])
      .setFontWeight('bold').setBackground('#e8eaed').setWrap(true);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 240);
    sh.protect().setDescription('Written by the TPW scripts – recalculated whenever records change').setWarningOnly(true);
  }

  const years = Array.from(new Set(rows.map(r => r.start.getFullYear()))).sort();
  const out = [];
  const add = (label, subset) => years.forEach(y => {
    const inYear = subset.filter(r => r.start.getFullYear() === y);
    if (!inYear.length) return;
    const m = impact_(inYear);
    out.push([
      label, y, m.programs, m.prisons, m.participants, m.completed, m.rate === null ? '' : m.rate,
      m.participantHours, Math.round(m.creditDays), Math.round(m.savings),
    ]);
  });
  add('All organizations', rows);
  Array.from(groupBy_(rows, r => norm_(r.org)).values())
    .sort((a, b) => a[0].org.localeCompare(b[0].org))
    .forEach(g => add(g[0].org, g));

  const width = DASH.SUMMARY_HEADERS.length;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, width).clearContent();
  if (!out.length) return;
  sh.getRange(2, 1, out.length, width).setValues(out);
  sh.getRange(2, 3, out.length, 4).setNumberFormat('#,##0');
  sh.getRange(2, 7, out.length, 1).setNumberFormat('0.0%');
  sh.getRange(2, 8, out.length, 2).setNumberFormat('#,##0');
  sh.getRange(2, 10, out.length, 1).setNumberFormat('$#,##0');
}

// ───────────────────────────── Helpers ─────────────────────────────

function norm_(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function groupBy_(rows, keyFn) {
  const groups = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return groups;
}
