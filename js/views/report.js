// Doctor report: a print-friendly summary for a chosen date range.

import { loadData, fmtMetric, series, weightOut, weightUnit } from '../data.js';
import { analyze, weeklyAverages } from '../analysis.js';
import { lineChart, palette } from '../charts.js';
import { durationLabel, label, labels } from '../options.js';
import { DAY, $, addDays, dayStart, fmtDate, fmtDateTime, fmtDuration, html, raw, round } from '../util.js';

let ctx = null;

function toDateInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromDateInput(v, endOfDay = false) {
  const [y, m, d] = v.split('-').map(Number);
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}

function countsLine(rows) {
  return rows.length ? rows.map(([l, v]) => `${l} ${v}`).join(', ') : 'Not recorded';
}

export async function render(root, { params }) {
  const data = await loadData();
  const now = Date.now();
  let from = params.from ? fromDateInput(params.from) : addDays(dayStart(now), -89);
  let to = params.to ? fromDateInput(params.to, true) : now;
  if (Number.isNaN(from)) from = addDays(dayStart(now), -89);
  if (Number.isNaN(to)) to = now;
  if (from > to) [from, to] = [dayStart(to), from + DAY - 1];
  const a = analyze(data, from, to);
  const s = data.settings;
  ctx = { data, a, from, to };

  const weeks = {
    sys: weeklyAverages(data.days.bp_sys, from, to),
    dia: weeklyAverages(data.days.bp_dia, from, to),
    rhr: weeklyAverages(data.days.resting_hr, from, to),
    hrv: weeklyAverages(data.days.hrv, from, to),
    weight: weeklyAverages(data.days.weight, from, to),
    sleep: weeklyAverages(data.days.sleep, from, to),
  };
  const weekRows = weeks.sys
    .map((w, i) => ({ start: w[0], sys: w[1], dia: weeks.dia[i][1], rhr: weeks.rhr[i][1], hrv: weeks.hrv[i][1], weight: weeks.weight[i][1], sleep: weeks.sleep[i][1], episodes: a.perWeek[i] ? a.perWeek[i][1] : 0 }))
    .filter((r) => r.sys != null || r.rhr != null || r.hrv != null || r.weight != null || r.sleep != null || r.episodes);
  const st = a.stats;
  const hasBp = (data.metrics.bp || []).some((r) => r.ts >= from && r.ts <= to);
  const hasRhr = series(data.days.resting_hr, from, to).length > 0;
  const hasWeight = series(data.days.weight, from, to).length > 0;
  const hasSleep = series(data.days.sleep, from, to).length > 0;

  root.innerHTML = html`
    <form class="report-controls panel" id="report-form">
      <div class="dates">
        <div><label for="r-from">From</label><input type="date" id="r-from" value="${toDateInput(from)}"></div>
        <div><label for="r-to">To</label><input type="date" id="r-to" value="${toDateInput(to)}"></div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button type="submit" class="btn">Update</button>
        <button type="button" class="btn primary" id="print-btn">Print or save as PDF</button>
      </div>
      <p class="hint" style="margin-top:8px">In the print sheet, pinch out on the preview (or tap Share) to save it as a PDF.</p>
    </form>

    <article class="report" aria-label="Report">
      <h2>Chest pain symptom report</h2>
      <p class="meta">${s.reportName ? `${s.reportName}. ` : ''}${fmtDate(from, { month: 'long', day: 'numeric', year: 'numeric' })} to ${fmtDate(to, { month: 'long', day: 'numeric', year: 'numeric' })}. Prepared ${fmtDate(now, { month: 'long', day: 'numeric', year: 'numeric' })} from a self-kept symptom log and Apple Health data (Fitbit, Omron blood pressure cuff, scale).</p>

      <h3>Summary</h3>
      <div class="stat-line">
        <div><b>${st.count}</b>episodes (${round(st.perWeek, 1) ?? 0} a week)</div>
        <div><b>${st.avgIntensity != null ? `${round(st.avgIntensity, 1)}/10` : '–'}</b>average intensity, worst ${st.maxIntensity ?? '–'}/10</div>
        <div><b>${st.medianDuration != null ? fmtDuration(st.medianDuration) : '–'}</b>typical duration (median)</div>
        <div><b>${st.redFlagCount}</b>with shortness of breath, sweating, dizziness or nausea</div>
      </div>

      <h3>Episode characteristics</h3>
      <table>
        <tbody>
          <tr><th scope="row">Feels like</th><td>${countsLine(a.byType)}</td></tr>
          <tr><th scope="row">Location</th><td>${countsLine(a.byLocation)}</td></tr>
          <tr><th scope="row">Spreads to</th><td>${countsLine(a.byRadiates)}</td></tr>
          <tr><th scope="row">Doing just before</th><td>${countsLine(a.byActivity)}</td></tr>
          <tr><th scope="row">Changes with</th><td>${countsLine(a.byModifier)}</td></tr>
          <tr><th scope="row">Time of day</th><td>${countsLine(a.byTime.filter(([, v]) => v))}</td></tr>
        </tbody>
      </table>

      <h3>Patterns noticed</h3>
      ${raw(a.summaries.length
        ? html`<ul>${a.summaries.map((x) => html`<li style="margin-bottom:6px">${x.text}</li>`)}</ul>`
        : '<p>Not enough data in this period for comparisons.</p>')}
      <p class="hint">Correlations from personal records with small sample sizes; not a diagnosis.</p>

      ${raw(hasBp ? html`<h3>Blood pressure</h3><div class="chart-box"><canvas id="r-bp" role="img" aria-label="Blood pressure with episodes marked"></canvas></div>` : '')}
      ${raw(hasRhr ? html`<h3>Resting heart rate</h3><div class="chart-box"><canvas id="r-rhr" role="img" aria-label="Resting heart rate with episodes marked"></canvas></div>` : '')}
      ${raw(hasSleep ? html`<h3>Sleep</h3><div class="chart-box"><canvas id="r-sleep" role="img" aria-label="Sleep with episodes marked"></canvas></div>` : '')}
      ${raw(hasWeight ? html`<h3>Weight</h3><div class="chart-box"><canvas id="r-weight" role="img" aria-label="Weight with episodes marked"></canvas></div>` : '')}
      ${raw(hasBp || hasRhr || hasSleep || hasWeight ? '<p class="hint">Red dots are episodes; bigger dots were more intense.</p>' : '')}

      ${raw(weekRows.length ? html`<h3>Weekly averages</h3>
        <table>
          <thead><tr><th>Week of</th><th>Episodes</th><th>BP</th><th>Resting HR</th><th>HRV</th><th>Sleep</th><th>Weight</th></tr></thead>
          <tbody>${weekRows.map((r) => html`<tr>
            <td>${fmtDate(r.start)}</td>
            <td>${r.episodes}</td>
            <td>${r.sys != null ? `${Math.round(r.sys)}/${Math.round(r.dia)}` : '–'}</td>
            <td>${r.rhr != null ? Math.round(r.rhr) : '–'}</td>
            <td>${r.hrv != null ? Math.round(r.hrv) : '–'}</td>
            <td>${r.sleep != null ? fmtMetric('sleep', r.sleep, s) : '–'}</td>
            <td>${r.weight != null ? round(weightOut(r.weight, s), 1) : '–'}</td>
          </tr>`)}</tbody>
        </table>
        <p class="hint">BP in mmHg, heart rate in bpm, HRV in ms, weight in ${weightUnit(s)}.</p>` : '')}

      <h3>All episodes</h3>
      ${raw(a.episodes.length
        ? html`<table>
          <thead><tr><th>When</th><th>Pain</th><th>Details</th></tr></thead>
          <tbody>${[...a.episodes].reverse().map((e) => html`<tr>
            <td style="white-space:nowrap">${fmtDateTime(e.start)}</td>
            <td><strong>${e.intensity ?? '–'}/10</strong>${raw(e.durationMin != null ? html`<br>${durationLabel(e.durationMin) || fmtDuration(e.durationMin)}` : '')}</td>
            <td>${[
              labels(e.painTypes),
              label(e.location),
              (e.radiates || []).filter((r) => r !== 'none').length ? `spreads to ${labels(e.radiates.filter((r) => r !== 'none')).toLowerCase()}` : '',
              (e.activity || []).length ? `before: ${labels(e.activity).toLowerCase()}` : '',
              (e.modifiers || []).length ? `changes with: ${labels(e.modifiers).toLowerCase()}` : '',
              (e.redFlags || []).length ? `WITH ${labels(e.redFlags).toLowerCase()}` : '',
            ].filter(Boolean).join('; ')}${raw(e.notes ? html`<br><em>${e.notes}</em>` : '')}</td>
          </tr>`)}</tbody>
        </table>`
        : '<p>No episodes in this period.</p>')}

      <p class="disclaimer">Self-recorded data from a personal tracking app. Device readings can be inaccurate, and the patterns above are associations, not evidence of cause.</p>
    </article>
  `;
}

