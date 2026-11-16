// Data & settings: import Health data, units, backup/restore, export, clear.

import { count, exportAll, getAll, getMeta, setMeta, wipeAll } from '../db.js';
import { getSettings, METRICS } from '../data.js';
import { importText } from '../importer.js';
import { labels, label } from '../options.js';
import { $, $$, csvEscape, fmtDate, html, raw, relTime, saveFile, toast } from '../util.js';

export async function render(root) {
  const settings = await getSettings();
  const [nSymptoms, metrics, lastBackup] = await Promise.all([count('symptoms'), getAll('metrics'), getMeta('lastBackup')]);
  const byType = {};
  let first = Infinity;
  let last = -Infinity;
  for (const m of metrics) {
    byType[m.type] = (byType[m.type] || 0) + 1;
    first = Math.min(first, m.ts);
    last = Math.max(last, m.ts);
  }

  root.innerHTML = html`
    <section class="section" style="margin-top:4px" aria-labelledby="imp-h">
      <h2 id="imp-h">Import Health data</h2>
      <label class="import-drop">
        <strong>Choose export files</strong>
        <span class="hint">Health Auto Export JSON or CSV, a Shortcut export, or a Symptom Log backup. Re-importing the same data is safe.</span>
        <input type="file" id="import-file" multiple accept=".json,.csv,.txt,application/json,text/csv,text/plain">
      </label>
      <div id="import-result" class="import-result" aria-live="polite"></div>
    </section>

    <section class="section" aria-labelledby="have-h">
      <h2 id="have-h">On this phone</h2>
      <div class="panel">
        <dl class="kv">
          <dt>Episodes logged</dt><dd>${nSymptoms}</dd>
          ${Object.keys(METRICS).filter((t) => byType[t]).map((t) => html`<dt>${METRICS[t].label}</dt><dd>${byType[t].toLocaleString()}</dd>`)}
          ${raw(metrics.length ? html`<dt>Health data covers</dt><dd>${fmtDate(first)} to ${fmtDate(last)}</dd>` : html`<dt>Health records</dt><dd>0</dd>`)}
        </dl>
      </div>
    </section>

    <section class="section" aria-labelledby="set-h">
      <h2 id="set-h">Settings</h2>
      <div class="panel stack">
        <div class="setting-row">
          <span id="unit-label"><strong>Weight unit</strong></span>
          <div class="segmented" role="group" aria-labelledby="unit-label">
            <button type="button" data-unit="lb" aria-pressed="${settings.weightUnit === 'lb'}">lb</button>
            <button type="button" data-unit="kg" aria-pressed="${settings.weightUnit === 'kg'}">kg</button>
          </div>
        </div>
        <div>
          <label for="report-name"><strong>Name on the doctor report</strong></label>
          <input type="text" id="report-name" value="${settings.reportName || ''}" placeholder="Optional" style="margin-top:6px">
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="bak-h">
      <h2 id="bak-h">Backup</h2>
      <div class="panel stack">
        <p>Your entries live only on this phone. Save a backup to Files or iCloud Drive now and then. ${lastBackup ? `Last backup ${relTime(lastBackup)}.` : 'No backup saved yet.'}</p>
        <div class="btn-row">
          <button type="button" class="btn primary" id="backup-btn">Save backup</button>
          <button type="button" class="btn" id="restore-btn">Restore backup</button>
        </div>
        <button type="button" class="btn block" id="csv-btn">Export episodes as a spreadsheet (CSV)</button>
        <input type="file" id="restore-file" accept=".json,application/json" hidden>
      </div>
    </section>

    <section class="section" aria-labelledby="help-h">
      <h2 id="help-h">Getting Health data in</h2>
      <div>
        <details class="help">
          <summary>Health Auto Export (easiest)</summary>
          <ol>
            <li>Install Health Auto Export from the App Store and allow it to read Health.</li>
            <li>Create an export: format JSON (or CSV), aggregation by Day for steps and energy is fine, and pick these metrics: blood pressure, weight, body fat, resting heart rate, heart rate variability, heart rate, sleep analysis, step count, active energy. Turn on workouts too.</li>
            <li>Export the last 30 days (or more) to Files.</li>
            <li>Come back here, tap Choose export files and pick the file.</li>
            <li>For ongoing updates, set up an automation in Health Auto Export that saves to iCloud Drive every day, then import the newest file whenever you like.</li>
          </ol>
        </details>
        <details class="help">
          <summary>Apple Shortcut (free)</summary>
          <p style="margin-top:8px">A Shortcut can read Health samples and save them as a text file this app understands. Step-by-step instructions are in the README on GitHub.</p>
        </details>
        <details class="help">
          <summary>Why aren’t my Fitbit numbers here?</summary>
          <p style="margin-top:8px">This app reads whatever reaches Apple Health. Check that the Fitbit app has permission to write to Health (Health app, Sharing, Apps), then export again.</p>
        </details>
      </div>
    </section>

    <section class="section" aria-labelledby="danger-h">
      <h2 id="danger-h">Start over</h2>
      <div class="panel stack">
        <p>Delete every episode and all imported Health data from this phone. Save a backup first if you might want it back.</p>
        <button type="button" class="btn danger block" id="wipe-btn">Delete all data</button>
      </div>
    </section>

    <p class="hint" style="margin-top:24px">Nothing you enter leaves this phone. The app has no server and no account.</p>
  `;
}

