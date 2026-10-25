/**
 * TPW Collective Impact – STEP 2: the real database, summary emails, reminders
 *
 * Google Forms always stores one wide row per response (one column per
 * question). This script turns every response into clean records in the
 * "TPW Records" tab: ONE ROW PER YARD, per date window, per facility, per
 * program – the same layout as the original TPW sheet.
 *
 *  • Runs automatically on every submission and every edit of a response
 *    (an edited response replaces its earlier records).
 *  • Carries the organization, program and facility down to every yard row.
 *  • Calculates Status from the dates: Planned / In Progress / Completed,
 *    or Cancelled when the partner chose that. Refreshed every morning.
 *  • Flags data problems (end before start, more completions than participants…).
 *  • After each submission, emails the submitter a personal summary of their
 *    organization's year so far (CC: the organization's Reminder Email).
 *  • The day after a run's end date, if its final numbers are missing, emails
 *    the organization's Reminder Email (one email per organization per day).
 *
 * HOW TO INSTALL (same Apps Script project as Step 1)
 *  1. Extensions → Apps Script → "+" next to Files → Script. Name it Step2_Records.
 *  2. Paste this file and Save. Also paste the updated Step1_Setup.gs (its menu
 *     now includes the Step 2 items).
 *  3. Project Settings (gear icon) → Time zone → (GMT-07:00) Los Angeles.
 *  4. Reload the sheet → TPW Tools → "Set up records (Step 2)".
 *
 * The raw "TPW Responses" tab is hidden afterwards. Never edit it by hand.
 */

const REC = {
  SHEET: 'TPW Records',
  DAILY_HOUR: 6, // morning status refresh + reminders (script time zone)

  SEND_SUMMARY_EMAIL: true,
  SEND_REMINDER_EMAIL: true,
  DASHBOARD_URL: '', // paste the partner dashboard link here once it exists

  // Columns hidden from view (still used by the scripts)
  HIDDEN: ['Needs Final Numbers', 'Last Updated', 'Response ID', 'Edit Link', 'Reminder Sent'],

  HEADERS: [
    'Record ID',
    'CDCR Facility',
    'Yard',
    'Organization Name',
    'Program Name',
    'Status',
    'Start Date',
    'End Date',
    'Total Programming Hours',
    'Number of Participants',
    'Number of Participants Completed',
    'Total Participant Programming Hours',
    'Program Year',
    'Notes',
    'Needs Final Numbers',
    'Data Flags',
    'Submitted By',
    'Last Updated',
    'Response ID',
    'Edit Link',
    'Reminder Sent',
  ],
};

// Responses whose Notes contain this tag are test data: no emails are sent for them.
const SYNTHETIC_TAG = 'SYNTHETIC TEST DATA';

// Data Flag on a record that repeats an earlier one exactly; followed by that record's ID.
const DUP_FLAG = 'Duplicate of ';

// Data Flags (as written to the sheet) → what the summary email tells the partner to do.
const FLAG_HELP = {
  'Yard name missing':
    '<b>No yard name.</b> Add the yard name so we can tell this yard’s numbers apart from the others.',
  'More completions than participants':
    '<b>More people completed than enrolled.</b> Check the "Number of Participants" and "Number Completed" for this yard.',
  'End date is before start date':
    '<b>The end date is before the start date.</b> Check that the two dates aren’t swapped.',
  'Marked as ended, but end date was not in the past':
    '<b>Marked as ended, but the end date hasn’t passed yet.</b> If the run is still going, change ' +
    '"Has this program run already ended?" to No. If it ended early, update the end date.',
  'Marked as not ended, but end date had passed':
    '<b>Marked as still running, but the end date has passed.</b> If it’s finished, change ' +
    '"Has this program run already ended?" to Yes and add the final numbers. If it was extended, update the end date.',
};

// Column positions (0-based) for readability
const C = REC.HEADERS.reduce((acc, h, i) => {
  acc[h] = i;
  return acc;
}, {});

// ───────────────────────────── Menu hook (called from Step 1's onOpen) ─────────────────────────────

function onOpenStep2_(menu) {
  menu
    .addSeparator()
    .addItem('Set up records (Step 2)', 'setupRecords')
    .addItem('Rebuild all records from responses', 'rebuildAllRecords')
    .addItem('Refresh statuses now', 'refreshStatuses');
}

// ───────────────────────────── Setup ─────────────────────────────

