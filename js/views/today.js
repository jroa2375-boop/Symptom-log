// Dashboard: today's episodes plus Bevel-style cards for each metric.

import { getMeta } from '../db.js';
import { loadData, fmtMetric, series, windowValues } from '../data.js';
import { lineChart, palette } from '../charts.js';
import { DAY, addDays, dayKey, dayStart, fmtDate, fmtTime, html, mean, raw, relTime, round, sd } from '../util.js';
import { label } from '../options.js';

let sparks = [];
let lastData = null;

function latestEntry(map) {
  let best = null;
  for (const [k, v] of map) if (!best || k > best[0]) best = [k, v];
  return best;
}

function deltaText(type, now, prev, settings) {
  if (now == null || prev == null) return '';
  const d = now - prev;
  const scale = type === 'weight' && settings.weightUnit === 'lb' ? 2.20462 : 1;
  const shown = Math.abs(d * scale);
  const decimals = type === 'weight' || type === 'body_fat' ? 1 : type === 'sleep' ? 1 : 0;
  const r = round(shown, decimals);
  if (!r) return 'same as the week before';
  let unit = '';
  if (type === 'weight') unit = ` ${settings.weightUnit}`;
  else if (type === 'sleep') unit = ' h';
  else if (type === 'body_fat') unit = ' pts';
  else if (type === 'hrv') unit = ' ms';
  else if (type === 'resting_hr') unit = ' bpm';
  return html`<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? 'up' : 'down'} ${type === 'steps' ? Math.round(shown).toLocaleString() : r}${unit}</span> vs the week before`;
}

function card({ id, title, value, sub, type, map, wide = false, extra = '' }) {
  const has = value != null && value !== '–';
  if (has && map) sparks.push({ id, map, type });
  return html`<div class="metric${wide ? ' wide' : ''}">
    <div class="m-label">${title}</div>
    ${raw(has
      ? html`<div class="m-value">${value}</div>
        ${raw(sub ? html`<div class="m-sub">${raw(sub)}</div>` : '')}
        ${raw(extra)}
        ${raw(map ? html`<div class="spark"><canvas id="spark-${id}" aria-hidden="true"></canvas></div>` : '')}`
      : html`<div class="m-empty">No readings yet</div>`)}
  </div>`;
}

function weekly(map, today) {
  const cur = windowValues(map, today, 7);
  const prev = windowValues(map, addDays(today, -7), 7);
  return { cur: mean(cur), prev: mean(prev), n: cur.length };
}

