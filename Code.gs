/**
 * TPW Collective Impact – STEP 1 (v2: hierarchical form)
 * Builds the partner-facing Google Form, the dropdown lists tab, and keeps
 * the dropdowns in sync.
 *
 * FORM FLOW (what a partner sees)
 *   Page 1: Organization + Program + Course duration + Facility + Dates + "Has it ended?"
 *   →  "How many yards/locations?" (1–6)
 *   →  one page per yard/location (numbers required if the run has ended)
 *   →  "Is there more to report?"
 *        Same program, same facility, other dates  → a page with just the dates
 *        Same program at another facility         → a page with facility + dates
 *        Another program                          → a page with program + facility + dates
 *        No, I'm done                             → Notes → Submit
 *
 * Skipped levels (program, facility) are carried forward by the Step 2 script,
 * which also turns each yard/location page into one record.
 *
 * HOW TO INSTALL
 *  1. Create a new, blank Google Sheet (e.g. "TPW Program Runs"), signed in to
 *     the Gmail account that will own the form and send reminders.
 *  2. Extensions → Apps Script. Delete the sample code, paste this file, Save.
 *  3. Reload the spreadsheet. A "TPW Tools" menu appears.
 *  4. TPW Tools → "Set up form (first time)". Approve the permissions prompt.
 *     Building takes a few minutes; you get an email with the links when done.
 *  5. Fill in each organization's Reminder Email on the "TPW Constants" tab.
 */

// ───────────────────────────── Configuration ─────────────────────────────

const CFG = {
  CONSTANTS_SHEET: 'TPW Constants',
  RESPONSES_SHEET: 'TPW Responses',
  MAP_SHEET: 'TPW Form Map',
  FORM_TITLE: 'TPW Program Run Report',

  MAX_ENTRIES: 5,     // program + facility + date windows per submission
  MAX_LOCATIONS: 6,   // yards / locations per date window

  BUILD_TIME_BUDGET_MS: 2.5 * 60 * 1000, // pause and resume well before Apps Script's 6-minute limit
  WATCHDOG_MS: 8 * 60 * 1000,            // resume a run that was cut off by the time limit
  MAX_BUILD_ATTEMPTS: 30,
  MAX_LIST_ROWS: 200,

  // TPW Constants layout (1-based columns)
  ORG_NAME_COL: 1,     // A  Organization
  ORG_EMAIL_COL: 2,    // B  Reminder Email
  ORG_ACTIVE_COL: 3,   // C  Active (Y/N)
  FAC_NAME_COL: 5,     // E  CDCR Facility
  FAC_ACTIVE_COL: 6,   // F  Active (Y/N)
};

const SEED_ORGS = [
  'Defy Ventures',
  'Enneagram Prison Project',
  'GRIP Training Institute',
];

const SEED_FACILITIES = [
  'Avenal State Prison (ASP)',
  'California Correctional Institution (CCI)',
  'California Institution for Women (CIW)',
  'California Medical Facility (CMF)',
  'California State Prison, Los Angeles County (LAC)',
  'Central California Women’s Facility (CCWF)',
  'Correctional Training Facility (CTF)',
  'Kern Valley State Prison (KVSP)',
  'Mule Creek State Prison (MCSP)',
  'Richard J. Donovan Correctional Facility (RJD)',
  'Salinas Valley State Prison (SVSP)',
  'San Quentin Rehabilitation Center (SQ)',
  'Substance Abuse Treatment Facility and State Prison, Corcoran (SATF-CSP, Corcoran)',
  'Valley State Prison (VSP)',
];

// Answer texts. Step 2 reads these, so change them here only.
const CHOICES = {
  ENDED: 'Yes, it has ended',
  OPEN: 'No, it is planned or still running',
  CANCELLED: 'It was cancelled',
  NEXT_DATES: 'Same program, same facility, other dates',
  NEXT_FACILITY: 'Same program at another facility',
  NEXT_PROGRAM: 'Another program',
  NEXT_DONE: 'No, I\u2019m done',
};