function setupRecords() {
  if (props_().getProperty(KEYS.BUILD_STATE) !== 'done') {
    SpreadsheetApp.getUi().alert('Finish Step 1 first: the form must be fully built.');
    return;
  }
  const ss = ss_();
  const sh = recordsSheet_();

  // Hide the raw wide table and put the clean records first.
  const raw = ss.getSheetByName(CFG.RESPONSES_SHEET);
  if (raw) raw.hideSheet();
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
  applyColumnVisibility_(sh);

  clearTriggers_(['onTpwFormSubmit', 'dailyTpwRefresh']);
  ScriptApp.newTrigger('onTpwFormSubmit').forForm(getForm_()).onFormSubmit().create();
  ScriptApp.newTrigger('dailyTpwRefresh').timeBased().atHour(REC.DAILY_HOUR).everyDays(1).create();

  rebuildAllRecords();

  SpreadsheetApp.getUi().alert(
    'Records are set up',
    'Every new submission or edit now creates one row per yard in "' + REC.SHEET + '". ' +
      'Statuses refresh every morning.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function recordsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(REC.SHEET);
  if (sh) return sh;

  sh = ss.insertSheet(REC.SHEET);
  sh.getRange(1, 1, 1, REC.HEADERS.length)
    .setValues([REC.HEADERS])
    .setFontWeight('bold')
    .setBackground('#e8eaed')
    .setWrap(true);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);

  const rows = sh.getMaxRows() - 1;
  sh.getRange(2, C['Start Date'] + 1, rows, 2).setNumberFormat('m/d/yyyy');
  sh.getRange(2, C['Last Updated'] + 1, rows, 1).setNumberFormat('m/d/yyyy h:mm');
  sh.getRange(2, C['Reminder Sent'] + 1, rows, 1).setNumberFormat('m/d/yyyy');

  sh.setColumnWidth(C['Record ID'] + 1, 170);
  sh.setColumnWidth(C['CDCR Facility'] + 1, 300);
  sh.setColumnWidth(C['Organization Name'] + 1, 200);
  sh.setColumnWidth(C['Program Name'] + 1, 200);
  sh.setColumnWidth(C['Data Flags'] + 1, 280);
  sh.setColumnWidth(C['Submitted By'] + 1, 220);

  applyColumnVisibility_(sh);

  sh.protect()
    .setDescription('Written by the TPW scripts – change data through the form, not here')
    .setWarningOnly(true);
  return sh;
}

/** Shows the TPW columns + Record ID, Data Flags, Submitted By; hides technical ones. */
function applyColumnVisibility_(sh) {
  sh.showColumns(1, REC.HEADERS.length);
  REC.HIDDEN.forEach(h => sh.hideColumns(C[h] + 1));
}

// ───────────────────────────── Triggers ─────────────────────────────

/** Form-submit trigger: fires for new responses AND edited responses. */
function onTpwFormSubmit(e) {
  const response = e && e.response;
  if (!response) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let rows, previousCount;
  try {
    rows = recordsFromResponse_(response, mapIndex_(readMap_()), today_());
    previousCount = replaceResponseRecords_(response.getId(), rows);
  } finally {
    lock.releaseLock();
  }

  // While synthetic data is being generated, the generator refreshes dashboards once at the end.
  if (props_().getProperty('SYN_STATE') !== 'running') afterRecordsChanged_();

  const isSynthetic = rows.some(r => String(r[C['Notes']]).indexOf(SYNTHETIC_TAG) >= 0);
  if (REC.SEND_SUMMARY_EMAIL && !isSynthetic) {
    try {
      sendSubmissionSummary_(response, rows, previousCount > 0);
    } catch (err) {
      console.warn('Summary email failed: ' + err);
    }
  }
}

/** Daily: move statuses forward as dates pass, then send due reminders. */
function dailyTpwRefresh() {
  refreshStatuses();
  if (REC.SEND_REMINDER_EMAIL) sendDueReminders_();
}

// ───────────────────────────── Response → records ─────────────────────────────

function mapIndex_(map) {
  const idx = {};
  map.forEach(r => {
    idx[mapKey_(r.entry, r.section, r.chain, r.slot, r.field)] = String(r.itemId);
  });
  return idx;
}

function mapKey_(entry, section, chain, slot, field) {
  const s = slot === '' || slot === null || slot === undefined ? '' : Number(slot);
  return [Number(entry), section, chain || '', s, field].join('|');
}

