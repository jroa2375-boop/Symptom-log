// Chart.js helpers. Charts are optional: if Chart.js hasn't loaded (first visit
// offline), a short note is shown instead and the rest of the app still works.

import { fmtDate } from './util.js';

const registry = new Map();

export function chartsAvailable() {
  return typeof window.Chart === 'function';
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function palette() {
  return {
    ink: css('--ink'),
    muted: css('--muted'),
    grid: css('--grid'),
    teal: css('--teal'),
    tealSoft: css('--teal-soft'),
    pain: css('--pain'),
    ochre: css('--ochre'),
    slate: css('--slate'),
    surface: css('--surface'),
  };
}

export function destroyCharts(root = document) {
  for (const [canvas, chart] of registry) {
    if (!document.contains(canvas) || root.contains(canvas)) {
      chart.destroy();
      registry.delete(canvas);
    }
  }
}

function unavailable(canvas) {
  const note = document.createElement('p');
  note.className = 'chart-missing';
  note.textContent = 'Charts load once you’re online.';
  canvas.replaceWith(note);
}

function baseOptions(p, { from, to, yTitle, y2 = false, compact = false }) {
  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    normalized: true,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => (items[0] ? fmtDate(items[0].parsed.x, { weekday: 'short', month: 'short', day: 'numeric' }) : ''),
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        min: from,
        max: to,
        grid: { display: false },
        border: { color: p.grid },
        ticks: {
          color: p.muted,
          maxTicksLimit: compact ? 3 : 5,
          maxRotation: 0,
          callback: (v) => fmtDate(v),
          font: { size: 11 },
        },
      },
      y: {
        grid: { color: p.grid },
        border: { display: false },
        ticks: { color: p.muted, maxTicksLimit: 4, font: { size: 11 } },
        title: yTitle ? { display: true, text: yTitle, color: p.muted, font: { size: 11 } } : undefined,
      },
    },
  };
  if (y2) {
    opts.scales.y2 = {
      position: 'right',
      min: 0,
      max: 10.5,
      grid: { display: false },
      border: { display: false },
      ticks: { display: false },
    };
  }
  return opts;
}

/**
 * Line chart of one or more daily series, with optional symptom episodes as red
 * markers sized by intensity.
 *   lines: [{ label, points: [[ts, v]], color?, dashed? }]
 *   episodes: [{ ts, intensity }]
 */
export function lineChart(canvas, { lines, episodes = [], from, to, yTitle, compact = false, yFormat }) {
  if (!canvas) return;
  if (!chartsAvailable()) return unavailable(canvas);
  const p = palette();
  const colors = [p.teal, p.slate, p.ochre];
  const datasets = lines.map((l, i) => ({
    type: 'line',
    label: l.label,
    data: l.points.map(([x, y]) => ({ x, y })),
    borderColor: l.color || colors[i % colors.length],
    backgroundColor: l.color || colors[i % colors.length],
    borderWidth: compact ? 1.75 : 2,
    borderDash: l.dashed ? [4, 4] : undefined,
    pointRadius: compact ? 0 : l.points.length > 60 ? 0 : 2,
    pointHoverRadius: 4,
    tension: 0.25,
    spanGaps: true,
    yAxisID: 'y',
  }));
  if (episodes.length) {
    datasets.push({
      type: 'scatter',
      label: 'Episode',
      data: episodes.map((e) => ({ x: e.ts, y: e.intensity ?? 5 })),
      yAxisID: 'y2',
      backgroundColor: p.pain,
      borderColor: p.surface,
      borderWidth: 1.5,
      pointRadius: episodes.map((e) => 3 + (e.intensity ?? 5) / 2.5),
      pointHoverRadius: 7,
      pointStyle: 'circle',
    });
  }
  const options = baseOptions(p, { from, to, yTitle, y2: episodes.length > 0, compact });
  if (yFormat) options.scales.y.ticks.callback = yFormat;
  options.plugins.tooltip.callbacks.label = (ctx) => {
    if (ctx.dataset.label === 'Episode') return ` Episode, intensity ${ctx.parsed.y}/10`;
    const v = yFormat ? yFormat(ctx.parsed.y) : Math.round(ctx.parsed.y * 10) / 10;
    return ` ${ctx.dataset.label}: ${v}`;
  };
  if (compact) {
    options.scales.y.ticks.display = false;
    options.scales.y.grid.display = false;
    options.scales.x.ticks.display = false;
    options.scales.x.border.display = false;
    options.plugins.tooltip.enabled = false;
  }
  const chart = new window.Chart(canvas, { type: 'line', data: { datasets }, options });
  registry.set(canvas, chart);
  return chart;
}

/** Horizontal bar chart for counts (e.g. episodes by activity). */
export function barChart(canvas, { labels, values, color, horizontal = true }) {
  if (!canvas) return;
  if (!chartsAvailable()) return unavailable(canvas);
  const p = palette();
  const chart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: color || p.pain, borderRadius: 3, maxBarThickness: 18 }],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: !horizontal ? false : true, color: p.grid },
          border: { display: false },
          ticks: { color: p.muted, precision: 0, font: { size: 11 } },
        },
        y: {
          grid: { display: horizontal ? false : true, color: p.grid },
          border: { display: false },
          ticks: { color: p.ink, precision: 0, font: { size: 12 } },
        },
      },
    },
  });
  registry.set(canvas, chart);
  return chart;
}