async function saveSettings(patch) {
  const current = await getSettings();
  await setMeta('settings', { ...current, ...patch });
}

function resultHtml(results) {
  return results
    .map((r) =>
      r.error
        ? html`<div class="import-result error">${r.name}: ${r.error}</div>`
        : html`<div class="panel" style="margin-top:10px">
            <strong>${r.name}</strong>
            <div class="hint">${r.kind}${r.from ? `, ${fmtDate(r.from)} to ${fmtDate(r.to)}` : ''}</div>
            <p style="margin-top:6px">${r.added.toLocaleString()} new, ${r.updated.toLocaleString()} already here and refreshed${r.skipped ? `, ${r.skipped} skipped` : ''}.</p>
            <ul>${Object.entries(r.byType).map(([t, n]) => html`<li>${METRICS[t] ? METRICS[t].label : t}: ${n.toLocaleString()}</li>`)}</ul>
          </div>`
    )
    .join('');
}

export function mounted(main, { rerender }) {
  const fileInput = $('#import-file', main);
  fileInput.addEventListener('change', async () => {
    const out = $('#import-result', main);
    const files = [...fileInput.files];
    if (!files.length) return;
    out.innerHTML = '<p class="hint">Importing…</p>';
    const results = [];
    for (const f of files) {
      try {
        const text = await f.text();
        results.push({ name: f.name, ...(await importText(text, f.name)) });
      } catch (err) {
        console.error(err);
        results.push({ name: f.name, error: err.message || String(err) });
      }
    }
    fileInput.value = '';
    sessionStorage.setItem('lastImport', resultHtml(results));
    await rerender();
  });

  const saved = sessionStorage.getItem('lastImport');
  if (saved) {
    $('#import-result', main).innerHTML = saved;
    sessionStorage.removeItem('lastImport');
    toast('Import finished');
  }

  $$('[data-unit]', main).forEach((b) =>
    b.addEventListener('click', async () => {
      await saveSettings({ weightUnit: b.dataset.unit });
      $$('[data-unit]', main).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      toast(`Weight in ${b.dataset.unit}`);
    })
  );

  $('#report-name', main).addEventListener('change', async (ev) => {
    await saveSettings({ reportName: ev.target.value.trim() });
    toast('Name saved');
  });

  $('#backup-btn', main).addEventListener('click', async () => {
    const data = await exportAll();
    const stamp = new Date().toISOString().slice(0, 10);
    const ok = await saveFile(`symptom-log-backup-${stamp}.json`, JSON.stringify(data), 'application/json');
    if (ok) {
      await setMeta('lastBackup', Date.now());
      toast('Backup saved');
      await rerender();
    }
  });

  const restore = $('#restore-file', main);
  $('#restore-btn', main).addEventListener('click', () => restore.click());
  restore.addEventListener('change', async () => {
    const f = restore.files[0];
    if (!f) return;
    try {
      const r = await importText(await f.text(), f.name);
      if (r.kind !== 'Symptom Log backup') throw new Error('That file isn’t a Symptom Log backup. Use Choose export files for Health data.');
      toast(`Restored: ${r.added} new records`);
      await rerender();
    } catch (err) {
      $('#import-result', main).innerHTML = html`<div class="import-result error">${err.message}</div>`;
      $('#import-result', main).scrollIntoView({ behavior: 'smooth' });
    }
  });

  $('#csv-btn', main).addEventListener('click', async () => {
    const rows = (await getAll('symptoms')).sort((a, b) => a.start - b.start);
    if (!rows.length) return toast('No episodes to export yet');
    const header = ['Date', 'Time', 'Intensity', 'Duration (min)', 'Feels like', 'Location', 'Spreads to', 'Doing before', 'Changes with', 'Also had', 'Notes'];
    const lines = [header.join(',')];
    for (const e of rows) {
      const d = new Date(e.start);
      lines.push(
        [
          d.toLocaleDateString('en-CA'),
          d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          e.intensity ?? '',
          e.durationMin ?? '',
          labels(e.painTypes),
          label(e.location),
          labels(e.radiates),
          labels(e.activity),
          labels(e.modifiers),
          labels(e.redFlags),
          e.notes || '',
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    await saveFile(`symptom-episodes-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
  });

  $('#wipe-btn', main).addEventListener('click', async () => {
    if (!confirm('Delete all episodes and Health data from this phone?')) return;
    const typed = prompt('This can’t be undone. Type DELETE to confirm.');
    if ((typed || '').trim().toUpperCase() !== 'DELETE') return toast('Nothing was deleted');
    await wipeAll();
    toast('All data deleted');
    await rerender();
  });
}