/**
 * Converts one form response into one record per yard (or one per cancelled entry).
 * Follows the respondent's actual path through the form, so answers left over
 * on pages they no longer visit are ignored.
 */
function recordsFromResponse_(response, idx, today) {
  const answers = {};
  response.getItemResponses().forEach(ir => {
    answers[String(ir.getItem().getId())] = ir.getResponse();
  });
  const get = (entry, section, field, chain, slot) => {
    const id = idx[mapKey_(entry, section, chain, slot, field)];
    const v = id === undefined ? undefined : answers[id];
    return v === undefined || v === null ? '' : String(v).trim();
  };

  const responseId = response.getId();
  const submittedBy = safe_(() => response.getRespondentEmail(), '');
  const editLink = safe_(() => response.getEditResponseUrl(), '');
  const submittedAt = safe_(() => response.getTimestamp(), new Date());
  const submittedDay = startOfDay_(submittedAt);

  const org = get(0, 'start', 'org');
  const notes = get(0, 'notes', 'notes');
  const submittedByShown = notes.indexOf(SYNTHETIC_TAG) >= 0 ? '(synthetic)' : submittedBy;
  const M = CFG.MAX_LOCATIONS;
  const records = [];

  let program = '';
  let facility = '';
  let variant = 'program'; // which version of the program-details page this entry used

  for (let w = 1; w <= CFG.MAX_ENTRIES; w++) {
    if (variant === 'program') program = get(w, 'head', 'program_name', variant);
    if (variant !== 'dates') facility = get(w, 'head', 'facility', variant);

    const start = parseDate_(get(w, 'head', 'start_date', variant));
    const end = parseDate_(get(w, 'head', 'end_date', variant));
    const endedAnswer = get(w, 'head', 'ended', variant);

    const base = {
      responseId, submittedBy: submittedByShown, editLink, org, program, facility, start, end, notes, entry: w,
    };

    if (endedAnswer === CHOICES.CANCELLED) {
      records.push(Object.assign({}, base, { ordinal: 1, yard: '', cancelled: true, flags: [] }));
    } else {
      const chain = endedAnswer === CHOICES.ENDED ? 'ended' : 'open';
      const count = Math.min(Math.max(Number(get(w, 'count', 'yard_count', chain)) || 1, 1), M);

      for (let n = 1; n <= count; n++) {
        const slot = M - count + n;
        const flags = [];
        const yard = get(w, 'location', 'yard', chain, slot);
        const participants = toNumber_(get(w, 'location', 'participants', chain, slot));
        const completed = chain === 'ended' ? toNumber_(get(w, 'location', 'completed', chain, slot)) : '';
        const hours = toNumber_(get(w, 'location', 'hours', chain, slot));

        if (count > 1 && !yard) flags.push('Yard name missing');
        if (completed !== '' && participants !== '' && completed > participants) {
          flags.push('More completions than participants');
        }
        if (chain === 'ended' && end && end >= submittedDay) {
          flags.push('Marked as ended, but end date was not in the past');
        }
        if (chain === 'open' && end && end < submittedDay) {
          flags.push('Marked as not ended, but end date had passed');
        }

        records.push(Object.assign({}, base, {
          ordinal: n, yard, participants, completed, hours, cancelled: false, flags,
        }));
      }
    }

    // Where does the next entry start? (carries forward what didn't change)
    if (w === CFG.MAX_ENTRIES) break;
    const next = get(w, 'next', 'next');
    if (next === CHOICES.NEXT_DATES) variant = 'dates';
    else if (next === CHOICES.NEXT_FACILITY) variant = 'facility';
    else if (next === CHOICES.NEXT_PROGRAM) variant = 'program';
    else break;
  }

  const idPrefix = 'TPW-' + shortHash_(responseId);
  return records.map(r => toRow_(r, idPrefix, today));
}

