# Symptom Log

A private, phone-first app for logging chest pain episodes and lining them up against Apple Health data: blood pressure (Omron), weight and body fat (scale), and heart rate, HRV, sleep, steps and workouts (Fitbit Air). It runs as a web app from GitHub Pages and installs to the iPhone home screen. No Mac, no App Store, no server.

**Privacy:** everything you enter or import is stored only on your phone (IndexedDB). Nothing is uploaded anywhere. This repository is public because free GitHub Pages requires it, but it contains only code. Never commit export or backup files; `.gitignore` blocks `.json` (except `manifest.json`), `.csv`, `.txt` and anything with "backup" in the name.

## What it does

- **Log**: record an episode in a few taps: intensity 1 to 10, what it feels like, where, where it spreads, what you were doing, what changes it, start time, duration and notes. Selecting shortness of breath, sweating, dizziness or nausea shows an emergency banner with a Call 911 button. Recent episodes are listed underneath; tap one to edit or delete it.
- **Today**: episodes today and this week, plus cards for blood pressure (latest and 7-day average), recovery (HRV and resting HR against your 30-day baseline), sleep with stages, weight, body fat, resting HR, HRV, steps, active energy and workouts.
- **Patterns**: episodes plotted as red dots on any metric's timeline; episode days compared with symptom-free days (sleep the night before, HRV, resting HR, blood pressure, steps, recent workouts); breakdowns by time of day, weekday, activity, what changes the pain and pain type; and plain-language findings with sample sizes. These are correlations in your own data, not a diagnosis.
- **Report**: a print-friendly summary for any date range (episode list, stats, trends and findings). Use Print, then save as PDF, to bring it to an appointment.
- **Data**: import Health exports, switch lb/kg, save and restore backups, export episodes to CSV, or delete everything.

## Setup on GitHub Pages

1. Put these files in the root of the `symptom-log` repository (keep the folder structure: `index.html`, `css/`, `js/`, `icons/`, `manifest.json`, `sw.js`).
2. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then **Save**.
3. After a minute or two the site is live at `https://<your-username>.github.io/symptom-log/`.

There is no build step. GitHub Pages serves the files as they are.

## Add it to your iPhone home screen

1. Open the site in **Safari** (it must be Safari).
2. Tap **Share → Add to Home Screen → Add**.
3. Open it from the home screen icon from then on. It runs full screen and works offline after the first load.

Note: the home screen app and a Safari tab keep **separate** storage on iOS. Always log from the home screen icon so your entries stay in one place.

### Updating

When you change any file, bump `VERSION` at the top of `sw.js` (for example `v1` → `v2`) and push. Close and reopen the app (twice if needed) to pick up the new version.

### Entries from the first version

If you logged entries with the original single-file version, the new app finds them in the browser's local storage on first launch and copies them in. The originals are left untouched as a safety net, and they are only copied once.

## Getting Health data in

The Fitbit Air syncs to Apple Health, as do the Omron Connect app and your scale's app. This app reads exports of Apple Health; make sure each of those apps has permission to **write** to Health (Health app → profile → Apps).

Every imported reading is keyed by its type and timestamp, so importing overlapping files is safe: matching readings are refreshed instead of duplicated.

### Option 1: Health Auto Export (recommended)

1. Install **Health Auto Export – JSON+CSV** from the App Store and give it read access to Health.
2. Create a manual export:
   - **Format:** JSON (CSV also works).
   - **Metrics:** Blood Pressure, Weight & Body Mass, Body Fat Percentage, Resting Heart Rate, Heart Rate Variability, Heart Rate, Sleep Analysis, Step Count, Active Energy. Turn on **Workouts** too.
   - **Aggregation:** Day works well. Hourly heart rate is fine too, but keep the same aggregation from export to export so step totals aren't double counted.
   - **Range:** start with the last 90 days.
3. Export to **Files**.
4. In Symptom Log, open **Data → Choose export files** and pick the file. You can select several files at once.
5. For ongoing updates, create an **Automation** in Health Auto Export that exports daily to iCloud Drive. Import the newest file whenever you want fresh charts.

### Option 2: Apple Shortcut (free)

A Shortcut can read Health samples and save a text file the app understands. You build one block per metric, then save everything to one file.

**Build the first block (weight):**

1. Open **Shortcuts → + (new shortcut)**. Name it "Export for Symptom Log".
2. Add **Find Health Samples**. Set **Type** to *Body Mass*, add a filter **Start Date is in the last 7 days**, and leave Sort and Limit off.
3. Add **Repeat with Each**, using the Health Samples from step 2.
4. Inside the repeat, add **Format Date**: date = *Repeat Item → Start Date*, Date Format = **ISO 8601**, Include Time on.
5. Inside the repeat, add **Text** with exactly this (insert the variables where shown in brackets):

   ```
   {"type":"weight","value":[Repeat Item → Value],"unit":"[Repeat Item → Unit]","start":"[Formatted Date]"},
   ```

6. Inside the repeat, add **Add to Variable** and name the variable `Samples`.

**Duplicate the block for each metric** (long-press the actions → Duplicate) and change the Type and the `"type"` value:

