/**
 * TPW Collective Impact – STEP 3: synthetic test data
 *
 * Submits realistic responses THROUGH THE FORM (up to 300 yard records), so they flow through
 * the same pipeline as real data (form → TPW Responses → TPW Records).
 *
 *  • Organizations and program names are real nonprofits that run programs in
 *    California prisons; every number, date and yard is invented.
 *  • Covers every form flow: same program at other dates, same program at
 *    another facility, another program, cancelled runs, 1–3 yards.
 *  • Start dates in the past, present and future.
 *  • Every response is tagged "SYNTHETIC TEST DATA" in Notes. No summary or
 *    reminder emails are sent for tagged data. "Delete synthetic data" removes
 *    exactly these responses, their records, and the organizations it added.
 *
 * HOW TO INSTALL (same Apps Script project as Steps 1 and 2)
 *  1. Extensions → Apps Script → "+" next to Files → Script. Name it Step3_SyntheticData.
 *  2. Paste this file and Save. Also paste the updated Step1_Setup.gs and Step2_Records.gs.
 *  3. Reload the sheet → TPW Tools → "Generate synthetic data".
 *     It runs in the background for a few minutes; you get an email when it is done.
 */

const SYN = {
  MAX_RECORDS: 300,       // stop before the yard records would exceed this
  MAX_SUBMISSIONS: 100,
  START_MIN: [2024, 0, 1], // start dates from Jan 1, 2024 …
  START_MAX: [2027, 11, 31], // … to Dec 31, 2027
  TIME_BUDGET_MS: 2.5 * 60 * 1000,
  WATCHDOG_MS: 8 * 60 * 1000,

  // Program catalogue. Hours, durations, enrollment and completion rates are
  // invented but plausible; facilities lean toward places each group is known to work.
  ORGS: [
    {
      name: 'Defy Ventures',
      programs: [{ name: 'CEO of Your New Life', hours: 176, weeks: [30, 40], enrolled: [40, 45], rate: [0.35, 0.8] }],
      facilities: ['KVSP', 'CTF', 'CCI', 'LAC', 'RJD', 'CIW', 'SVSP', 'VSP', 'ASP'],
    },
    {
      name: 'GRIP Training Institute',
      programs: [
        { name: 'Guiding Rage Into Power', hours: 104, weeks: [52, 70], enrolled: [30, 44], rate: [0.5, 0.85] },
        { name: 'A Breath of Freedom', hours: 24, weeks: [8, 12], enrolled: [15, 25], rate: [0.6, 0.9] },
      ],
      facilities: ['CTF', 'SQ', 'MCSP', 'ASP', 'CMF', 'CCWF', 'SATF'],
    },
    {
      name: 'Enneagram Prison Project',
      programs: [{ name: 'Standard Course', hours: 39, weeks: [12, 14], enrolled: [20, 30], rate: [0.75, 0.95] }],
      facilities: ['SQ', 'CTF', 'CCWF', 'MCSP'],
    },
    {
      name: 'Marin Shakespeare Company',
      programs: [
        { name: 'Shakespeare in Prison', hours: 90, weeks: [36, 40], enrolled: [15, 25], rate: [0.6, 0.85] },
        { name: 'Acting for Veterans', hours: 40, weeks: [12, 20], enrolled: [8, 15], rate: [0.7, 0.9] },
        { name: 'Anger Management', hours: 36, weeks: [12, 16], enrolled: [12, 20], rate: [0.65, 0.9] },
      ],
      facilities: ['SQ', 'MCSP', 'CMF'],
    },
    {
      name: 'The Last Mile',
      programs: [
        { name: 'Web Development', hours: 480, weeks: [50, 52], enrolled: [15, 20], rate: [0.55, 0.8] },
        { name: 'Audio and Video Production', hours: 240, weeks: [24, 26], enrolled: [10, 15], rate: [0.6, 0.85] },
      ],
      facilities: ['SQ', 'CIW'],
    },
    {
      name: 'Prison Yoga Project',
      programs: [{ name: 'Yoga and Mindfulness Immersion', hours: 32, weeks: [12, 16], enrolled: [15, 25], rate: [0.55, 0.85] }],
      facilities: ['SQ', 'RJD', 'CMF', 'VSP', 'CCWF'],
    },
    {
      name: 'Inside Circle',
      programs: [{ name: 'Inside Circles', hours: 100, weeks: [26, 52], enrolled: [15, 30], rate: [0.5, 0.8] }],
      facilities: ['CMF', 'MCSP', 'SQ'],
    },
    {
      name: 'Land Together',
      programs: [{ name: 'Insight Garden Program', hours: 48, weeks: [26, 40], enrolled: [15, 25], rate: [0.6, 0.85] }],
      facilities: ['SQ', 'CTF', 'SVSP', 'VSP', 'CCWF'],
    },
  ],

  // Yards per facility (at most 3).
  // An empty list = facility reported without yards.
  YARDS: {
    ASP: ['A Yard', 'B Yard', 'C Yard'],
    CCI: ['A Yard', 'B Yard', 'C Yard'],
    CIW: [],
    CMF: [],
    LAC: ['A Yard', 'B Yard', 'C Yard'],
    CCWF: ['A Yard', 'B Yard', 'C Yard'],
    CTF: ['North', 'Central', 'South'],
    KVSP: ['A Yard', 'B Yard', 'C Yard'],
    MCSP: ['A Yard', 'B Yard', 'C Yard'],
    RJD: ['A Yard', 'B Yard', 'C Yard'],
    SVSP: ['A Yard', 'B Yard', 'C Yard'],
    SQ: ['North', 'Central', 'South'],
    SATF: ['A Yard', 'B Yard', 'C Yard'],
    VSP: ['A Yard', 'B Yard', 'C Yard'],
  },
};