function toRow_(r, idPrefix, today) {
  const flags = r.flags.slice();
  if (r.start && r.end && r.end < r.start) flags.push('End date is before start date');

  const status = computeStatus_(r.cancelled, r.start, r.end, today);
  const participantHours =
    r.completed !== '' && r.completed !== undefined && r.hours !== '' && r.hours !== undefined
      ? r.completed * r.hours
      : '';

  const row = new Array(REC.HEADERS.length).fill('');
  row[C['Record ID']] = idPrefix + '-E' + r.entry + '-Y' + r.ordinal;
  row[C['CDCR Facility']] = r.facility;
  row[C['Yard']] = r.yard;
  row[C['Organization Name']] = r.org;
  row[C['Program Name']] = r.program;
  row[C['Status']] = status;
  row[C['Start Date']] = r.start || '';
  row[C['End Date']] = r.end || '';
  row[C['Total Programming Hours']] = r.cancelled ? '' : r.hours;
  row[C['Number of Participants']] = r.cancelled ? '' : r.participants;
  row[C['Number of Participants Completed']] = r.cancelled ? '' : r.completed;
  row[C['Total Participant Programming Hours']] = participantHours;
  row[C['Program Year']] = r.start ? r.start.getFullYear() : '';
  row[C['Notes']] = r.notes;
  row[C['Needs Final Numbers']] = needsFinalNumbers_(status, row) ? 'Yes' : '';
  row[C['Data Flags']] = flags.join('; ');
  row[C['Submitted By']] = r.submittedBy;
  row[C['Last Updated']] = new Date();
  row[C['Response ID']] = r.responseId;
  row[C['Edit Link']] = r.editLink;
  row[C['Reminder Sent']] = '';
  return row;
}

function computeStatus_(cancelled, start, end, today) {
  if (cancelled) return 'Cancelled';
  if (!start || !end) return '';
  if (today < start) return 'Planned';
  if (today <= end) return 'In Progress';
  return 'Completed';
}

function needsFinalNumbers_(status, row) {
  if (status !== 'Completed') return false;
  return ['Total Programming Hours', 'Number of Participants', 'Number of Participants Completed']
    .some(h => row[C[h]] === '' || row[C[h]] === null || row[C[h]] === undefined);
}

// ───────────────────────────── Writing to the sheet ─────────────────────────────

/** Replaces all records of one response (new or edited), keeping reminder history. */
function replaceResponseRecords_(responseId, newRows) {
  const sh = recordsSheet_();
  const existing = readRecordRows_(sh);

  const reminderById = {};
  existing.forEach(r => {
    if (r[C['Response ID']] === responseId && r[C['Reminder Sent']]) {
      reminderById[r[C['Record ID']]] = r[C['Reminder Sent']];
    }
  });
  newRows.forEach(r => {
    if (reminderById[r[C['Record ID']]]) r[C['Reminder Sent']] = reminderById[r[C['Record ID']]];
  });

  const kept = existing.filter(r => r[C['Response ID']] !== responseId);
  const all = kept.concat(newRows);
  markDuplicates_(all);
  writeRecordRows_(sh, all, existing.length);
  return existing.length - kept.length; // > 0 means this was an edit
}

/** Re-creates every record from every response (safe to run any time). */
function rebuildAllRecords() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = recordsSheet_();
    const existing = readRecordRows_(sh);
    const reminderById = {};
    existing.forEach(r => {
      if (r[C['Reminder Sent']]) reminderById[r[C['Record ID']]] = r[C['Reminder Sent']];
    });

    const idx = mapIndex_(readMap_());
    const today = today_();
    let rows = [];
    getForm_().getResponses().forEach(resp => {
      rows = rows.concat(recordsFromResponse_(resp, idx, today));
    });
    rows.forEach(r => {
      if (reminderById[r[C['Record ID']]]) r[C['Reminder Sent']] = reminderById[r[C['Record ID']]];
    });
    markDuplicates_(rows);
    writeRecordRows_(sh, rows, existing.length);
  } finally {
    lock.releaseLock();
  }
  afterRecordsChanged_();
}

/**
 * Flags every record that exactly repeats an earlier one (same organization, program,
 * facility, yard, start and end date). Rows are in submission order – edited responses
 * move to the end – so the most recently submitted copy is the one flagged.
 * Recomputed on every write, so flags clear once the extra response is deleted or changed.
 */
function markDuplicates_(rows) {
  const firstByKey = {};
  rows.forEach(r => {
    const flags = String(r[C['Data Flags']] || '').split('; ')
      .filter(f => f && f.indexOf(DUP_FLAG) !== 0);
    if (r[C['Status']] !== 'Cancelled') {
      const key = duplicateKey_(r);
      if (firstByKey[key]) flags.push(DUP_FLAG + firstByKey[key]);
      else firstByKey[key] = r[C['Record ID']];
    }
    r[C['Data Flags']] = flags.join('; ');
  });
}

