// Patterns: episodes against the health data, comparisons and breakdowns.

import { loadData, fmtMetric, series, weightOut, weightUnit } from '../data.js';
import { analyze } from '../analysis.js';
import { barChart, destroyCharts, lineChart, palette } from '../charts.js';
import { DAY, $, $$, addDays, dayStart, fmtDate, html, raw, round } from '../util.js';

export const RANGES = [
  ['30', 'Last 30 days'],
  ['90', '90 days'],
  ['180', '6 months'],
  ['all', 'All time'],
];

const TIMELINE = [
  ['sleep', 'Sleep'],
  ['hrv', 'HRV'],
  ['resting_hr', 'Resting HR'],
  ['bp', 'Blood pressure'],
  ['steps', 'Steps'],
  ['heart_rate', 'Heart rate'],
  ['weight', 'Weight'],
  ['active_energy', 'Active energy'],
];

let state = { metric: 'sleep' };
let ctx = null;

export function rangeBounds(range, data) {
  const to = Date.now();
  if (range === 'all') {
    const times = [...data.symptoms.map((e) => e.start)];
    for (const list of Object.values(data.metrics)) if (list.length) times.push(list[0].ts);
    const first = times.length ? Math.min(...times) : to - 30 * DAY;
    return { from: dayStart(first), to };
  }
  return { from: addDays(dayStart(to), -(Number(range) - 1)), to };
}

export async function render(root, { params }) {
  const range = RANGES.some(([r]) => r === params.range) ? params.range : '90';
  const data = await loadData();
  const { from, to } = rangeBounds(range, data);
  const a = analyze(data, from, to);
  ctx = { data, a, from, to, range };
  const s = data.settings;

  const picker = html`<div class="range-picker" role="group" aria-label="Date range">
    ${RANGES.map(([r, l]) => html`<a class="chip" href="#patterns?range=${r}" aria-pressed="${r === range ? 'true' : 'false'}">${l}</a>`)}
  </div>`;

  if (!data.symptoms.length) {
    root.innerHTML = html`${raw(picker)}
      <div class="empty" style="margin-top:18px">
        <h2>No episodes yet</h2>
        <p>Patterns appear once you’ve logged a few episodes. Each one you log gets lined up against your sleep, heart rate, blood pressure and activity.</p>
        <a class="btn primary" href="#log">Log an episode</a>
      </div>`;
    return;
  }

  const st = a.stats;
  const hasHealth = data.dataDays.size > 0;

  root.innerHTML = html`
    ${raw(picker)}

    <section class="section">
      <p style="font-size:var(--step-1)"><strong>${st.count} ${st.count === 1 ? 'episode' : 'episodes'}</strong> from ${fmtDate(from)} to ${fmtDate(to)}${st.count ? `, about ${round(st.perWeek, 1)} a week. Average intensity ${round(st.avgIntensity, 1)}/10` : ''}.</p>
    </section>

    <section class="section" aria-labelledby="find-h">
      <h2 id="find-h">What stands out</h2>
      ${raw(a.summaries.length
        ? html`<div class="panel" style="padding-block:4px"><ul class="findings">${a.summaries.slice(0, 8).map((x) => html`<li>${x.text}</li>`)}</ul></div>`
        : html`<div class="empty"><p>${st.count < 3 ? 'Log at least 3 episodes in this range to see patterns.' : hasHealth ? 'Nothing stands out yet. More episodes and more days of Health data will make comparisons possible.' : 'Import your Health data to compare episodes with sleep, heart rate and blood pressure.'}</p>${raw(!hasHealth ? '<a class="btn" href="#settings">Import Health data</a>' : '')}</div>`)}
      <p class="caveat" style="margin-top:12px">These are patterns in your own records, not a diagnosis. Small numbers can mislead, so the sample size is shown with each one. Bring them to your doctor rather than drawing conclusions alone.</p>
    </section>

    <section class="section" aria-labelledby="tl-h">
      <h2 id="tl-h">Episodes on the timeline</h2>
      <div class="metric-picker" role="group" aria-label="Metric">
        ${TIMELINE.map(([id, l]) => html`<button type="button" class="chip" data-metric="${id}" aria-pressed="${id === state.metric ? 'true' : 'false'}">${l}</button>`)}
      </div>
      <div class="panel" style="margin-top:6px">
        <div class="chart-box"><canvas id="timeline" role="img" aria-label="Chart of the selected metric with episodes marked"></canvas></div>
        <div class="legend-inline" id="tl-legend"></div>
      </div>
    </section>

    <section class="section" aria-labelledby="cmp-h">
      <h2 id="cmp-h">Episode days vs other days</h2>
      ${raw(a.comparisons.length
        ? html`<div class="panel">
          <table class="compare">
            <thead><tr><th scope="col">Average</th><th scope="col">Episode days</th><th scope="col">Other days</th></tr></thead>
            <tbody>
              ${a.comparisons.map((c) => html`<tr class="${c.notable ? 'notable' : ''}">
                <td>${c.label}</td>
                <td>${fmtMetric(c.type, c.symptom, s)}<span class="n" style="display:block">${c.nS} days</span></td>
                <td>${fmtMetric(c.type, c.free, s)}<span class="n" style="display:block">${c.nF} days</span></td>
              </tr>`)}
              ${a.workoutCompares.map((w) => html`<tr>
                <td>${w.label}</td>
                <td>${w.nS ? `${Math.round((w.symptomYes / w.nS) * 100)}%` : '–'}<span class="n" style="display:block">${w.symptomYes} of ${w.nS}</span></td>
                <td>${w.nF ? `${Math.round((w.freeYes / w.nF) * 100)}%` : '–'}<span class="n" style="display:block">${w.freeYes} of ${w.nF}</span></td>
              </tr>`)}
            </tbody>
          </table>
          <p class="hint" style="margin-top:10px">A dot marks a difference of at least half a standard deviation with 3 or more days on each side.</p>
        </div>`
        : html`<div class="empty"><p>Import Health data to compare episode days with the rest.</p></div>`)}
    </section>

    <section class="section" aria-labelledby="bd-h">
      <h2 id="bd-h">When and how episodes happen</h2>
      <div class="stack">
        ${raw(breakdown('Time of day', 'bd-time', a.byTime))}
        ${raw(breakdown('Day of week', 'bd-week', a.byWeekday, false))}
        ${raw(breakdown('Doing just before', 'bd-act', a.byActivity))}
        ${raw(breakdown('What changes it', 'bd-mod', a.byModifier))}
        ${raw(breakdown('What it feels like', 'bd-type', a.byType))}
        ${raw(breakdown('Spreads to', 'bd-rad', a.byRadiates))}
      </div>
    </section>

    <section class="section" aria-labelledby="wk-h">
      <h2 id="wk-h">Episodes per week</h2>
      <div class="panel"><div class="chart-box short"><canvas id="per-week" role="img" aria-label="Episodes per week"></canvas></div></div>
    </section>
  `;
}