const SYN_KEYS = {
  STATE: 'SYN_STATE',          // running | done
  NEXT: 'SYN_NEXT',            // next submission number to create
  ADDED_ORGS: 'SYN_ADDED_ORGS',// JSON list of orgs this generator added to TPW Constants
  ATTEMPTS: 'SYN_ATTEMPTS',
  TOTAL: 'SYN_TOTAL',          // number of submissions planned for this run
};

// ───────────────────────────── Menu hook (called from Step 1's onOpen) ─────────────────────────────

function onOpenStep3_(menu) {
  menu
    .addSeparator()
    .addItem('Generate synthetic data', 'generateSyntheticData')
    .addItem('Delete synthetic data', 'deleteSyntheticData');
}

// ───────────────────────────── Generate ─────────────────────────────

function generateSyntheticData() {
  const ui = SpreadsheetApp.getUi();
  const p = props_();
  if (p.getProperty(KEYS.BUILD_STATE) !== 'done') {
    ui.alert('Finish Step 1 first: the form must be fully built.');
    return;
  }
  if (!ss_().getSheetByName(REC.SHEET)) {
    ui.alert('Run TPW Tools → "Set up records (Step 2)" first.');
    return;
  }
  if (p.getProperty(SYN_KEYS.STATE) === 'running') {
    ui.alert('Synthetic data is already being generated. You will get an email when it is done.');
    return;
  }
  if (countSyntheticResponses_() > 0) {
    const a = ui.alert(
      'Synthetic data already exists',
      'Generate another set (up to ' + SYN.MAX_RECORDS + ' records) on top of it? (Choose No, then "Delete synthetic data" to start fresh.)',
      ui.ButtonSet.YES_NO
    );
    if (a !== ui.Button.YES) return;
  }

  addSyntheticOrgs_();
  syncDropdowns(); // script edits don't fire the Constants trigger

  p.setProperty(SYN_KEYS.STATE, 'running');
  p.setProperty(SYN_KEYS.NEXT, '1');
  p.setProperty(SYN_KEYS.TOTAL, String(plannedSubmissionCount_()));
  p.deleteProperty(SYN_KEYS.ATTEMPTS);

  ss_().toast('Generating ' + p.getProperty(SYN_KEYS.TOTAL) + ' synthetic submissions (about ' + SYN.MAX_RECORDS + ' records) in the background. ' +
    'You will get an email when it is done.', 'TPW synthetic data', 15);
  continueSyntheticData();
}