const PLACEHOLDER_CHOICE = '(No options yet – add them on the TPW Constants tab)';

const MAP_HEADERS = ['Item ID', 'Item Type', 'Entry', 'Section', 'Chain', 'Slot', 'Field', 'Title'];

const KEYS = {
  FORM_ID: 'FORM_ID',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  BUILD_STATE: 'BUILD_STATE',           // building | done
  BUILD_NEXT_ENTRY: 'BUILD_NEXT_ENTRY', // next entry number to build
  BUILD_ITEM_COUNT: 'BUILD_ITEM_COUNT', // form item count before the entry in progress
  BUILD_ATTEMPTS: 'BUILD_ATTEMPTS',
};

function props_() {
  return PropertiesService.getScriptProperties();
}

function ss_() {
  const id = props_().getProperty(KEYS.SPREADSHEET_ID);
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

// ───────────────────────────── Menu ─────────────────────────────

function onOpen() {
  const menu = SpreadsheetApp.getUi()
    .createMenu('TPW Tools')
    .addItem('Set up form (first time)', 'setupTPW')
    .addItem('Sync form dropdowns', 'syncDropdowns')
    .addItem('Show form links', 'showFormLinks');

  // Later steps add their own menu items when their files are present.
  if (typeof onOpenStep2_ === 'function') onOpenStep2_(menu);
  if (typeof onOpenStep3_ === 'function') onOpenStep3_(menu);
  if (typeof onOpenStep4_ === 'function') onOpenStep4_(menu);

  menu.addSeparator()
    .addItem('Repair form branching', 'repairBranching')
    .addItem('Reset a stuck setup', 'resetSetup')
    .addToUi();
}

/** Re-applies every "go to section" rule on the existing form (no rebuild). */
function repairBranching() {
  const ui = SpreadsheetApp.getUi();
  if (props_().getProperty(KEYS.BUILD_STATE) !== 'done') {
    ui.alert('The form is not fully built yet.');
    return;
  }
  try {
    wireNavigation_(getForm_(), readMap_());
    ui.alert('Branching repaired', 'All "go to section" rules have been re-applied. Open the form link and test again.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(
      'Could not repair branching',
      'This form does not match the current script version (' + e.message + '). ' +
        'Rebuild it: Reset a stuck setup → delete the old form and tabs → Set up form (first time).',
      ui.ButtonSet.OK
    );
  }
}

// ───────────────────────────── Setup orchestration ─────────────────────────────

function setupTPW() {
  const ui = SpreadsheetApp.getUi();
  const p = props_();
  const state = p.getProperty(KEYS.BUILD_STATE);

  if (state === 'done' && formExists_()) {
    ui.alert('Already set up', 'The TPW form already exists. Use "Show form links" to find it.', ui.ButtonSet.OK);
    return;
  }
  if (state === 'building') {
    ui.alert(
      'Setup in progress',
      'The form is still being built and will finish automatically. ' +
        'If nothing has happened for 15 minutes, use "Reset a stuck setup" and run setup again.',
      ui.ButtonSet.OK
    );
    return;
  }

  const ss = SpreadsheetApp.getActive();
  p.setProperty(KEYS.SPREADSHEET_ID, ss.getId());

  createConstantsSheet_();
  createMapSheet_();
  startBuild_();

  ss.toast(
    'Building the form. This takes a few minutes and continues in the background. ' +
      'You will get an email with the links when it is ready.',
    'TPW setup',
    15
  );
  continueBuild();
}

function startBuild_() {
  const form = FormApp.create(CFG.FORM_TITLE);
  form.setDescription(
    'Report the programs your organization runs in CDCR facilities. ' +
      'You will go step by step: program → facility → dates → yards or locations. ' +
      'After each set of dates, the form asks whether there is more to add, so you never re-enter ' +
      'the same organization, program or facility. Dates can be in the past, present or future.'
  );

  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED); // Google sign-in required
  } catch (e) {
    form.setCollectEmail(true);
  }
  form.setAllowResponseEdits(true);
  form.setLimitOneResponsePerUser(false);
  form.setShowLinkToRespondAgain(true);
  form.setProgressBar(false); // progress is meaningless with branching
  form.setConfirmationMessage(
    'Thank you! Your response has been recorded. ' +
      'Use "Edit your response" to update it later, for example to add final numbers after a program ends.'
  );

  // First page: organization (asked once)
  const org = form.addListItem()
    .setTitle('Organization Name')
    .setRequired(true)
    .setChoiceValues([PLACEHOLDER_CHOICE]);
  appendMap_([mapRow_(org, 'LIST', 0, 'start', '', '', 'org')]);

  const p = props_();
  p.setProperty(KEYS.FORM_ID, form.getId());
  p.setProperty(KEYS.BUILD_STATE, 'building');
  p.setProperty(KEYS.BUILD_NEXT_ENTRY, '1');
  p.deleteProperty(KEYS.BUILD_ITEM_COUNT);
  p.deleteProperty(KEYS.BUILD_ATTEMPTS);
}

