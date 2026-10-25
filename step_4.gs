/**
 * TPW Collective Impact – STEP 4: impact dashboards
 *
 * Serves the TPW impact dashboards as a web app from this same Apps Script project,
 * reading live from the "TPW Records" tab:
 *
 *  • All member organizations – aggregate results; individual organizations not identified.
 *  • One organization – its programs, results over time, and a programs table.
 *  • One program – its trend and prison-by-prison results.
 *
 * Each page has All time / this year toggles, quarter / program year charts and a CSV download.
 *
 * WHO SEES WHAT
 *  Google doesn't tell a web app who is viewing it unless they're in the owner's Google
 *  Workspace, so access works by private links instead of sign-in:
 *   • each organization gets its own link, showing only its pages and the aggregate page;
 *   • TPW gets an admin link, showing every organization.
 *  Anyone with a link sees that page, so share each link only with its organization.
 *  Links are listed on the "TPW Dashboard Links" tab and can be replaced from the menu.
 *
 *  Also keeps a "TPW Impact Summary" tab (organization × program year) up to date in the sheet.
 *
 * HOW TO INSTALL (same Apps Script project as Steps 1–3)
 *  1. Extensions → Apps Script → "+" next to Files → Script. Name it Step4_Dashboard. Paste this file.
 *  2. "+" next to Files → HTML. Name it Dashboard (exactly). Paste Dashboard.html. Save.
 *  3. Deploy → New deployment → type "Web app". Execute as: Me. Who has access: Anyone. Deploy,
 *     and copy the Web app URL (ends in /exec).
 *  4. Reload the sheet → TPW Tools → "Set up dashboards (Step 4)" and paste the URL.
 *  After changing this file or Dashboard.html: Deploy → Manage deployments → edit → Version: New version.
 */

const DASH = {
  HTML_FILE: 'Dashboard',
  LINKS_SHEET: 'TPW Dashboard Links',
  SUMMARY_SHEET: 'TPW Impact Summary',
  TITLE: 'TPW Impact Dashboard',

  // Estimates shown on every page (see the footnotes on the dashboard)
  CREDIT_HOURS: 52,      // every 52 participant hours delivered …
  CREDIT_DAYS: 10,       // … earn about 10 days of rehabilitative credit
  COST_PER_YEAR: 21534,  // taxpayer cost of one year in prison (USD)

  SUMMARY_HEADERS: [
    'Organization', 'Program Year', 'Programs', 'Prisons', 'Participants', 'Participants Completed',
    'Completion Rate', 'Participant Hours Delivered', 'Rehab Credits (days, est.)', 'Taxpayer Savings (est.)',
  ],
};

const DASH_KEYS = {
  URL: 'DASH_URL',             // the deployed web app URL (/exec)
  ADMIN: 'DASH_ADMIN_KEY',     // key in TPW's admin link
  // One property per organization link: DASH_LINK_<key> = organization name. Separate properties
  // (not one shared list) so two submissions creating links at once can't overwrite each other.
  LINK_PREFIX: 'DASH_LINK_',
};

// ───────────────────────────── Menu hook (called from Step 1's onOpen) ─────────────────────────────

function onOpenStep4_(menu) {
  menu
    .addSeparator()
    .addItem('Set up dashboards (Step 4)', 'setupDashboards')
    .addItem('Show dashboard links', 'showDashboardLinks')
    .addItem('Replace a dashboard link', 'replaceDashboardLink')
    .addItem('Refresh impact summary', 'refreshDashboardData');
}

// ───────────────────────────── Setup and links ─────────────────────────────

function setupDashboards() {
  const ui = SpreadsheetApp.getUi();
  if (!ss_().getSheetByName(REC.SHEET)) {
    ui.alert('Run TPW Tools → "Set up records (Step 2)" first.');
    return;
  }
  const current = dashboardUrl_();
  const answer = ui.prompt(
    'Dashboard web app URL',
    'In Apps Script: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone). ' +
      'Paste the Web app URL that ends in /exec.' + (current ? '\n\nCurrent: ' + current + '\n(Leave empty to keep it.)' : ''),
    ui.ButtonSet.OK_CANCEL
  );
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const url = answer.getResponseText().trim() || current;
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    ui.alert('That doesn’t look like a web app URL. It should start with https://script.google.com/ and end in /exec.');
    return;
  }
  props_().setProperty(DASH_KEYS.URL, url);
  ensureDashboardKeys_();
  writeLinksSheet_();
  refreshDashboardData();
  ss_().setActiveSheet(ss_().getSheetByName(DASH.LINKS_SHEET));
  ui.alert(
    'Dashboards are set up',
    'Each organization’s private link is on the "' + DASH.LINKS_SHEET + '" tab, with TPW’s admin link at the top. ' +
      'Summary emails now link partners to their own dashboard.',
    ui.ButtonSet.OK
  );
}