/** Creates submissions in chunks; schedules itself to resume before the time limit. */
function continueSyntheticData() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    clearTriggers_(['continueSyntheticData']);
    const p = props_();
    if (p.getProperty(SYN_KEYS.STATE) !== 'running') return;

    const attempts = Number(p.getProperty(SYN_KEYS.ATTEMPTS) || 0) + 1;
    p.setProperty(SYN_KEYS.ATTEMPTS, String(attempts));
    if (attempts > 40) throw new Error('Synthetic data generation kept failing; see Executions.');

    ScriptApp.newTrigger('continueSyntheticData').timeBased().after(SYN.WATCHDOG_MS).create();

    const started = Date.now();
    const form = getForm_();
    const ctx = syntheticContext_(form);
    let n = Number(p.getProperty(SYN_KEYS.NEXT) || 1);

    const total = Number(p.getProperty(SYN_KEYS.TOTAL) || plannedSubmissionCount_());
    while (n <= total) {
      if (Date.now() - started > SYN.TIME_BUDGET_MS) {
        clearTriggers_(['continueSyntheticData']);
        ScriptApp.newTrigger('continueSyntheticData').timeBased().after(60 * 1000).create();
        return;
      }
      submitSynthetic_(form, ctx, planSubmission_(n));
      n++;
      p.setProperty(SYN_KEYS.NEXT, String(n));
    }

    p.setProperty(SYN_KEYS.STATE, 'done');
    clearTriggers_(['continueSyntheticData']);
    rebuildAllRecords(); // make sure every synthetic response has its records

    const count = readRecordRows_(recordsSheet_())
      .filter(r => String(r[C['Notes']]).indexOf(SYNTHETIC_TAG) >= 0).length;
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'TPW synthetic data is ready',
        total + ' synthetic submissions created, giving ' + count + ' yard records in "' + REC.SHEET + '".\n\n' +
        'Remove them any time with TPW Tools → "Delete synthetic data".');
    } catch (e) {
      console.warn('Could not send the done email: ' + e);
    }
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── Planning one submission ─────────────────────────────

/**
 * Plans one submission as a list of entries. Seeded by the submission number,
 * so a resumed run produces the same data it would have produced in one go.
 */
function planSubmission_(n) {
  const rnd = seededRandom_(n * 7919 + 17);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const weighted = pairs => {
    let r = rnd() * pairs.reduce((s, p) => s + p[1], 0);
    for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  };

  const org = SYN.ORGS[(n - 1) % SYN.ORGS.length]; // spread evenly across organizations
  const today = today_();
  const minStart = new Date(SYN.START_MIN[0], SYN.START_MIN[1], SYN.START_MIN[2]);
  const maxStart = new Date(SYN.START_MAX[0], SYN.START_MAX[1], SYN.START_MAX[2]);
  const entryCount = weighted([[1, 12], [2, 33], [3, 33], [4, 22]]);

  const entries = [];
  let program = pick(org.programs);
  let facility = pick(org.facilities);
  let lastStart = null;
  let variant = 'program';

  for (let w = 1; w <= Math.min(entryCount, CFG.MAX_ENTRIES); w++) {
    // Timing: past (≈60%), current (≈22%), future (≈18%)
    const timing = w > 1 && variant === 'dates' && lastStart
      ? null // other dates at the same place: the previous or next cycle
      : weighted([['past', 60], ['current', 22], ['future', 18]]);
    const weeks = between(program.weeks[0], program.weeks[1]);
    let start;
    if (timing === null) {
      const gap = (weeks + between(2, 10)) * 7;
      const earlier = addDays_(lastStart, -gap);
      start = (rnd() < 0.6 || lastStart > today) && earlier >= minStart ? earlier : addDays_(lastStart, gap);
    } else if (timing === 'past') {
      const latest = addDays_(today, -(weeks * 7 + 14)); // ended at least two weeks ago
      const span = Math.max(0, Math.round((latest - minStart) / 86400000));
      start = addDays_(minStart, between(0, span));
    } else if (timing === 'current') {
      start = addDays_(today, -between(7, Math.max(8, weeks * 7 - 14)));
    } else {
      start = addDays_(today, between(14, 300));
    }
    if (start < minStart) start = minStart;
    if (start > maxStart) start = maxStart;
    const end = addDays_(start, weeks * 7);
    lastStart = start;

    let status;
    if (rnd() < 0.05 && end >= today) status = 'cancelled';
    else if (end < today) status = rnd() < 0.06 ? 'open' : 'ended'; // a few overdue updates
    else status = 'open';

    const yardPool = SYN.YARDS[facility] || [];
    const yardCount = yardPool.length ? weighted([[1, 25], [2, 40], [3, 35]]) : 1;
    const yards = shuffle_(yardPool.slice(), rnd).slice(0, yardCount);
    const enrolledFull = () => between(program.enrolled[0], program.enrolled[1]);

    const locations = [];
    for (let y = 0; y < yardCount; y++) {
      const enrolled = enrolledFull();
      const rate = program.rate[0] + rnd() * (program.rate[1] - program.rate[0]);
      const hours = rnd() < 0.15 ? Math.round(program.hours * (0.8 + rnd() * 0.15)) : program.hours; // lockdowns
      const isCurrent = start <= today;
      locations.push({
        yard: yards[y] || '',
        participants: status === 'ended' ? enrolled : (isCurrent ? (rnd() < 0.85 ? enrolled : '') : (rnd() < 0.5 ? enrolled : '')),
        completed: status === 'ended' ? Math.min(enrolled, Math.round(enrolled * rate)) : '',
        hours: status === 'ended' ? hours : (rnd() < 0.6 ? program.hours : ''),
      });
    }

    entries.push({ variant, program: program.name, facility, start, end, status, locations });

    // What next? Choose a flow, keeping it possible for this organization.
    if (w >= Math.min(entryCount, CFG.MAX_ENTRIES)) break;
    const options = [['dates', 35], ['facility', 40]];
    if (org.programs.length > 1) options.push(['program', 45]);
    variant = weighted(options);
    if (variant === 'facility') {
      const others = org.facilities.filter(f => f !== facility);
      facility = others.length ? pick(others) : facility;
      if (!others.length) variant = 'dates';
    } else if (variant === 'program') {
      const others = org.programs.filter(p => p.name !== program.name);
      program = pick(others);
      facility = pick(org.facilities);
    }
  }

  return { org: org.name, entries };
}