/**
 * Builds the form one entry at a time. If it runs short on time it schedules
 * itself to resume a minute later, so large forms never hit the 6-minute limit.
 */
function continueBuild() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    clearTriggers_(['continueBuild']);
    const p = props_();
    if (p.getProperty(KEYS.BUILD_STATE) !== 'building') return;

    const attempts = Number(p.getProperty(KEYS.BUILD_ATTEMPTS) || 0) + 1;
    p.setProperty(KEYS.BUILD_ATTEMPTS, String(attempts));
    if (attempts > CFG.MAX_BUILD_ATTEMPTS) {
      throw new Error('The form build kept failing. Check Executions for the error, then use "Reset a stuck setup".');
    }

    // Watchdog: if Apps Script cuts this run off at its time limit, resume automatically.
    ScriptApp.newTrigger('continueBuild').timeBased().after(CFG.WATCHDOG_MS).create();

    const started = Date.now();
    const form = getForm_();
    let next = Number(p.getProperty(KEYS.BUILD_NEXT_ENTRY) || 1);

    while (next <= CFG.MAX_ENTRIES + 1) { // MAX_ENTRIES + 1 = the final Notes page
      if (Date.now() - started > CFG.BUILD_TIME_BUDGET_MS) {
        clearTriggers_(['continueBuild']); // replace the watchdog with a quick resume
        ScriptApp.newTrigger('continueBuild').timeBased().after(60 * 1000).create();
        return;
      }
      cleanupPartialEntry_(form, next);
      p.setProperty(KEYS.BUILD_ITEM_COUNT, String(form.getItems().length));

      if (next <= CFG.MAX_ENTRIES) buildEntry_(form, next);
      else buildNotes_(form);

      next++;
      p.setProperty(KEYS.BUILD_NEXT_ENTRY, String(next));
      p.deleteProperty(KEYS.BUILD_ITEM_COUNT);
    }

    finalizeBuild_(form);
    clearTriggers_(['continueBuild']); // finished: remove the watchdog
  } finally {
    lock.releaseLock();
  }
}

/** If a previous run was cut off mid-entry, remove its leftover items and map rows. */
function cleanupPartialEntry_(form, entry) {
  const before = props_().getProperty(KEYS.BUILD_ITEM_COUNT);
  if (before === null) return;

  const keep = Number(before);
  for (let i = form.getItems().length - 1; i >= keep; i--) form.deleteItem(i);

  const entryKey = entry > CFG.MAX_ENTRIES ? 0 : entry;
  const sectionFilter = entry > CFG.MAX_ENTRIES ? 'notes' : null;
  deleteMapRows_(r => Number(r.entry) === entryKey && (!sectionFilter || r.section === sectionFilter));
}

function finalizeBuild_(form) {
  wireNavigation_(form, readMap_());

  const ss = ss_();
  let linked = false;
  try {
    linked = form.getDestinationId() === ss.getId(); // a retried finish may already be linked
  } catch (e) {
    linked = false;
  }
  if (!linked) form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  renameResponseSheet_(form);

  props_().setProperty(KEYS.BUILD_STATE, 'done');
  syncDropdowns();
  installTriggers_();
  notifyReady_(form);
}