function duplicateKey_(r) {
  const text = v => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const day = d => (d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '');
  return [
    text(r[C['Organization Name']]), text(r[C['Program Name']]), text(r[C['CDCR Facility']]),
    text(r[C['Yard']]), day(r[C['Start Date']]), day(r[C['End Date']]),
  ].join('|');
}

/** Lets later steps (dashboard data) update whenever records change. */
function afterRecordsChanged_() {
  if (typeof refreshDashboardData !== 'function') return;
  try {
    refreshDashboardData();
  } catch (err) {
    console.warn('Dashboard data refresh failed: ' + err);
  }
}

/** Recalculates Status and Needs Final Numbers for every record (run daily). */
function refreshStatuses() {
  const sh = recordsSheet_();
  const rows = readRecordRows_(sh);
  if (!rows.length) return;
  const today = today_();

  rows.forEach(r => {
    const start = r[C['Start Date']] instanceof Date ? startOfDay_(r[C['Start Date']]) : null;
    const end = r[C['End Date']] instanceof Date ? startOfDay_(r[C['End Date']]) : null;
    const status = computeStatus_(r[C['Status']] === 'Cancelled', start, end, today);
    r[C['Status']] = status;
    r[C['Needs Final Numbers']] = needsFinalNumbers_(status, r) ? 'Yes' : '';
  });

  sh.getRange(2, C['Status'] + 1, rows.length, 1).setValues(rows.map(r => [r[C['Status']]]));
  sh.getRange(2, C['Needs Final Numbers'] + 1, rows.length, 1)
    .setValues(rows.map(r => [r[C['Needs Final Numbers']]]));
  afterRecordsChanged_();
}

function readRecordRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, REC.HEADERS.length).getValues();
}

function writeRecordRows_(sh, rows, previousCount) {
  if (previousCount > 0) sh.getRange(2, 1, previousCount, REC.HEADERS.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, REC.HEADERS.length).setValues(rows);
}

// ───────────────────────────── Summary email after each submission ─────────────────────────────

function sendSubmissionSummary_(response, newRows, isEdit) {
  if (!newRows.length) return;
  const to = safe_(() => response.getRespondentEmail(), '');
  const org = String(newRows[0][C['Organization Name']]);
  const contact = orgContacts_()[org.toLowerCase()] || '';
  const recipient = to || contact;
  if (!recipient) return;

  const all = readRecordRows_(recordsSheet_());
  // Current year; or, if the org has nothing this year yet (e.g. backfilling), its latest year.
  let year = today_().getFullYear();
  if (orgStats_(all, org, year).runs === 0) {
    const years = all
      .filter(r => String(r[C['Organization Name']]).toLowerCase() === org.toLowerCase() && r[C['Status']] !== 'Cancelled')
      .map(r => Number(r[C['Program Year']]))
      .filter(y => y > 0);
    if (years.length) year = Math.max.apply(null, years);
  }
  const isCurrentYear = year === today_().getFullYear();
  const now = orgStats_(all, org, year);
  const prev = orgStats_(all, org, year - 1);
  const n = newRows.filter(r => r[C['Status']] !== 'Cancelled').length;

  const lines = [];
  lines.push(
    '<p style="font-size:16px"><b>Thanks, ' + esc_(org) + '!</b> ' +
      n + ' yard record' + (n === 1 ? '' : 's') + (isEdit ? ' successfully updated.' : ' successfully added.') +
      '</p>'
  );
  const totals = [
    fmtNum_(now.runs) + ' run' + (now.runs === 1 ? '' : 's') + (now.planned ? ' (' + now.planned + ' planned)' : ''),
    fmtNum_(now.facilities) + ' facilit' + (now.facilities === 1 ? 'y' : 'ies'),
  ];
  if (now.participants) totals.push(fmtNum_(now.participants) + ' participants');
  if (now.participantHours) totals.push(fmtNum_(now.participantHours) + ' participant hours');
  lines.push(
    '<p><b>' + year + (isCurrentYear ? ' so far' : '') + ':</b> ' + totals.join(' · ') + '</p>'
  );
  if (now.rate !== null) {
    let compare = '';
    if (prev.rate !== null) {
      const a = Math.round(now.rate * 100);
      const b = Math.round(prev.rate * 100);
      compare = a > b ? ' · up from ' + b + '% in ' + (year - 1)
        : a < b ? ' · down from ' + b + '% in ' + (year - 1)
        : ' · same as ' + (year - 1);
    }
    lines.push(
      '<p><b>Total completion rate for ' + year + ':</b> ' + Math.round(now.rate * 100) + '% (' + fmtNum_(now.rateCompleted) + ' of ' +
        fmtNum_(now.rateEnrolled) + ' in finished programs)' + compare + '</p>'
    );
  }

  const editLink = safe_(() => response.getEditResponseUrl(), '');
  const flagged = newRows.filter(r => r[C['Data Flags']]);
  if (flagged.length) {
    lines.push(
      '<p><b>Some answers need a second look</b><br>' +
        'We spotted a few things that don’t add up. If they’re typos, please fix them in the form. ' +
        'If they’re correct, you can ignore this.</p>'
    );
    lines.push('<ul>' +
      flagged.map(r => '<li>' + esc_(describeRow_(r)) + '<br>' +
        String(r[C['Data Flags']]).split('; ').map(flagHelp_).join('<br><br>') + '</li>').join('') +
      '</ul>');
    if (editLink) lines.push('<p><a href="' + editLink + '">Fix these in the form →</a></p>');
  }

  const links = [];
  if (REC.DASHBOARD_URL) links.push('<a href="' + REC.DASHBOARD_URL + '">View your dashboard →</a>');
  if (editLink && !flagged.length) links.push('<a href="' + editLink + '">Edit this response</a>');
  if (links.length) lines.push('<p>' + links.join(' &nbsp;·&nbsp; ') + '</p>');

  const options = { htmlBody: lines.join('\n'), name: 'TPW Program Reporting' };
  if (contact && contact.toLowerCase() !== recipient.toLowerCase()) options.cc = contact;

  MailApp.sendEmail(recipient, 'TPW: thanks for your update, ' + org, htmlToText_(lines.join('\n')), options);
}