export async function render(root) {
  sparks = [];
  const data = await loadData();
  lastData = data;
  const { days, symptoms, settings, metrics } = data;
  const now = Date.now();
  const todayStart = dayStart(now);
  const tKey = dayKey(now);

  const todays = symptoms.filter((e) => e.start >= todayStart);
  const last = symptoms[0];
  const week = symptoms.filter((e) => e.start >= now - 7 * DAY);
  const hasHealth = data.dataDays.size > 0;

  const lastBackup = await getMeta('lastBackup');
  const needsBackup = (symptoms.length >= 3 || hasHealth) && (!lastBackup || now - lastBackup > 14 * DAY);

  let healthHtml;
  if (!hasHealth) {
    healthHtml = html`<div class="empty">
      <h2>Bring in your Health data</h2>
      <p>Import an export from Health Auto Export or an Apple Shortcut to see blood pressure, sleep, heart rate, weight and activity here.</p>
      <a class="btn primary" href="#settings">Import Health data</a>
    </div>`;
  } else {
    // Blood pressure
    const bpList = metrics.bp || [];
    const lastBp = bpList[bpList.length - 1];
    const bp7 = bpList.filter((r) => r.ts >= now - 7 * DAY);
    const bpCard = lastBp
      ? html`<div class="metric wide">
          <div class="m-label">Blood pressure</div>
          <div class="m-value">${Math.round(lastBp.value)}/${Math.round(lastBp.value2)} <span class="hint">mmHg</span></div>
          <div class="m-sub">${fmtDate(lastBp.ts, { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(lastBp.ts)}${bp7.length ? `. 7-day average ${Math.round(mean(bp7.map((r) => r.value)))}/${Math.round(mean(bp7.map((r) => r.value2)))} from ${bp7.length} reading${bp7.length === 1 ? '' : 's'}` : '. No readings in the last 7 days'}</div>
          <div class="spark" style="height:56px"><canvas id="spark-bp" aria-hidden="true"></canvas></div>
        </div>`
      : card({ id: 'bp', title: 'Blood pressure', value: null });
    if (lastBp) sparks.push({ id: 'bp', bp: true });

    // Recovery: HRV and resting HR against a 30-day baseline (excluding today)
    const baseline = (map) => {
      const vals = windowValues(map, addDays(now, -1), 30);
      return { m: mean(vals), s: sd(vals), n: vals.length };
    };
    const hrvLatest = latestEntry(days.hrv);
    const rhrLatest = latestEntry(days.resting_hr);
    const hrvB = baseline(days.hrv);
    const rhrB = baseline(days.resting_hr);
    const status = (v, b, higherIsGood) => {
      if (v == null || b.m == null || b.n < 7) return html`<span class="badge">Building baseline</span>`;
      const z = (v - b.m) / (b.s || 1);
      const good = higherIsGood ? z >= -0.5 : z <= 0.5;
      const word = higherIsGood ? (z >= 0.5 ? 'Above baseline' : good ? 'Normal' : 'Below baseline') : z <= -0.5 ? 'Below baseline' : good ? 'Normal' : 'Elevated';
      return html`<span class="badge ${good ? 'good' : 'low'}">${word}</span>`;
    };
    const recovery = hrvLatest || rhrLatest
      ? html`<div class="metric wide">
          <div class="m-label">Recovery, compared with your 30-day baseline</div>
          <div class="recovery-row">
            <div>
              <div class="m-value">${hrvLatest ? fmtMetric('hrv', hrvLatest[1], settings) : '–'}</div>
              <div class="m-sub">HRV${hrvB.m != null ? `, baseline ${Math.round(hrvB.m)} ms` : ''}</div>
              ${raw(hrvLatest ? status(hrvLatest[1], hrvB, true) : '')}
            </div>
            <div>
              <div class="m-value">${rhrLatest ? fmtMetric('resting_hr', rhrLatest[1], settings) : '–'}</div>
              <div class="m-sub">Resting HR${rhrB.m != null ? `, baseline ${Math.round(rhrB.m)} bpm` : ''}</div>
              ${raw(rhrLatest ? status(rhrLatest[1], rhrB, false) : '')}
            </div>
          </div>
          <div class="spark" style="height:52px"><canvas id="spark-recovery" aria-hidden="true"></canvas></div>
        </div>`
      : '';
    if (hrvLatest || rhrLatest) sparks.push({ id: 'recovery', recovery: true });

    // Sleep
    const sleepLatest = latestEntry(days.sleep);
    const sleepRec = sleepLatest ? (metrics.sleep || []).filter((r) => dayKey(r.ts) === sleepLatest[0]).pop() : null;
    const sw = weekly(days.sleep, now);
    const p = palette();
    let stages = '';
    if (sleepRec && (sleepRec.deep || sleepRec.rem || sleepRec.core)) {
      const parts = [['deep', 'Deep', p.slate], ['core', 'Core', p.teal], ['rem', 'REM', p.ochre], ['awake', 'Awake', p.pain]].filter(([k]) => sleepRec[k] > 0);
      const total = parts.reduce((a, [k]) => a + sleepRec[k], 0);
      stages = html`<div class="stages">${parts.map(([k, , c]) => html`<span style="width:${(sleepRec[k] / total) * 100}%;background:${c}"></span>`)}</div>
        <div class="stage-key">${parts.map(([k, l, c]) => html`<span><i style="background:${c}"></i>${l} ${fmtMetric('sleep', sleepRec[k], settings)}</span>`)}</div>`;
    }
    const sleepWhen = sleepLatest ? (sleepLatest[0] === tKey ? 'Last night' : `Night before ${fmtDate(new Date(sleepLatest[0] + 'T12:00').getTime())}`) : '';
    const sleepCard = card({
      id: 'sleep',
      title: 'Sleep',
      value: sleepLatest ? fmtMetric('sleep', sleepLatest[1], settings) : null,
      sub: `${sleepWhen}${sw.cur != null ? `. 7-day average ${fmtMetric('sleep', sw.cur, settings)}` : ''}`,
      map: days.sleep,
      type: 'sleep',
      wide: true,
      extra: stages,
    });

    const simple = (id, title, type, opts = {}) => {
      const map = days[type];
      const latest = latestEntry(map);
      const w = weekly(map, now);
      let value = latest ? fmtMetric(type, latest[1], settings) : null;
      let sub = '';
      if (opts.daily) {
        const t = map.get(tKey);
        value = latest ? fmtMetric(type, t ?? 0, settings) : null;
        sub = w.cur != null ? `Today. 7-day average ${fmtMetric(type, w.cur, settings)}` : 'Today';
      } else if (latest) {
        const when = latest[0] === tKey ? 'Today' : fmtDate(new Date(latest[0] + 'T12:00').getTime());
        sub = `${when}${w.prev != null && w.cur != null ? `. Week average ${deltaText(type, w.cur, w.prev, settings)}` : ''}`;
      }
      return card({ id, title, value, sub, map, type });
    };

    const wk = (metrics.workout || []).filter((w) => w.ts >= now - 7 * DAY);
    const workoutCard = html`<div class="metric">
      <div class="m-label">Workouts, last 7 days</div>
      ${raw((metrics.workout || []).length
        ? html`<div class="m-value">${wk.length}</div><div class="m-sub">${wk.length ? `${Math.round(wk.reduce((a, w) => a + (w.value || 0), 0))} min total. Latest: ${wk[wk.length - 1].name}` : `Last one ${relTime(metrics.workout[metrics.workout.length - 1].ts)}`}</div>`
        : html`<div class="m-empty">No workouts yet</div>`)}
    </div>`;

    healthHtml = html`
      <div class="grid-2">
        ${raw(bpCard)}
        ${raw(recovery)}
        ${raw(sleepCard)}
        ${raw(simple('weight', 'Weight', 'weight'))}
        ${raw(simple('body_fat', 'Body fat', 'body_fat'))}
        ${raw(simple('resting_hr', 'Resting heart rate', 'resting_hr'))}
        ${raw(simple('hrv', 'HRV', 'hrv'))}
        ${raw(simple('steps', 'Steps', 'steps', { daily: true }))}
        ${raw(simple('energy', 'Active energy', 'active_energy', { daily: true }))}
        ${raw(workoutCard)}
      </div>`;
  }

  root.innerHTML = html`
    <div class="today-strip">
      <div class="count${todays.length ? '' : ' zero'}">${todays.length}</div>
      <div><strong>${todays.length === 1 ? 'episode today' : 'episodes today'}</strong></div>
      <div class="hint">${last
        ? `Last: ${relTime(last.start)}, intensity ${last.intensity ?? '?'}/10${last.location ? `, ${label(last.location).toLowerCase()}` : ''}. ${week.length} in the last 7 days.`
        : 'Nothing logged yet.'}</div>
    </div>
    ${raw(needsBackup ? html`<div class="caveat" style="margin-top:12px">Your data only lives on this phone. <a href="#settings">Save a backup</a>${lastBackup ? `; the last one was ${relTime(lastBackup)}` : ''}.</div>` : '')}
    <section class="section">
      <div class="section-head"><h2>Health</h2>${raw(hasHealth ? html`<a class="hint" href="#settings">Import more</a>` : '')}</div>
      ${raw(healthHtml)}
    </section>
  `;
}

export function mounted(main) {
  const d = lastData;
  if (!d) return;
  const to = Date.now();
  const from = addDays(dayStart(to), -13);
  const f30 = addDays(dayStart(to), -29);
  const p = palette();
  for (const s of sparks) {
    const canvas = main.querySelector(`#spark-${s.id}`);
    if (!canvas) continue;
    if (s.bp) {
      lineChart(canvas, {
        lines: [
          { label: 'Systolic', points: series(d.days.bp_sys, f30, to), color: p.teal },
          { label: 'Diastolic', points: series(d.days.bp_dia, f30, to), color: p.slate },
        ],
        from: f30,
        to,
        compact: true,
      });
    } else if (s.recovery) {
      lineChart(canvas, { lines: [{ label: 'HRV', points: series(d.days.hrv, f30, to), color: p.teal }], from: f30, to, compact: true });
    } else {
      lineChart(canvas, { lines: [{ label: s.type, points: series(s.map, from, to) }], from, to, compact: true });
    }
  }
}