function notifyReady_(form) {
  const body =
    'Your TPW form is ready.\n\n' +
    'Share this link with partner organizations:\n' + form.getPublishedUrl() + '\n\n' +
    'Edit the form:\n' + form.getEditUrl() + '\n\n' +
    'Next: fill in each organization’s Reminder Email on the "' + CFG.CONSTANTS_SHEET + '" tab.';

  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'TPW form is ready', body);
  } catch (e) {
    console.warn('Could not send the ready email: ' + e);
  }
  try {
    SpreadsheetApp.getUi().alert('TPW form is ready', body, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // No UI when finishing from a background trigger; the email covers it.
  }
}

function resetSetup() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    'Reset setup?',
    'This forgets the current form (it is not deleted from your Drive) so setup can run again. ' +
      'Delete the old form and the "' + CFG.MAP_SHEET + '" tab first if you want a clean start.',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;
  clearTriggers_(['continueBuild', 'onConstantsEdit', 'onConstantsChange', 'onTpwFormSubmit', 'dailyTpwRefresh',
    'continueSyntheticData']);
  props_().deleteAllProperties();
  ui.alert('Reset done. Run "Set up form (first time)" again.');
}

function formExists_() {
  const id = props_().getProperty(KEYS.FORM_ID);
  if (!id) return false;
  try {
    FormApp.openById(id);
    return true;
  } catch (e) {
    return false;
  }
}

function getForm_() {
  const id = props_().getProperty(KEYS.FORM_ID);
  if (!id) throw new Error('No TPW form found. Run TPW Tools → "Set up form (first time)" first.');
  return FormApp.openById(id);
}