export function mounted(main) {
  const form = $('#report-form', main);
  if (!form) return;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = $('#r-from', form).value;
    const t = $('#r-to', form).value;
    location.hash = `#report?from=${f}&to=${t}`;
  });
  $('#print-btn', main).addEventListener('click', () => window.print());

  const { data, a, from, to } = ctx;
  const p = palette();
  const s = data.settings;
  const episodes = a.episodes.map((e) => ({ ts: e.start, intensity: e.intensity }));
  const draw = (id, lines, yFormat) => {
    const c = $(`#${id}`, main);
    if (c) lineChart(c, { lines, episodes, from, to, yFormat });
  };
  draw('r-bp', [
    { label: 'Systolic', points: series(data.days.bp_sys, from, to), color: p.teal },
    { label: 'Diastolic', points: series(data.days.bp_dia, from, to), color: p.slate },
  ]);
  draw('r-rhr', [{ label: 'Resting HR', points: series(data.days.resting_hr, from, to) }]);
  draw('r-sleep', [{ label: 'Sleep', points: series(data.days.sleep, from, to) }], (v) => `${round(v, 1)}h`);
  draw('r-weight', [{ label: 'Weight', points: series(data.days.weight, from, to).map(([t, v]) => [t, weightOut(v, s)]) }]);
}