/** How many submissions fit under MAX_RECORDS yard records (plans are deterministic). */
function plannedSubmissionCount_() {
  let records = 0;
  let n = 1;
  for (; n <= SYN.MAX_SUBMISSIONS; n++) {
    const add = planSubmission_(n).entries
      .reduce((s, e) => s + (e.status === 'cancelled' ? 1 : e.locations.length), 0);
    if (records + add > SYN.MAX_RECORDS) break;
    records += add;
  }
  return n - 1;
}

// ───────────────────────────── Submitting through the form ─────────────────────────────

function syntheticContext_(form) {
  const idx = mapIndex_(readMap_());
  const facilityByCode = {};
  readList_(ss_().getSheetByName(CFG.CONSTANTS_SHEET), CFG.FAC_NAME_COL, CFG.FAC_ACTIVE_COL).forEach(name => {
    const m = /\(([^)]+)\)\s*$/.exec(name);
    if (m) facilityByCode[m[1].split(/[-,\s]/)[0]] = name; // "SATF-CSP, Corcoran" → SATF
  });
  return { idx, facilityByCode };
}

function submitSynthetic_(form, ctx, plan) {
  const M = CFG.MAX_LOCATIONS;
  const resp = form.createResponse();
  const add = (entry, section, field, value, chain, slot) => {
    if (value === '' || value === null || value === undefined) return;
    const id = ctx.idx[mapKey_(entry, section, chain, slot, field)];
    if (!id) throw new Error('Form map has no item for ' + [entry, section, field, chain, slot].join(' / '));
    const item = form.getItemById(Number(id));
    let ir;
    switch (item.getType()) {
      case FormApp.ItemType.LIST: ir = item.asListItem().createResponse(String(value)); break;
      case FormApp.ItemType.MULTIPLE_CHOICE: ir = item.asMultipleChoiceItem().createResponse(String(value)); break;
      case FormApp.ItemType.DATE: ir = item.asDateItem().createResponse(value); break;
      case FormApp.ItemType.PARAGRAPH_TEXT: ir = item.asParagraphTextItem().createResponse(String(value)); break;
      default: ir = item.asTextItem().createResponse(String(value));
    }
    resp.withItemResponse(ir);
  };

  add(0, 'start', 'org', plan.org);

  plan.entries.forEach((e, i) => {
    const w = i + 1;
    const v = e.variant;
    const facilityName = ctx.facilityByCode[e.facility];
    if (!facilityName) throw new Error('Facility code ' + e.facility + ' is not in TPW Constants.');

    if (v === 'program') add(w, 'head', 'program_name', e.program, v);
    if (v !== 'dates') add(w, 'head', 'facility', facilityName, v);
    add(w, 'head', 'start_date', e.start, v);
    add(w, 'head', 'end_date', e.end, v);
    add(w, 'head', 'ended',
      e.status === 'cancelled' ? CHOICES.CANCELLED : e.status === 'ended' ? CHOICES.ENDED : CHOICES.OPEN, v);

    if (e.status !== 'cancelled') {
      const chain = e.status === 'ended' ? 'ended' : 'open';
      const k = e.locations.length;
      add(w, 'count', 'yard_count', String(k), chain);
      e.locations.forEach((loc, n) => {
        const slot = M - k + n + 1;
        add(w, 'location', 'yard', loc.yard, chain, slot);
        add(w, 'location', 'participants', loc.participants, chain, slot);
        if (chain === 'ended') add(w, 'location', 'completed', loc.completed, chain, slot);
        add(w, 'location', 'hours', loc.hours, chain, slot);
      });
    }

    if (w < CFG.MAX_ENTRIES) {
      const next = plan.entries[i + 1];
      add(w, 'next', 'next',
        !next ? CHOICES.NEXT_DONE
          : next.variant === 'dates' ? CHOICES.NEXT_DATES
          : next.variant === 'facility' ? CHOICES.NEXT_FACILITY
          : CHOICES.NEXT_PROGRAM);
    }
  });

  add(0, 'notes', 'notes', SYNTHETIC_TAG + ' – generated by Step 3. Safe to delete.');
  resp.submit();
}

