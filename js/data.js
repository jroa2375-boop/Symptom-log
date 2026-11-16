// Loads everything once per screen and turns raw samples into daily values.

import { getAll, getMeta } from './db.js';
import { dayKey, mean, round, sum } from './util.js';

export const METRICS = {
  bp: { label: 'Blood pressure', unit: 'mmHg', decimals: 0 },
  weight: { label: 'Weight', unit: 'kg', decimals: 1 },
  body_fat: { label: 'Body fat', unit: '%', decimals: 1 },
  resting_hr: { label: 'Resting HR', unit: 'bpm', decimals: 0 },
  hrv: { label: 'HRV', unit: 'ms', decimals: 0 },
  heart_rate: { label: 'Heart rate', unit: 'bpm', decimals: 0 },
  sleep: { label: 'Sleep', unit: 'h', decimals: 1 },
  steps: { label: 'Steps', unit: '', decimals: 0 },
  active_energy: { label: 'Active energy', unit: 'kcal', decimals: 0 },
  workout: { label: 'Workouts', unit: '', decimals: 0 },
};

export const DEFAULT_SETTINGS = { weightUnit: 'lb' };

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await getMeta('settings', {})) };
}

const KG_TO_LB = 2.20462;

export function weightOut(kg, settings) {
  if (kg == null) return null;
  return settings.weightUnit === 'lb' ? kg * KG_TO_LB : kg;
}

export function weightUnit(settings) {
  return settings.weightUnit === 'lb' ? 'lb' : 'kg';
}

/**
 * Snapshot of all data with daily rollups:
 *   days[type] : Map(dayKey -> number)   (bp uses sys/dia maps)
 */
export async function loadData() {
  const [symptoms, metrics, settings] = await Promise.all([getAll('symptoms'), getAll('metrics'), getSettings()]);
  symptoms.sort((a, b) => b.start - a.start);

  const byType = {};
  for (const m of metrics) (byType[m.type] ||= []).push(m);
  for (const t of Object.keys(byType)) byType[t].sort((a, b) => a.ts - b.ts);

  const group = (type) => {
    const map = new Map();
    for (const m of byType[type] || []) {
      const k = dayKey(m.ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m);
    }
    return map;
  };
  const rollup = (type, fn) => {
    const out = new Map();
    for (const [k, list] of group(type)) {
      const v = fn(list);
      if (v != null && !Number.isNaN(v)) out.set(k, v);
    }
    return out;
  };
  const last = (list) => list[list.length - 1].value;

  const days = {
    steps: rollup('steps', (l) => sum(l.map((m) => m.value))),
    active_energy: rollup('active_energy', (l) => sum(l.map((m) => m.value))),
    heart_rate: rollup('heart_rate', (l) => mean(l.map((m) => m.value))),
    resting_hr: rollup('resting_hr', (l) => mean(l.map((m) => m.value))),
    hrv: rollup('hrv', (l) => mean(l.map((m) => m.value))),
    weight: rollup('weight', last),
    body_fat: rollup('body_fat', last),
    sleep: rollup('sleep', (l) => sum(l.map((m) => m.value))),
    bp_sys: rollup('bp', (l) => mean(l.map((m) => m.value))),
    bp_dia: rollup('bp', (l) => mean(l.map((m) => m.value2))),
    workout: rollup('workout', (l) => l.length),
  };

  // Every day that has any health data at all, so "symptom-free" days are real days we know about.
  const dataDays = new Set();
  for (const map of Object.values(days)) for (const k of map.keys()) dataDays.add(k);

  return { symptoms, metrics: byType, days, dataDays, settings };
}

/** Readable value for a metric's daily number. */
export function fmtMetric(type, v, settings) {
  if (v == null || Number.isNaN(v)) return '–';
  switch (type) {
    case 'weight':
      return `${round(weightOut(v, settings), 1)} ${weightUnit(settings)}`;
    case 'body_fat':
      return `${round(v, 1)}%`;
    case 'sleep': {
      const h = Math.floor(v);
      const m = Math.round((v - h) * 60);
      return m === 60 ? `${h + 1}h` : m ? `${h}h ${m}m` : `${h}h`;
    }
    case 'steps':
      return Math.round(v).toLocaleString();
    case 'active_energy':
      return `${Math.round(v).toLocaleString()} kcal`;
    case 'hrv':
      return `${Math.round(v)} ms`;
    case 'resting_hr':
    case 'heart_rate':
      return `${Math.round(v)} bpm`;
    case 'bp_sys':
    case 'bp_dia':
      return `${Math.round(v)}`;
    default:
      return String(round(v, 1));
  }
}

/** Values of a daily map within the last n days ending at endKey (inclusive). */
export function windowValues(map, endTs, n) {
  const out = [];
  const d = new Date(endTs);
  for (let i = 0; i < n; i++) {
    const k = dayKey(d.getTime());
    if (map.has(k)) out.push(map.get(k));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/** Ordered [ts, value] pairs from a daily map within [from, to]. */
export function series(map, from, to) {
  const out = [];
  for (const [k, v] of map) {
    const [y, m, d] = k.split('-').map(Number);
    const ts = new Date(y, m - 1, d, 12).getTime();
    if (ts >= from && ts <= to) out.push([ts, v]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
