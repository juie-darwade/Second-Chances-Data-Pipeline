# Second Chances Data Pipeline

A Google Sheets + Apps Script pipeline that helps the members of **TPW Collective Impact**, nonprofits that run rehabilitation programs in California prisons, report their program runs and see their combined impact.

Built for the Hack for Social Impact hackathon.

## What it does

1. **Collects reports.** Partner organizations fill in one Google Form per update: program, prison, dates, and the numbers for each yard.
2. **Cleans the data.** Each submission becomes tidy rows in a **TPW Records** tab, one row per yard per run. Statuses (Planned, In Progress, Completed, Cancelled) are worked out from the dates, and suspect data such as more completions than participants or duplicate submissions is flagged.
3. **Follows up by email.** After each submission, the submitter gets a summary of their organization's year, with anything that needs a second look. The day after a run ends, the organization gets a reminder if its final numbers are missing.
4. **Shows the impact.** A web dashboard shows participants, completion rate, participant hours, estimated rehab credits and taxpayer savings, over time and by program and prison. TPW sees every organization; each organization gets a private link to its own results.

```
Google Form ──▶ TPW Responses (raw, hidden) ──▶ TPW Records (one row per yard)
                                                   │
                         ┌─────────────────────────┼──────────────────────────┐
                         ▼                         ▼                          ▼
              Summary + reminder emails   TPW Impact Summary tab    Impact dashboard (web app)
```

Everything runs inside one Google Sheet's Apps Script project. There are no servers, no other accounts, and no cost.

## Files

| File | In Apps Script, name it | What it does |
|---|---|---|
| `step_1.gs` | `Step1_Setup` | Builds the Google Form, the **TPW Constants** dropdown lists, and the **TPW Tools** menu |
| `step_2.gs` | `Step2_Records` | Turns responses into **TPW Records**, flags data problems and duplicates, sends summary and reminder emails |
| `step_3.gs` | `Step3_SyntheticData` | *Optional.* Generates realistic test data through the form, and deletes it again |
| `step_4.gs` | `Step4_Dashboard` | Impact calculations, the **TPW Impact Summary** tab, the dashboard web app, private links, CSV downloads |
| `Dashboard.html` | `Dashboard` (an **HTML** file) | The dashboard page |
| `data-demo/` | – | Screenshots of the dashboard on sample data |

Each `.gs` file starts with a comment describing what it does in more detail.

## Setup

Allow about 30 minutes. Use the Google account that should **own** the form and **send** the emails, since everything runs as that account.

### 1. Create the spreadsheet and the form (Step 1)
1. **Create the sheet:** create a new, blank Google Sheet, for example "TPW Program Runs".
2. **Add Step 1:** go to **Extensions → Apps Script**, delete the sample code, paste `step_1.gs`, rename the file to `Step1_Setup`, and click **Save**.
3. **Set the time zone:** click **Project Settings** (the gear icon) and set **Time zone** to **(GMT-07:00) Los Angeles**. Status changes and reminders follow this time zone.
4. **Build the form:** reload the spreadsheet. A **TPW Tools** menu appears. Run **TPW Tools → Set up form (first time)** and approve the permissions prompt. The form builds in the background over a few minutes, and you get an email with its links when it's done.
5. **Fill in organizations:** on the **TPW Constants** tab, list each organization with its **Reminder Email** (column B), and check the list of prisons.
   - Edits here update the form's dropdowns automatically.
   - Set **Active** to `N` to hide an entry without deleting it.

### 2. Turn responses into records (Step 2)
1. **Add Step 2:** in Apps Script, click **+ → Script**, name it `Step2_Records`, paste `step_2.gs`, and save.
2. **Set up records:** reload the sheet and run **TPW Tools → Set up records (Step 2)**.

From now on:
- **Each submission or edit** of a response creates or updates its rows in **TPW Records**, and the raw **TPW Responses** tab is hidden.
- **Every morning around 6am,** statuses refresh and due reminders go out.

### 3. Optional: add test data (Step 3)
1. **Add Step 3:** add a script named `Step3_SyntheticData` and paste `step_3.gs`.
2. **Generate data:** run **TPW Tools → Generate synthetic data**. It submits up to 100 realistic responses (about 300 yard records) through the form in the background and emails you when it's done.

Test data is tagged "SYNTHETIC TEST DATA". It never triggers emails, and the dashboard labels it. **TPW Tools → Delete synthetic data** removes exactly these responses and nothing else.

### 4. Add the dashboard (Step 4)
1. **Add the files:**
   - Add a script named `Step4_Dashboard` and paste `step_4.gs`.
   - Click **+ → HTML**, name it exactly `Dashboard`, and paste `Dashboard.html`.
   - Save.