function showFormLinks() {
  const form = getForm_();
  SpreadsheetApp.getUi().alert(
    'TPW form links',
    'Share with partners:\n' + form.getPublishedUrl() + '\n\nEdit the form:\n' + form.getEditUrl(),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ───────────────────────────── Form building ─────────────────────────────

function validations_() {
  return {
    positive: FormApp.createTextValidation()
      .requireNumberGreaterThan(0)
      .setHelpText('Enter a number greater than 0.')
      .build(),
    zeroOrMore: FormApp.createTextValidation()
      .requireNumberGreaterThanOrEqualTo(0)
      .setHelpText('Enter a number (0 or more).')
      .build(),
  };
}

/**
 * One entry = one program at one facility for one date window, with its yard pages.
 *
 * Program, facility, dates and "Has it ended?" share ONE page. Entries after the
 * first have three versions of that page, so the form only asks for what changed:
 *   program  – new program: program + facility + dates
 *   facility – same program, new facility: facility + dates
 *   dates    – same program and facility, new dates: dates only
 */
function buildEntry_(form, w) {
  const rows = [];
  const rec = (item, type, section, chain, slot, field) =>
    rows.push(mapRow_(item, type, w, section, chain, slot, field));
  const tag = 'Entry ' + w + ' · ';
  const isLast = w === CFG.MAX_ENTRIES;
  const M = CFG.MAX_LOCATIONS;
  const v = validations_();

  // ── Program details page(s) ──
  const variants = w === 1 ? ['program'] : ['program', 'facility', 'dates'];
  const headTitles = {
    program: 'Program details',
    facility: 'Same program, another facility',
    dates: 'Same program and facility, other dates',
  };
  const headHelp = {
    program: w === 1 ? '' : 'Tell us about the next program.',
    facility: 'The program and its course duration from your previous entry are kept. Choose the facility and dates.',
    dates: 'The program, its course duration and the facility from your previous entry are kept. Enter the new dates.',
  };

  variants.forEach(variant => {
    if (w === 1) {
      // Entry 1 shares the first page with the Organization question.
      form.addSectionHeaderItem().setTitle(tag + headTitles.program);
    } else {
      const pb = form.addPageBreakItem().setTitle(tag + headTitles[variant]).setHelpText(headHelp[variant]);
      rec(pb, 'PAGE_BREAK', 'head', variant, '', 'page');
    }

    if (variant === 'program') {
      const program = form.addTextItem()
        .setTitle('Program Name')
        .setHelpText('Example: CEO of Your New Life')
        .setRequired(true);
      rec(program, 'TEXT', 'head', variant, '', 'program_name');

      const courseHours = form.addTextItem()
        .setTitle('Total Course Duration (hours)')
        .setHelpText('Total hours of the full course for one participant (e.g., 176). Hours attended are calculated from this.')
        .setRequired(true)
        .setValidation(v.positive);
      rec(courseHours, 'TEXT', 'head', variant, '', 'course_hours');
    }
    if (variant !== 'dates') {
      const facility = form.addListItem()
        .setTitle('CDCR Facility')
        .setRequired(true)
        .setChoiceValues([PLACEHOLDER_CHOICE]);
      rec(facility, 'LIST', 'head', variant, '', 'facility');
    }

    const start = form.addDateItem()
      .setTitle('Start Date')
      .setHelpText('Can be in the past, present or future.')
      .setIncludesYear(true)
      .setRequired(true);
    rec(start, 'DATE', 'head', variant, '', 'start_date');
    const end = form.addDateItem().setTitle('End Date').setIncludesYear(true).setRequired(true);
    rec(end, 'DATE', 'head', variant, '', 'end_date');

    const ended = form.addMultipleChoiceItem()
      .setTitle('Has this program run already ended?')
      .setHelpText('If it has ended, you will be asked for final participant numbers.')
      .setRequired(true)
      .setChoiceValues([CHOICES.ENDED, CHOICES.OPEN, CHOICES.CANCELLED]); // navigation added later
    rec(ended, 'MULTIPLE_CHOICE', 'head', variant, '', 'ended');
  });

  // ── "How many yards?" – one version per chain ──
  ['ended', 'open'].forEach(chain => {
    const pbCount = form.addPageBreakItem()
      .setTitle(tag + 'Yards or locations')
      .setHelpText('Within this facility, during the dates you just entered.');
    rec(pbCount, 'PAGE_BREAK', 'count', chain, '', 'page');
    const count = form.addListItem()
      .setTitle('How many yards or locations held this program during these dates?')
      .setHelpText(
        'Choose 1 if the facility has no yards or the program ran in one place. ' +
          'If more than ' + M + ', choose ' + M + ' and add the rest as another entry with the same dates.'
      )
      .setRequired(true)
      .setChoiceValues(Array.from({ length: M }, (_, i) => String(i + 1)));
    rec(count, 'LIST', 'count', chain, '', 'yard_count');
  });

  // ── Yard pages: a chain of M pages per version. The count answer jumps
  //    into the chain so that exactly that many pages remain. ──
  ['ended', 'open'].forEach(chain => {
    for (let j = 1; j <= M; j++) {
      const pb = form.addPageBreakItem()
        .setTitle(tag + 'Yard details')
        .setHelpText(
          chain === 'ended'
            ? 'One page per yard or location. This program has ended, so all numbers are required.'
            : 'One page per yard or location. Fill in what you know now; after the end date you will be ' +
                'reminded to add the final numbers.'
        );
      rec(pb, 'PAGE_BREAK', 'location', chain, j, 'page');

      const yard = form.addTextItem()
        .setTitle('Yard / Location')
        .setHelpText(
          j < M
            ? 'Name of the yard or location, as the facility calls it (e.g., "A Yard", "North").'
            : 'Name of the yard or location. Leave blank only if the facility has no yards.'
        )
        .setRequired(j < M); // the last page is also the only page when the answer is 1
      rec(yard, 'TEXT', 'location', chain, j, 'yard');

      if (chain === 'ended') {
        const participants = form.addTextItem()
          .setTitle('Number of Participants')
          .setHelpText('How many people were enrolled in this yard or location.')
          .setRequired(true)
          .setValidation(v.positive);
        rec(participants, 'TEXT', 'location', chain, j, 'participants');

        const completed = form.addTextItem()
          .setTitle('Number of Participants Completed')
          .setRequired(true)
          .setValidation(v.zeroOrMore);
        rec(completed, 'TEXT', 'location', chain, j, 'completed');
      } else {
        const participants = form.addTextItem()
          .setTitle('Number of Participants')
          .setHelpText('Expected number if planned; currently enrolled if running. Leave blank if not known yet.')
          .setValidation(v.positive);
        rec(participants, 'TEXT', 'location', chain, j, 'participants');
      }
    }
  });

  // ── What next? (one question instead of three pages) ──
  if (!isLast) {
    const pb = form.addPageBreakItem().setTitle(tag + 'What next?');
    rec(pb, 'PAGE_BREAK', 'next', '', '', 'page');
    const next = form.addMultipleChoiceItem()
      .setTitle('Is there more to report?')
      .setRequired(true)
      .setChoiceValues([CHOICES.NEXT_DATES, CHOICES.NEXT_FACILITY, CHOICES.NEXT_PROGRAM, CHOICES.NEXT_DONE]);
    rec(next, 'MULTIPLE_CHOICE', 'next', '', '', 'next');
  }

  appendMap_(rows);
}

function buildNotes_(form) {
  const pb = form.addPageBreakItem()
    .setTitle('Notes')
    .setHelpText(
      'Almost done. If you have more to report than this form allows (' + CFG.MAX_ENTRIES +
        ' entries), submit this response and then choose "Submit another response".'
    );
  const notes = form.addParagraphTextItem()
    .setTitle('Notes')
    .setHelpText('Optional. Anything TPW should know about the programs in this response.');
  appendMap_([
    mapRow_(pb, 'PAGE_BREAK', 0, 'notes', '', '', 'page'),
    mapRow_(notes, 'PARAGRAPH_TEXT', 0, 'notes', '', '', 'notes'),
  ]);
}

/**
 * Sets all branching once every page exists.
 * Note: PageBreakItem.setGoToPage controls where the page BEFORE that break goes.
 */
function wireNavigation_(form, map) {
  const M = CFG.MAX_LOCATIONS;
  const find = (entry, section, field, chain, slot) => {
    const row = map.find(r =>
      Number(r.entry) === entry &&
      r.section === section &&
      r.field === field &&
      (chain === undefined || r.chain === chain) &&
      (slot === undefined || Number(r.slot) === slot)
    );
    if (!row) throw new Error('Form map is missing: entry ' + entry + ', ' + section + ', ' + field + ', ' + (chain || ''));
    return form.getItemById(Number(row.itemId));
  };
  const notesPage = find(0, 'notes', 'page').asPageBreakItem();

  for (let w = 1; w <= CFG.MAX_ENTRIES; w++) {
    const isLast = w === CFG.MAX_ENTRIES;
    const page = (section, chain, slot) => find(w, section, 'page', chain, slot).asPageBreakItem();
    const afterYards = isLast ? notesPage : page('next');

    // Has it ended? (on every version of the program details page)
    const variants = w === 1 ? ['program'] : ['program', 'facility', 'dates'];
    variants.forEach(variant => {
      const ended = find(w, 'head', 'ended', variant).asMultipleChoiceItem();
      ended.setChoices([
        ended.createChoice(CHOICES.ENDED, page('count', 'ended')),
        ended.createChoice(CHOICES.OPEN, page('count', 'open')),
        ended.createChoice(CHOICES.CANCELLED, afterYards),
      ]);
    });

    // How many yards? → jump into the chain so exactly that many pages remain
    ['ended', 'open'].forEach(chain => {
      const count = find(w, 'count', 'yard_count', chain).asListItem();
      const choices = [];
      for (let k = 1; k <= M; k++) {
        choices.push(count.createChoice(String(k), page('location', chain, M - k + 1)));
      }
      count.setChoices(choices);
    });

    // End of the "ended" chain would otherwise run into the "open" chain.
    page('location', 'open', 1).setGoToPage(afterYards);
    // End of the "open" chain flows straight into afterYards (next page in order).

    if (!isLast) {
      const nextHead = variant => find(w + 1, 'head', 'page', variant).asPageBreakItem();
      const next = find(w, 'next', 'next').asMultipleChoiceItem();
      next.setChoices([
        next.createChoice(CHOICES.NEXT_DATES, nextHead('dates')),
        next.createChoice(CHOICES.NEXT_FACILITY, nextHead('facility')),
        next.createChoice(CHOICES.NEXT_PROGRAM, nextHead('program')),
        next.createChoice(CHOICES.NEXT_DONE, notesPage),
      ]);
    }
  }
}

function renameResponseSheet_(form) {
  SpreadsheetApp.flush();
  const ss = ss_();
  if (ss.getSheetByName(CFG.RESPONSES_SHEET)) return;

  const target = ss.getSheets().find(s => {
    const url = s.getFormUrl();
    if (!url) return false;
    try {
      return FormApp.openByUrl(url).getId() === form.getId();
    } catch (e) {
      return false;
    }
  });
  if (target) target.setName(CFG.RESPONSES_SHEET);
}

// ───────────────────────────── Form map (used by Step 2) ─────────────────────────────

function createMapSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.MAP_SHEET);
  if (sh) {
    sh.clear();
  } else {
    sh = ss.insertSheet(CFG.MAP_SHEET);
  }
  sh.getRange(1, 1, 1, MAP_HEADERS.length).setValues([MAP_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.protect().setDescription('Generated by the TPW scripts – do not edit').setWarningOnly(true);
  sh.hideSheet();
  return sh;
}

function mapRow_(item, type, entry, section, chain, slot, field) {
  return [String(item.getId()), type, entry, section, chain || '', slot || '', field, item.getTitle()];
}

function appendMap_(rows) {
  if (!rows.length) return;
  const sh = ss_().getSheetByName(CFG.MAP_SHEET);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, MAP_HEADERS.length).setValues(rows);
}

function readMap_() {
  const sh = ss_().getSheetByName(CFG.MAP_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, MAP_HEADERS.length).getValues().map(r => ({
    itemId: String(r[0]),
    type: r[1],
    entry: r[2],
    section: r[3],
    chain: r[4],
    slot: r[5],
    field: r[6],
    title: r[7],
  }));
}

function deleteMapRows_(predicate) {
  const sh = ss_().getSheetByName(CFG.MAP_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return;
  const all = sh.getRange(2, 1, last - 1, MAP_HEADERS.length).getValues();
  const keep = all.filter(r => !predicate({ entry: r[2], section: r[3] }));
  if (keep.length === all.length) return;
  sh.getRange(2, 1, last - 1, MAP_HEADERS.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, MAP_HEADERS.length).setValues(keep);
}

// ───────────────────────────── Constants tab ─────────────────────────────

function createConstantsSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.CONSTANTS_SHEET);
  if (sh) return sh; // keep lists already entered

  sh = ss.insertSheet(CFG.CONSTANTS_SHEET);
  const n = CFG.MAX_LIST_ROWS;

  sh.getRange(1, CFG.ORG_NAME_COL, 1, 3).setValues([['Organization', 'Reminder Email', 'Active (Y/N)']]);
  sh.getRange(1, CFG.FAC_NAME_COL, 1, 2).setValues([['CDCR Facility', 'Active (Y/N)']]);
  sh.getRange(2, CFG.ORG_NAME_COL, SEED_ORGS.length, 3).setValues(SEED_ORGS.map(o => [o, '', 'Y']));
  sh.getRange(2, CFG.FAC_NAME_COL, SEED_FACILITIES.length, 2).setValues(SEED_FACILITIES.map(f => [f, 'Y']));

  [sh.getRange(1, CFG.ORG_NAME_COL, 1, 3), sh.getRange(1, CFG.FAC_NAME_COL, 1, 2)].forEach(r =>
    r.setFontWeight('bold').setBackground('#e8eaed')
  );
  sh.setFrozenRows(1);

  const yn = SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).setAllowInvalid(false).build();
  sh.getRange(2, CFG.ORG_ACTIVE_COL, n, 1).setDataValidation(yn);
  sh.getRange(2, CFG.FAC_ACTIVE_COL, n, 1).setDataValidation(yn);

  const email = SpreadsheetApp.newDataValidation()
    .requireTextIsEmail()
    .setAllowInvalid(false)
    .setHelpText('One email address. The reminder for this organization goes here.')
    .build();
  sh.getRange(2, CFG.ORG_EMAIL_COL, n, 1).setDataValidation(email);

  sh.setColumnWidth(CFG.ORG_NAME_COL, 260);
  sh.setColumnWidth(CFG.ORG_EMAIL_COL, 260);
  sh.setColumnWidth(CFG.ORG_ACTIVE_COL, 100);
  sh.setColumnWidth(4, 30);
  sh.setColumnWidth(CFG.FAC_NAME_COL, 420);
  sh.setColumnWidth(CFG.FAC_ACTIVE_COL, 100);

  sh.protect().setDescription('TPW dropdown lists – edits here change the live form').setWarningOnly(true);
  return sh;
}