| Health Type in Shortcuts | `"type"` value | Notes |
| --- | --- | --- |
| Body Mass | `weight` | |
| Body Fat Percentage | `body_fat` | |
| Blood Pressure Systolic | `bp_systolic` | The app pairs systolic and diastolic readings taken at the same time. |
| Blood Pressure Diastolic | `bp_diastolic` | |
| Resting Heart Rate | `resting_hr` | |
| Heart Rate Variability | `hrv` | |
| Heart Rate | `heart_rate` | Optional; can be many samples. |
| Steps | `steps` | In Find Health Samples, set **Group By: Day** so you get daily totals. |
| Active Energy | `active_energy` | Also **Group By: Day**. |
| Sleep Analysis | `sleep` | Use the text below instead. |

For **Sleep Analysis**, format both dates and use this Text so each stage (Core, Deep, REM, Awake) comes through:

```
{"type":"sleep","value":"[Repeat Item → Value]","start":"[Formatted Start Date]","end":"[Formatted End Date]"},
```

**Finish the shortcut:**

1. After all blocks, add **Text** containing just the `Samples` variable.
2. Add **Save File**: save to iCloud Drive (for example `Shortcuts/health-export.txt`), turn **Ask Where to Save** off and **Overwrite If File Exists** on.
3. Run it, then in Symptom Log choose **Data → Choose export files** and pick `health-export.txt`.

If steps look doubled, add a filter **Source is Fitbit** to the Steps block so the iPhone's own step count isn't added on top.

#### Shortcut file format

The importer accepts any of these:

- A JSON object: `{ "samples": [ ... ] }`
- A JSON array: `[ { ... }, { ... } ]`
- One JSON object per line, with or without trailing commas (what the Shortcut above produces)

Each sample:

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | yes | `weight`, `body_fat`, `bp_systolic`, `bp_diastolic`, `blood_pressure`, `resting_hr`, `hrv`, `heart_rate`, `steps`, `active_energy`, `sleep` or `workout`. Apple Health names such as "Body Mass" or "Step Count" also work. |
| `value` | yes | The number. For `sleep`, either a stage name (`Core`, `Deep`, `REM`, `Awake`, `Asleep`, `In Bed`) with `start` and `end`, or a number of hours for the night. |
| `unit` | no | `lb`, `kg`, `kcal`, `kJ`, `%`, `ms`, `count/min`. Weight defaults to kg, energy to kcal. |
| `start` | yes | ISO 8601 (`2026-11-15T07:30:00-07:00`) is best. Shortcuts' default "Nov 15, 2026 at 7:30 AM" also works. |
| `end` | for sleep stages and workouts | Same format as `start`. |
| `systolic`, `diastolic` | for `blood_pressure` | Use instead of separate systolic and diastolic samples. |
| `name`, `duration` | for `workout` | Workout name and duration in minutes. |

Example:

```json
{"type":"weight","value":208.6,"unit":"lb","start":"2026-11-14T06:45:00-07:00"},
{"type":"blood_pressure","systolic":128,"diastolic":82,"start":"2026-11-14T07:05:00-07:00"},
{"type":"sleep","value":"Deep","start":"2026-11-14T01:10:00-07:00","end":"2026-11-14T02:05:00-07:00"},
```

Sleep stages are grouped into nights and credited to the day you woke up.

## Backups

Your data exists only on your phone, and deleting the home screen app deletes it. Use **Data → Save backup** every week or two and save the file to iCloud Drive or Files. **Restore backup** merges a backup back in without deleting anything that's already there. The Today screen reminds you when your last backup is more than two weeks old.

## How the patterns work

- **Episode days vs other days** compares daily averages on days with at least one episode against days with health data but no episodes. "Sleep the night before" is the night that ended that morning. A dot marks a difference of at least half a standard deviation with 3 or more days on each side.
- **Findings** are generated only when there's enough data (usually 3 or more episodes), and each shows how many episodes or days it is based on, along with a baseline (for example, how often you sleep under 6 hours overall).
- Correlation is not causation, and small samples are noisy. The findings are meant to help you and your doctor ask better questions.

## Project layout

```
index.html          app shell and tab bar
manifest.json       home screen app settings
sw.js               offline cache (bump VERSION when files change)
css/app.css         all styles, light and dark
icons/              app icons
js/app.js           router and startup (migration, service worker)
js/db.js            IndexedDB wrapper, backup and restore
js/migrate.js       copies entries from the first version's localStorage
js/importer.js      Health Auto Export JSON/CSV and Shortcut importers
js/data.js          daily rollups and formatting
js/analysis.js      pattern analysis used by Patterns and Report
js/charts.js        Chart.js helpers (loaded from cdnjs)
js/options.js       symptom form choices
js/views/           one file per screen
```

Charts use Chart.js 4 from cdnjs. Everything else is plain JavaScript modules with no build step and no other dependencies.

## Medical note

This app is a personal log, not a medical device. If chest pain comes with shortness of breath, sweating, dizziness, nausea, or pain spreading to the arm, jaw or back, call 911.