// ───────────────────────────── Delete ─────────────────────────────

function deleteSyntheticData() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.alert(
    'Delete synthetic data?',
    'This deletes every response tagged "' + SYNTHETIC_TAG + '", its records, and the organizations the generator ' +
      'added to TPW Constants. Real responses are not touched.',
    ui.ButtonSet.YES_NO
  );
  if (a !== ui.Button.YES) return;

  const p = props_();
  p.setProperty(SYN_KEYS.STATE, 'deleting'); // stops a generator that is still running
  clearTriggers_(['continueSyntheticData']);

  const form = getForm_();
  const notesId = mapIndex_(readMap_())[mapKey_(0, 'notes', '', '', 'notes')];
  let deleted = 0;
  form.getResponses().forEach(r => {
    if (isSyntheticResponse_(r, notesId)) {
      form.deleteResponse(r.getId());
      deleted++;
    }
  });

  deleteSyntheticRawRows_();
  removeSyntheticOrgs_();
  syncDropdowns();
  rebuildAllRecords();
  p.deleteProperty(SYN_KEYS.STATE);
  p.deleteProperty(SYN_KEYS.NEXT);

  ui.alert('Deleted ' + deleted + ' synthetic responses and their records.');
}

function countSyntheticResponses_() {
  const notesId = mapIndex_(readMap_())[mapKey_(0, 'notes', '', '', 'notes')];
  return getForm_().getResponses().filter(r => isSyntheticResponse_(r, notesId)).length;
}

function isSyntheticResponse_(response, notesId) {
  return response.getItemResponses().some(ir =>
    String(ir.getItem().getId()) === String(notesId) && String(ir.getResponse()).indexOf(SYNTHETIC_TAG) >= 0
  );
}

/** Removes tagged rows from the raw (hidden) responses tab. */
function deleteSyntheticRawRows_() {
  const sh = ss_().getSheetByName(CFG.RESPONSES_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const values = sh.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i].some(v => String(v).indexOf(SYNTHETIC_TAG) >= 0)) sh.deleteRow(i + 1);
  }
}

// ───────────────────────────── Organizations in TPW Constants ─────────────────────────────

function addSyntheticOrgs_() {
  const sh = ss_().getSheetByName(CFG.CONSTANTS_SHEET);
  const last = Math.max(sh.getLastRow(), 1);
  const existing = last > 1
    ? sh.getRange(2, CFG.ORG_NAME_COL, last - 1, 1).getValues().flat().map(v => String(v).trim().toLowerCase())
    : [];
  const added = JSON.parse(props_().getProperty(SYN_KEYS.ADDED_ORGS) || '[]');

  // First empty row in the organization columns
  let row = 2;
  while (row <= last && String(sh.getRange(row, CFG.ORG_NAME_COL).getValue()).trim()) row++;

  SYN.ORGS.forEach(o => {
    if (existing.indexOf(o.name.toLowerCase()) >= 0) return;
    sh.getRange(row, CFG.ORG_NAME_COL, 1, 3).setValues([[o.name, '', 'Y']]);
    added.push(o.name);
    row++;
  });
  props_().setProperty(SYN_KEYS.ADDED_ORGS, JSON.stringify(added));
}

function removeSyntheticOrgs_() {
  const added = JSON.parse(props_().getProperty(SYN_KEYS.ADDED_ORGS) || '[]').map(s => s.toLowerCase());
  if (!added.length) return;
  const sh = ss_().getSheetByName(CFG.CONSTANTS_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return;

  const rows = sh.getRange(2, CFG.ORG_NAME_COL, last - 1, 3).getValues();
  const kept = rows.filter(r => String(r[0]).trim() && added.indexOf(String(r[0]).trim().toLowerCase()) < 0);
  sh.getRange(2, CFG.ORG_NAME_COL, last - 1, 3).clearContent();
  if (kept.length) sh.getRange(2, CFG.ORG_NAME_COL, kept.length, 3).setValues(kept);
  props_().deleteProperty(SYN_KEYS.ADDED_ORGS);
}

// ───────────────────────────── Helpers ─────────────────────────────

function seededRandom_(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays_(d, days) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + days);
  return x;
}

function shuffle_(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}