function showDashboardLinks() {
  if (!dashboardUrl_()) {
    SpreadsheetApp.getUi().alert('Run TPW Tools → "Set up dashboards (Step 4)" first.');
    return;
  }
  ensureDashboardKeys_();
  writeLinksSheet_();
  ss_().setActiveSheet(ss_().getSheetByName(DASH.LINKS_SHEET));
}

/** Gives one organization (or TPW's admin link) a new key; the old link stops working. */
function replaceDashboardLink() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt(
    'Replace a dashboard link',
    'Type the organization name exactly as on the links tab, or TPW for the admin link. ' +
      'The old link stops working immediately.',
    ui.ButtonSet.OK_CANCEL
  );
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const name = answer.getResponseText().trim();
  if (!name) return;

  if (norm_(name) === 'tpw') {
    props_().setProperty(DASH_KEYS.ADMIN, newDashboardKey_());
  } else {
    const old = orgKeys_()[norm_(name)];
    if (!old) {
      ui.alert('No dashboard link found for "' + name + '".');
      return;
    }
    const org = props_().getProperty(DASH_KEYS.LINK_PREFIX + old);
    props_().deleteProperty(DASH_KEYS.LINK_PREFIX + old);
    addOrgKey_(org);
  }
  writeLinksSheet_();
  ui.alert('Done. The new link is on the "' + DASH.LINKS_SHEET + '" tab.');
}

/** Private dashboard link for one organization ('' until Step 4 is set up). Used by Step 2's emails. */
function dashboardLinkFor_(org) {
  const url = dashboardUrl_();
  if (!url || !norm_(org)) return '';
  let key = orgKeys_()[norm_(org)];
  if (!key) {
    key = addOrgKey_(org);
    appendLinkRow_(org, key);
  }
  return url + '?k=' + key;
}

function dashboardUrl_() {
  return props_().getProperty(DASH_KEYS.URL) || '';
}

/** { normalized organization name: key } for every organization link. */
function orgKeys_() {
  const all = props_().getProperties();
  const keys = {};
  Object.keys(all).forEach(p => {
    if (p.indexOf(DASH_KEYS.LINK_PREFIX) === 0) keys[norm_(all[p])] = p.slice(DASH_KEYS.LINK_PREFIX.length);
  });
  return keys;
}

function addOrgKey_(org) {
  const key = newDashboardKey_();
  props_().setProperty(DASH_KEYS.LINK_PREFIX + key, org);
  return key;
}

function newDashboardKey_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/** Makes sure TPW and every known organization have a key. */
function ensureDashboardKeys_() {
  if (!props_().getProperty(DASH_KEYS.ADMIN)) props_().setProperty(DASH_KEYS.ADMIN, newDashboardKey_());
  const keys = orgKeys_();
  dashboardOrgNames_().forEach(name => {
    if (!keys[norm_(name)]) addOrgKey_(name);
  });
}

/** Organizations on the TPW Constants tab plus any found in the records, A–Z. */
function dashboardOrgNames_() {
  const byKey = {};
  const constants = ss_().getSheetByName(CFG.CONSTANTS_SHEET);
  if (constants) readList_(constants, CFG.ORG_NAME_COL, CFG.ORG_ACTIVE_COL).forEach(n => { byKey[norm_(n)] = n; });
  dashboardRows_().forEach(r => { if (!byKey[norm_(r.org)]) byKey[norm_(r.org)] = r.org; });
  return Object.keys(byKey).filter(Boolean).map(k => byKey[k]).sort((a, b) => a.localeCompare(b));
}

function writeLinksSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(DASH.LINKS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DASH.LINKS_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['Organization', 'Private dashboard link', 'Reminder Email']])
      .setFontWeight('bold').setBackground('#e8eaed');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 260);
    sh.setColumnWidth(2, 640);
    sh.setColumnWidth(3, 240);
    sh.protect().setDescription('Written by the TPW scripts – use TPW Tools → "Replace a dashboard link"').setWarningOnly(true);
  }
  const url = dashboardUrl_();
  const keys = orgKeys_();
  const contacts = orgContacts_();
  const rows = [['TPW – all organizations (admin)', url + '?k=' + props_().getProperty(DASH_KEYS.ADMIN), '']];
  dashboardOrgNames_().forEach(name => {
    const key = keys[norm_(name)];
    if (key) rows.push([name, url + '?k=' + key, contacts[norm_(name)] || '']);
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

/** Adds one organization's new link to the links tab (cheaper than rewriting it during a form submit). */
function appendLinkRow_(org, key) {
  const sh = ss_().getSheetByName(DASH.LINKS_SHEET);
  if (sh) sh.appendRow([org, dashboardUrl_() + '?k=' + key, orgContacts_()[norm_(org)] || '']);
}

// ───────────────────────────── Web app ─────────────────────────────

function doGet(e) {
  const p = (e && e.parameter) || {};
  const access = dashboardAccess_(p.k);
  if (!access) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:24px">This dashboard link isn’t valid. Please ask TPW for a new one.</p>'
    ).setTitle(DASH.TITLE);
  }
  if (p.download) return dashboardDownload_(access, p);

  const t = HtmlService.createTemplateFromFile(DASH.HTML_FILE);
  // Escaping "<" keeps the data from closing the <script> tag it's embedded in.
  t.data = JSON.stringify(dashboardPayload_(access)).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(DASH.TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** { admin: true } for TPW's key, { org } for an organization's key, null otherwise. */
function dashboardAccess_(key) {
  if (!key) return null;
  if (key === props_().getProperty(DASH_KEYS.ADMIN)) return { admin: true, key };
  const org = props_().getProperty(DASH_KEYS.LINK_PREFIX + key);
  return org ? { org, key } : null;
}

/**
 * Everything the page needs, calculated here so the page only draws it.
 * Organizations only receive their own records; the aggregate page is sent as totals.
 */
function dashboardPayload_(access) {
  const today = today_();
  const year = today.getFullYear();
  const rows = dashboardRows_();
  const byOrg = groupBy_(rows, r => norm_(r.org));
  const names = access.admin
    ? Array.from(byOrg.values()).map(g => g[0].org).sort((a, b) => a.localeCompare(b))
    : [access.org];

  const orgs = names.map((name, i) => {
    const mine = byOrg.get(norm_(name)) || [];
    const programs = Array.from(groupBy_(mine, r => norm_(r.program)).values())
      .map(g => ({ name: g[0].program, view: programView_(g, today, year) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p, j) => Object.assign({ id: i + '-' + j }, p));
    return { id: String(i), name, view: view_(mine, today, year), programs };
  });

  return {
    year,
    admin: !!access.admin,
    base: dashboardUrl_() + '?k=' + encodeURIComponent(access.key),
    synthetic: rows.some(r => r.synthetic),
    overview: view_(rows, today, year),
    orgs,
  };
}

function view_(rows, today, year) {
  return {
    all: impact_(rows),
    ytd: impact_(rows.filter(r => r.start.getFullYear() === year)),
    series: series_(rows, today),
  };
}

function programView_(rows, today, year) {
  const ytd = rows.filter(r => r.start.getFullYear() === year);
  return Object.assign(view_(rows, today, year), {
    courseHours: courseHours_(rows),
    prisons: { all: prisonTable_(rows), ytd: prisonTable_(ytd) },
  });
}

function prisonTable_(rows) {
  return Array.from(groupBy_(rows, r => norm_(r.facility)).values())
    .map(g => Object.assign({ name: g[0].facility, courseHours: courseHours_(g) }, impact_(g)))
    .sort((a, b) => b.participants - a.participants);
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

/** Results by start-date quarter and by program year, from the first run up to today. */
function series_(rows, today) {
  const out = { quarter: [], year: [] };
  if (!rows.length) return out;
  const first = new Date(Math.min.apply(null, rows.map(r => r.start.getTime())));
  const quarterOf = d => Math.floor(d.getMonth() / 3);
  const point = (label, year, subset) => {
    const m = impact_(subset);
    return { label, year, hours: m.participantHours, completed: m.completed, creditDays: m.creditDays, savings: m.savings };
  };

  for (let y = first.getFullYear(); y <= today.getFullYear(); y++) {
    const inYear = rows.filter(r => r.start.getFullYear() === y);
    out.year.push(point(String(y), y, inYear));
    for (let q = 0; q < 4; q++) {
      if (y === first.getFullYear() && q < quarterOf(first)) continue;
      if (y === today.getFullYear() && q > quarterOf(today)) break;
      out.quarter.push(point(y + ' Q' + (q + 1), y, inYear.filter(r => quarterOf(r.start) === q)));
    }
  }
  return out;
}

/** The most common course length (Total Programming Hours) among the records. */
function courseHours_(rows) {
  const counts = {};
  rows.forEach(r => { if (r.hours) counts[r.hours] = (counts[r.hours] || 0) + 1; });
  const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return best ? Number(best) : null;
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

// ───────────────────────────── CSV downloads ─────────────────────────────

/** ?download=all (TPW only), ?download=org&org=…, ?download=program&org=…&program=… */
function dashboardDownload_(access, p) {
  const kind = String(p.download);
  const org = access.admin ? String(p.org || '') : access.org;
  if (kind === 'all' && !access.admin) return HtmlService.createHtmlOutput('Not available with this link.');

  let rows = readRecordRows_(recordsSheet_());
  if (kind !== 'all') rows = rows.filter(r => norm_(r[C['Organization Name']]) === norm_(org));
  if (kind === 'program') rows = rows.filter(r => norm_(r[C['Program Name']]) === norm_(p.program));

  // The partner-facing columns only (no edit links, emails or internal flags).
  const width = C['Program Year'] + 1;
  const tz = Session.getScriptTimeZone();
  const cell = v => {
    const s = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [REC.HEADERS.slice(0, width)].concat(rows.map(r => r.slice(0, width)))
    .map(r => r.map(cell).join(',')).join('\n');

  const label = kind === 'all' ? 'all organizations' : kind === 'program' ? org + ' ' + p.program : org;
  const fileName = ('TPW ' + label).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.csv';
  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV).downloadAsFile(fileName);
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