2. **Deploy the web app:**
   1. Go to **Deploy → New deployment**, click the gear icon, and choose **Web app**.
   2. Set **Execute as: Me** and **Who has access: Anyone**.
   3. Click **Deploy** and copy the **Web app URL**, the one ending in `/exec`.
3. **Connect it to the sheet:** reload the sheet, run **TPW Tools → Set up dashboards (Step 4)**, and paste the URL. This creates:
   - **TPW Dashboard Links:** TPW's admin link on the top row, then one private link per organization.
   - **TPW Impact Summary:** totals per organization per program year, kept up to date automatically.
4. **Check it:**
   - Open the admin link, then one organization's link **in a private/incognito window**.
   - If something's wrong, run **TPW Tools → Check dashboard**. It lists what passes and what fails.

### 5. Share
- **Partners get the form link:** **TPW Tools → Show form links**.
- **Each organization gets only its own dashboard link.** Summary emails include it automatically.
- **Anyone who has a link can see that page.** If one leaks, run **TPW Tools → Replace a dashboard link**; the old link stops working immediately.

## TPW Tools menu

| Menu item | Use it to |
|---|---|
| Set up form (first time) | Build the form (Step 1) |
| Sync form dropdowns | Push **TPW Constants** changes to the form now |
| Show form links | Get the partner link and the edit link for the form |
| Set up records (Step 2) | Start turning responses into records |
| Rebuild all records from responses | Recreate **TPW Records** from scratch. Safe to run any time |
| Refresh statuses now | Recalculate statuses without waiting for the morning |
| Generate / Delete synthetic data | Add or remove test data (Step 3) |
| Set up dashboards (Step 4) | Connect the deployed web app and create the links |
| Show dashboard links | Open the **TPW Dashboard Links** tab |
| Replace a dashboard link | Give an organization, or TPW (type `TPW`), a new link |
| Refresh impact summary | Recalculate the **TPW Impact Summary** tab now |
| Check dashboard | Diagnose a dashboard that won't load |
| Repair form branching / Reset a stuck setup | Recover from a broken form build |

## How the numbers are calculated

- **Participants:** program runs that have started. Planned runs aren't counted yet, and cancelled runs are never counted.
- **Completion rate:** completed ÷ participants, counting finished runs that report both numbers.
- **Participant hours delivered:** number completed × course hours.
- **Rehab credits (days, estimate):** participant hours ÷ 52 × 10.
- **Taxpayer savings (estimate):** rehab credit days ÷ 365 × $21,534.
- **Program year and quarters:** follow each run's **start date**.

You can change the estimate constants at the top of `step_4.gs` (`DASH`).

## Updating the code

1. **Paste and save:** paste the changed file over its Apps Script file and save. Form handling, emails and daily jobs use the new code immediately.
2. **Redeploy the dashboard:** it only updates when you deploy a new version. Go to **Deploy → Manage deployments**, click the pencil, set **Version: New version**, and click **Deploy**.
   - Edit the existing deployment rather than creating a new one, so the URL and every shared link stay the same.

To avoid copy-pasting, you can sync this repo with the Apps Script project using [clasp](https://github.com/google/clasp):
```
clasp login
clasp clone <script ID>   # Script ID is under Apps Script → Project Settings
clasp push                # after pulling the latest main
```
After `clasp push`, the dashboard still needs the new-version deploy from step 2.

## Troubleshooting

| Problem | Try |
|---|---|
| Dashboard shows "Sorry, unable to open the file at this time" | Open the link in a private window. Being signed into several Google accounts breaks Apps Script web apps. Also check that the link ends in `/exec` (not `/dev`) and that **Who has access** is **Anyone** |
| Dashboard says "couldn't load" | Run **TPW Tools → Check dashboard**. The error is also logged under Apps Script → **Executions** |
| Dashboard links stopped working after redeploying | A *new* deployment gets a new URL. Run **Set up dashboards (Step 4)** again with the current `/exec` URL. The keys stay the same |
| A new organization isn't in the form | Add it on **TPW Constants**. If the dropdown doesn't update, run **Sync form dropdowns** |
| Records look wrong or out of date | Run **Rebuild all records from responses** |
| The form build seems stuck | Wait 15 minutes, then **Reset a stuck setup** and run setup again |

## Privacy

- **The spreadsheet holds everything:** all organizations' data and the submitters' emails. Share it only with TPW staff.
- **Partner dashboard pages** contain only that organization's records plus totals for the whole collective. Other organizations' names, programs and prisons are never sent to them.
- **CSV downloads** include only the reporting columns. They never contain edit links, emails or internal flags.

## Contributing

Work happens in pull requests against `main`. Split larger changes into a stack of small PRs, and include before/after screenshots for changes to the dashboard or emails.