function breakdown(title, id, rows, horizontal = true) {
  const has = rows.some(([, v]) => v > 0);
  const h = horizontal ? Math.max(90, rows.length * 30 + 20) : 150;
  return html`<div class="panel">
    <h3 style="font-size:var(--step-0)">${title}</h3>
    ${raw(has
      ? html`<div class="chart-box" style="height:${h}px;margin-top:6px"><canvas id="${id}" role="img" aria-label="${title}: ${rows.map(([l, v]) => `${l} ${v}`).join(', ')}"></canvas></div>`
      : '<p class="hint" style="margin-top:6px">Not recorded yet.</p>')}
  </div>`;
}

function drawTimeline(main) {
  const { data, a, from, to } = ctx;
  const p = palette();
  const canvas = $('#timeline', main);
  const episodes = a.episodes.map((e) => ({ ts: e.start, intensity: e.intensity }));
  let lines;
  let yFormat;
  const s = data.settings;
  switch (state.metric) {
    case 'bp':
      lines = [
        { label: 'Systolic', points: series(data.days.bp_sys, from, to), color: p.teal },
        { label: 'Diastolic', points: series(data.days.bp_dia, from, to), color: p.slate },
      ];
      break;
    case 'weight':
      lines = [{ label: `Weight (${weightUnit(s)})`, points: series(data.days.weight, from, to).map(([t, v]) => [t, weightOut(v, s)]) }];
      break;
    case 'sleep':
      lines = [{ label: 'Sleep (h)', points: series(data.days.sleep, from, to) }];
      yFormat = (v) => `${round(v, 1)}h`;
      break;
    default:
      lines = [{ label: TIMELINE.find(([id]) => id === state.metric)[1], points: series(data.days[state.metric], from, to) }];
  }
  const has = lines.some((l) => l.points.length);
  const legend = $('#tl-legend', main);
  legend.innerHTML = html`${lines.map((l, i) => html`<span><i class="line" style="background:${l.color || [p.teal, p.slate][i]}"></i>${l.label}</span>`)}
    <span><i style="background:${p.pain}"></i>Episode (bigger = worse)</span>
    ${raw(has ? '' : '<span>No readings for this metric in this range</span>')}`;
  if (canvas) lineChart(canvas, { lines, episodes, from, to, yFormat });
}

export function mounted(main) {
  if (!ctx || !$('#timeline', main)) return;
  const { a } = ctx;
  const p = palette();
  drawTimeline(main);

  $$('[data-metric]', main).forEach((b) =>
    b.addEventListener('click', () => {
      state.metric = b.dataset.metric;
      $$('[data-metric]', main).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      const canvas = $('#timeline', main);
      if (canvas) destroyCharts(canvas.parentElement);
      drawTimeline(main);
    })
  );

  const bars = [
    ['bd-time', a.byTime.map(([l, v]) => [l.replace(/ \(.*/, ''), v])],
    ['bd-week', a.byWeekday, false],
    ['bd-act', a.byActivity],
    ['bd-mod', a.byModifier],
    ['bd-type', a.byType],
    ['bd-rad', a.byRadiates],
  ];
  for (const [id, rows, horizontal = true] of bars) {
    const c = $(`#${id}`, main);
    if (c) barChart(c, { labels: rows.map((r) => r[0]), values: rows.map((r) => r[1]), horizontal, color: id === 'bd-mod' || id === 'bd-act' ? p.slate : p.pain });
  }
  const wk = $('#per-week', main);
  if (wk) {
    barChart(wk, {
      labels: a.perWeek.map(([t]) => fmtDate(t)),
      values: a.perWeek.map(([, v]) => v),
      horizontal: false,
    });
  }
}