/** Year totals for one organization (Program Year = year of the start date). */
function orgStats_(rows, org, year) {
  const mine = rows.filter(r =>
    String(r[C['Organization Name']]).toLowerCase() === org.toLowerCase() &&
    Number(r[C['Program Year']]) === year &&
    r[C['Status']] !== 'Cancelled'
  );
  const num = v => (typeof v === 'number' ? v : 0);
  const notPlanned = mine.filter(r => r[C['Status']] !== 'Planned');

  let enrolled = 0;
  let completed = 0;
  mine.forEach(r => {
    const p = r[C['Number of Participants']];
    const c = r[C['Number of Participants Completed']];
    if (r[C['Status']] === 'Completed' && typeof p === 'number' && typeof c === 'number') {
      enrolled += p;
      completed += c;
    }
  });

  return {
    runs: mine.length,
    planned: mine.length - notPlanned.length,
    facilities: new Set(mine.map(r => r[C['CDCR Facility']]).filter(Boolean)).size,
    participants: notPlanned.reduce((s, r) => s + num(r[C['Number of Participants']]), 0),
    participantHours: mine.reduce((s, r) => s + num(r[C['Total Participant Programming Hours']]), 0),
    rate: enrolled > 0 ? completed / enrolled : null,
    rateEnrolled: enrolled,   // participants in finished runs that have both numbers
    rateCompleted: completed,
  };
}

// ───────────────────────────── Reminder the day after the end date ─────────────────────────────

/**
 * Sends one email per organization listing every run that has ended but is
 * missing final numbers, and that hasn't been reminded yet. Runs daily.
 */