// ───────────────────────────── Dropdown sync ─────────────────────────────

/**
 * Rewrites the Organization dropdown and every Facility dropdown from the
 * TPW Constants tab: trims spaces, removes duplicates, skips Active = N, sorts A–Z.
 */
function syncDropdowns() {
  if (props_().getProperty(KEYS.BUILD_STATE) !== 'done') return; // form still being built
  const form = getForm_();
  const sh = ss_().getSheetByName(CFG.CONSTANTS_SHEET);
  if (!sh) throw new Error('The "' + CFG.CONSTANTS_SHEET + '" tab is missing.');

  const orgs = readList_(sh, CFG.ORG_NAME_COL, CFG.ORG_ACTIVE_COL);
  const facilities = readList_(sh, CFG.FAC_NAME_COL, CFG.FAC_ACTIVE_COL);

  readMap_().forEach(r => {
    if (r.field === 'org') setListChoices_(form, r.itemId, orgs);
    if (r.field === 'facility') setListChoices_(form, r.itemId, facilities);
  });
}

function readList_(sh, nameCol, activeCol) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const names = sh.getRange(2, nameCol, last - 1, 1).getValues().flat();
  const active = sh.getRange(2, activeCol, last - 1, 1).getValues().flat();

  const seen = new Set();
  const out = [];
  names.forEach((raw, i) => {
    const name = String(raw).trim().replace(/\s+/g, ' ');
    if (!name || String(active[i]).trim().toUpperCase() === 'N') return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  });
  return out.sort((a, b) => a.localeCompare(b));
}

function setListChoices_(form, itemId, values) {
  const item = form.getItemById(Number(itemId));
  if (!item) throw new Error('A dropdown question was deleted from the form (item ' + itemId + ').');
  const list = item.asListItem();
  const next = values.length ? values : [PLACEHOLDER_CHOICE];
  const current = list.getChoices().map(c => c.getValue());
  if (current.length === next.length && current.every((v, i) => v === next[i])) return;
  list.setChoiceValues(next);
}

// ───────────────────────────── Triggers ─────────────────────────────

function onConstantsEdit(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== CFG.CONSTANTS_SHEET) return;
  syncDropdowns();
}

/** Row inserts/deletes don't fire onEdit, so this catches them. */
function onConstantsChange(e) {
  if (!e || e.changeType === 'EDIT' || e.changeType === 'FORMAT') return;
  syncDropdowns();
}

function installTriggers_() {
  const ss = ss_();
  clearTriggers_(['onConstantsEdit', 'onConstantsChange']);
  ScriptApp.newTrigger('onConstantsEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onConstantsChange').forSpreadsheet(ss).onChange().create();
}

function clearTriggers_(handlers) {
  ScriptApp.getProjectTriggers()
    .filter(t => handlers.includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
}