function sendDueReminders_() {
  const sh = recordsSheet_();
  const rows = readRecordRows_(sh);
  if (!rows.length) return;

  const contacts = orgContacts_();
  const today = today_();
  const byOrg = {};

  rows.forEach((r, i) => {
    if (r[C['Needs Final Numbers']] !== 'Yes' || r[C['Reminder Sent']]) return;
    if (String(r[C['Notes']]).indexOf(SYNTHETIC_TAG) >= 0) return; // never remind about test data
    const end = r[C['End Date']] instanceof Date ? startOfDay_(r[C['End Date']]) : null;
    if (!end || today <= end) return; // only from the day after the end date

    const org = String(r[C['Organization Name']]);
    const email = contacts[org.toLowerCase()];
    if (!email) {
      console.warn('No Reminder Email for "' + org + '" on the TPW Constants tab; reminder postponed.');
      return;
    }
    (byOrg[org] = byOrg[org] || { email, runs: {} });
    // Group yards of the same run (same response + entry) together.
    const runKey = r[C['Response ID']] + '|' + String(r[C['Record ID']]).replace(/-Y\d+$/, '');
    (byOrg[org].runs[runKey] = byOrg[org].runs[runKey] || []).push(i);
  });

  const sentRows = [];
  Object.keys(byOrg).forEach(org => {
    const { email, runs } = byOrg[org];
    const items = Object.values(runs).map(idxs => {
      const first = rows[idxs[0]];
      const yards = idxs.map(i => rows[i][C['Yard']]).filter(Boolean);
      const link = first[C['Edit Link']];
      return '<li><b>' + esc_(first[C['Program Name']]) + '</b> at ' + esc_(first[C['CDCR Facility']]) +
        (yards.length ? ' (' + esc_(yards.join(', ')) + ')' : '') +
        ', ' + fmtDate_(first[C['Start Date']]) + ' – ' + fmtDate_(first[C['End Date']]) +
        (first[C['Submitted By']] ? '<br><span style="color:#666">Submitted by ' + esc_(first[C['Submitted By']]) + '</span>' : '') +
        (link ? '<br><a href="' + link + '">Add the final numbers →</a>' : '') +
        '</li>';
    });

    const html =
      '<p>Hello ' + esc_(org) + ',</p>' +
      '<p>The following program run' + (items.length === 1 ? ' has' : 's have') + ' ended. ' +
      'Please add the final numbers: total programming hours, number of participants, and number of participants completed.</p>' +
      '<ul>' + items.join('') + '</ul>' +
      '<p>In the form, set "Has this program run already ended?" to <b>Yes</b> and fill in each yard’s numbers. ' +
      'If the program was cancelled, choose <b>It was cancelled</b> instead.</p>' +
      '<p>Thank you!<br>TPW</p>';

    try {
      MailApp.sendEmail(email, 'TPW: please add final numbers for ' + items.length + ' completed program run' +
        (items.length === 1 ? '' : 's'), htmlToText_(html), { htmlBody: html, name: 'TPW Program Reporting' });
      Object.values(runs).forEach(idxs => sentRows.push(...idxs));
    } catch (err) {
      console.warn('Reminder to ' + email + ' failed: ' + err);
    }
  });

  sentRows.forEach(i => sh.getRange(i + 2, C['Reminder Sent'] + 1).setValue(today));
}

/** Organization → Reminder Email, from the TPW Constants tab (keys are lowercase). */
function orgContacts_() {
  const sh = ss_().getSheetByName(CFG.CONSTANTS_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, CFG.ORG_NAME_COL, sh.getLastRow() - 1, 2).getValues().forEach(([name, email]) => {
    const n = String(name).trim().replace(/\s+/g, ' ').toLowerCase();
    if (n && String(email).trim()) out[n] = String(email).trim();
  });
  return out;
}

/** Partner-facing explanation of one flag; unknown flags are shown as written. */
function flagHelp_(flag) {
  if (flag.indexOf(DUP_FLAG) === 0) {
    return '<b>This run was already reported</b> (same program, facility, yard and dates as record ' +
      esc_(flag.slice(DUP_FLAG.length)) + '). If you meant to update that run, edit your original response ' +
      'instead, then reply to this email so we can remove this copy. If these are separate runs, you can ignore this.';
  }
  return FLAG_HELP[flag] || esc_(flag);
}

function describeRow_(r) {
  return [r[C['Program Name']], r[C['CDCR Facility']], r[C['Yard']]].filter(Boolean).join(' · ');
}

function fmtNum_(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function fmtDate_(d) {
  return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy') : String(d || '');
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlToText_(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<a href="([^"]+)">([^<]+)<\/a>/gi, '$2: $1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ───────────────────────────── Helpers ─────────────────────────────

function today_() {
  return startOfDay_(new Date());
}

function startOfDay_(d) {
  const tz = Session.getScriptTimeZone();
  const s = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return parseDate_(s);
}

/** Form date answers arrive as "YYYY-MM-DD". */
function parseDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function toNumber_(s) {
  if (s === '' || s === null || s === undefined) return '';
  const n = Number(String(s).replace(/,/g, ''));
  return isNaN(n) ? '' : n;
}

function shortHash_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s));
  return bytes.slice(0, 4).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function safe_(fn, fallback) {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}