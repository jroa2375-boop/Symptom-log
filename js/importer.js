// Turns exported Health data into metric records and stores them.
//
// Supported inputs
//   1. Health Auto Export JSON  { data: { metrics: [...], workouts: [...] } }
//   2. Health Auto Export CSV   ("Date/Time", "Step Count (count)", ... columns) and workout CSVs
//   3. Shortcut JSON            { samples: [...] }, a bare array, or one JSON object per line
//   4. Symptom Log backups      (handed to db.importAll)
//
// Every record is keyed "type|timestamp", so importing the same file twice
// updates records instead of duplicating them.

import { bulkPut, importAll } from './db.js';
import { HOUR, dayStart, parseDate } from './util.js';

const LB_TO_KG = 0.45359237;
const KJ_TO_KCAL = 1 / 4.184;

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Map a metric name from any source onto our types. */
export function metricType(name) {
  const n = norm(name);
  if (!n) return null;
  if (n.includes('systolic')) return 'bp_systolic';
  if (n.includes('diastolic')) return 'bp_diastolic';
  if (n.includes('bloodpressure') || n === 'bp') return 'bp';
  if (n.includes('variability') || n === 'hrv' || n.includes('sdnn')) return 'hrv';
  if (n.includes('resting')) return 'resting_hr';
  if (n.includes('walkingheartrate') || n.includes('heartraterecovery')) return null;
  if (n.includes('heartrate') || n === 'hr' || n === 'pulse') return 'heart_rate';
  if (n.includes('bodyfat') || n === 'fat') return 'body_fat';
  if (n.includes('leanbody') || n.includes('bmi') || n.includes('bodymassindex')) return null;
  if (n.includes('weight') || n.includes('bodymass')) return 'weight';
  if (n.includes('sleep')) return 'sleep';
  if (n.includes('step')) return 'steps';
  if (n.includes('activeenergy') || n.includes('activecalories') || n === 'activeenergyburned') return 'active_energy';
  if (n.includes('workout')) return 'workout';
  return null;
}

function num(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/,/g, ''));
}

function toKg(v, unit) {
  const u = norm(unit);
  if (u === 'lb' || u === 'lbs' || u.includes('pound')) return v * LB_TO_KG;
  if (u === 'st' || u.includes('stone')) return v * 6.35029318;
  if (!u && v > 140) return v * LB_TO_KG; // unlabeled and too heavy to be kg for most adults
  return v;
}

function toKcal(v, unit) {
  const u = norm(unit);
  if (u === 'kj' || u.includes('kilojoule')) return v * KJ_TO_KCAL;
  return v;
}

function toPct(v) {
  return v <= 1 ? v * 100 : v;
}

/** Which day a night of sleep belongs to: the day you woke up. */
export function nightOf(endTs) {
  return dayStart(endTs + 6 * HOUR);
}

function rec(type, ts, value, extra = {}) {
  return { key: `${type}|${ts}`, type, ts, value, ...extra };
}

/** Collects records, pairing BP halves and grouping sleep segments into nights. */
class Collector {
  constructor() {
    this.records = new Map();
    this.sys = [];
    this.dia = [];
    this.sleepSegs = [];
    this.skipped = 0;
  }
  add(r) {
    if (!r || Number.isNaN(r.ts) || r.value == null || Number.isNaN(r.value)) {
      this.skipped++;
      return;
    }
    this.records.set(r.key, r);
  }
  sample(type, ts, value, unit, extra = {}) {
    if (Number.isNaN(ts) || Number.isNaN(value)) {
      this.skipped++;
      return;
    }
    switch (type) {
      case 'weight':
        return this.add(rec('weight', ts, toKg(value, unit), { unit: 'kg', ...extra }));
      case 'active_energy':
        return this.add(rec('active_energy', ts, toKcal(value, unit), { unit: 'kcal', ...extra }));
      case 'body_fat':
        return this.add(rec('body_fat', ts, toPct(value), { unit: '%', ...extra }));
      case 'bp_systolic':
        this.sys.push({ ts, value, extra });
        return;
      case 'bp_diastolic':
        this.dia.push({ ts, value, extra });
        return;
      default:
        return this.add(rec(type, ts, value, { unit: unit || undefined, ...extra }));
    }
  }
  sleepNight(dayTs, hours, extra = {}) {
    if (Number.isNaN(dayTs) || !(hours > 0)) {
      this.skipped++;
      return;
    }
    if (hours > 24) hours /= 60; // minutes, not hours
    this.add(rec('sleep', dayTs, hours, { unit: 'h', ...extra }));
  }
  sleepSegment(start, end, stage, hours) {
    if (Number.isNaN(end)) {
      this.skipped++;
      return;
    }
    let h = hours;
    if (!(h > 0) && !Number.isNaN(start)) h = (end - start) / HOUR;
    if (!(h > 0)) {
      this.skipped++;
      return;
    }
    this.sleepSegs.push({ start, end, stage: norm(stage), h });
  }
  finish() {
    // Pair systolic/diastolic samples recorded within two minutes of each other.
    const dia = [...this.dia].sort((a, b) => a.ts - b.ts);
    for (const s of this.sys) {
      let best = -1;
      let bestGap = 120000;
      dia.forEach((d, i) => {
        const gap = Math.abs(d.ts - s.ts);
        if (gap <= bestGap) {
          best = i;
          bestGap = gap;
        }
      });
      if (best >= 0) {
        const d = dia.splice(best, 1)[0];
        this.add(rec('bp', s.ts, s.value, { value2: d.value, unit: 'mmHg', ...s.extra }));
      } else this.skipped++;
    }
    this.skipped += dia.length;

    // Group sleep stages into nights.
    const nights = new Map();
    for (const seg of this.sleepSegs) {
      const day = nightOf(seg.end);
      if (!nights.has(day)) nights.set(day, { core: 0, deep: 0, rem: 0, awake: 0, asleep: 0, inbed: 0, start: seg.start, end: seg.end });
      const n = nights.get(day);
      const st = seg.stage;
      if (st.includes('deep')) n.deep += seg.h;
      else if (st.includes('rem')) n.rem += seg.h;
      else if (st.includes('core') || st.includes('light')) n.core += seg.h;
      else if (st.includes('awake')) n.awake += seg.h;
      else if (st.includes('inbed')) n.inbed += seg.h;
      else n.asleep += seg.h;
      if (!Number.isNaN(seg.start) && (Number.isNaN(n.start) || seg.start < n.start)) n.start = seg.start;
      if (seg.end > n.end) n.end = seg.end;
    }
    for (const [day, n] of nights) {
      let total = n.core + n.deep + n.rem + n.asleep;
      if (!total) total = n.inbed;
      this.sleepNight(day, total, stagesExtra(n));
    }
    return [...this.records.values()];
  }
}

function stagesExtra(n) {
  const out = {};
  for (const k of ['core', 'deep', 'rem', 'awake']) if (n[k] > 0) out[k] = n[k];
  if (n.start && !Number.isNaN(n.start)) out.sleepStart = n.start;
  if (n.end && !Number.isNaN(n.end)) out.sleepEnd = n.end;
  return out;
}

/* ---------- Health Auto Export JSON ---------- */

function importHAEJson(obj, c) {
  const root = obj.data || obj;
  for (const metric of root.metrics || []) {
    const type = metricType(metric.name);
    const unit = metric.units || metric.unit;
    if (!type) continue;
    for (const d of metric.data || []) {
      const ts = parseDate(d.date || d.startDate || d.start);
      const src = d.source ? { source: String(d.source).slice(0, 60) } : {};
      if (type === 'bp') {
        const sys = num(d.systolic ?? d.Systolic);
        const dia = num(d.diastolic ?? d.Diastolic);
        c.add(rec('bp', ts, sys, { value2: dia, unit: 'mmHg', ...src }));
      } else if (type === 'sleep') {
        importHAESleep(d, c);
      } else if (type === 'heart_rate') {
        const avg = num(d.Avg ?? d.avg ?? d.qty);
        const extra = { ...src };
        if (!Number.isNaN(num(d.Min))) extra.min = num(d.Min);
        if (!Number.isNaN(num(d.Max))) extra.max = num(d.Max);
        c.sample('heart_rate', ts, avg, 'bpm', extra);
      } else {
        c.sample(type, ts, num(d.qty ?? d.value ?? d.Avg), unit, src);
      }
    }
  }
  for (const w of root.workouts || []) importWorkout(w, c);
}

function importHAESleep(d, c) {
  // Unaggregated: one record per stage segment.
  if (d.value && typeof d.value === 'string' && (d.startDate || d.endDate)) {
    c.sleepSegment(parseDate(d.startDate), parseDate(d.endDate), d.value, num(d.qty));
    return;
  }
  const end = parseDate(d.sleepEnd || d.inBedEnd);
  const day = !Number.isNaN(end) ? nightOf(end) : dayStart(parseDate(d.date));
  const parts = { core: num(d.core), deep: num(d.deep), rem: num(d.rem), awake: num(d.awake) };
  let total = num(d.totalSleep ?? d.asleep);
  if (Number.isNaN(total) || !total) {
    const staged = [parts.core, parts.deep, parts.rem].filter((x) => !Number.isNaN(x));
    total = staged.length ? staged.reduce((a, b) => a + b, 0) : num(d.inBed ?? d.qty);
  }
  const n = { start: parseDate(d.sleepStart || d.inBedStart), end };
  for (const k of Object.keys(parts)) n[k] = Number.isNaN(parts[k]) ? 0 : parts[k];
  c.sleepNight(day, total, stagesExtra(n));
}

function quantity(v) {
  if (v == null) return { qty: NaN, units: '' };
  if (typeof v === 'object') return { qty: num(v.qty ?? v.value), units: v.units || v.unit || '' };
  return { qty: num(v), units: '' };
}

function importWorkout(w, c) {
  const start = parseDate(w.start || w.startDate || w.Start);
  const end = parseDate(w.end || w.endDate || w.End);
  // Start and end are the most reliable source. Otherwise HAE JSON gives the
  // duration in seconds (and says so in v2), other sources in minutes.
  let minutes = NaN;
  if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) minutes = (end - start) / 60000;
  else {
    const d = quantity(w.duration ?? w.Duration);
    minutes = d.qty;
    if (!Number.isNaN(minutes)) {
      const u = norm(d.units);
      if (u.startsWith('s') || w.durationSeconds || (!u && minutes > 600)) minutes /= 60;
      else if (u.startsWith('h')) minutes *= 60;
    }
  }
  const energy = quantity(w.activeEnergyBurned ?? w.activeEnergy ?? w.energy);
  const dist = quantity(w.distance);
  const extra = { name: String(w.name || w.type || w.workoutType || 'Workout').slice(0, 60) };
  if (!Number.isNaN(end)) extra.end = end;
  if (!Number.isNaN(energy.qty)) extra.energy = toKcal(energy.qty, energy.units);
  if (!Number.isNaN(dist.qty)) extra.distance = dist.qty;
  if (dist.units) extra.distanceUnit = dist.units;
  c.add(rec('workout', start, Number.isNaN(minutes) ? 0 : minutes, { unit: 'min', ...extra }));
}

/* ---------- CSV ---------- */

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

function hms(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (m) return m[3] != null ? +m[1] * 60 + +m[2] + +m[3] / 60 : +m[1] + +m[2] / 60;
  return num(s);
}

function importCSV(text, c) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('That CSV file has no data rows.');
  const header = rows[0].map((h) => h.trim());
  const H = header.map(norm);
  const find = (...needles) => H.findIndex((h) => needles.every((n) => h.includes(n)));

  // Workout export
  const typeCol = H.findIndex((h) => h === 'workouttype' || h === 'type' || h === 'activity' || h === 'name');
  const startCol = H.findIndex((h) => h === 'start' || h === 'startdate' || h === 'starttime');
  if (typeCol >= 0 && startCol >= 0) {
    const endCol = H.findIndex((h) => h === 'end' || h === 'enddate' || h === 'endtime');
    const durCol = H.findIndex((h) => h.startsWith('duration'));
    const enCol = H.findIndex((h) => h.includes('activeenergy') || h.includes('calories'));
    const distCol = H.findIndex((h) => h.startsWith('distance'));
    for (const r of rows.slice(1)) {
      const w = { name: r[typeCol], start: r[startCol], end: endCol >= 0 ? r[endCol] : undefined };
      if (durCol >= 0) w.duration = hms(r[durCol]);
      if (enCol >= 0) w.activeEnergy = { qty: num(r[enCol]), units: /kj/i.test(header[enCol]) ? 'kJ' : 'kcal' };
      if (distCol >= 0) w.distance = { qty: num(r[distCol]), units: (header[distCol].match(/\(([^)]+)\)/) || [])[1] || '' };
      importWorkout(w, c);
    }
    return;
  }

  const dateCol = H.findIndex((h) => h.startsWith('date') || h === 'time' || h === 'timestamp' || h.startsWith('start'));
  if (dateCol < 0) throw new Error('Could not find a date column in that CSV.');

  const unitOf = (i) => (header[i].match(/\(([^)]+)\)\s*$/) || [])[1] || '';
  const cols = [];
  header.forEach((h, i) => {
    if (i === dateCol) return;
    const n = H[i];
    if (n.includes('sleep')) {
      let stage = 'total';
      for (const s of ['deep', 'rem', 'core', 'awake', 'inbed', 'asleep', 'total']) if (n.includes(s)) stage = s;
      cols.push({ i, kind: 'sleep', stage });
      return;
    }
    if (n.includes('heartrate') && !n.includes('resting') && !n.includes('variability') && !n.includes('walking') && !n.includes('recovery')) {
      const lower = h.toLowerCase();
      if (/\[\s*min\s*\]/.test(lower)) return cols.push({ i, kind: 'hr', part: 'min' });
      if (/\[\s*max\s*\]/.test(lower)) return cols.push({ i, kind: 'hr', part: 'max' });
      // "Heart Rate [Avg] (count/min)" or plain "Heart Rate (count/min)"
      return cols.push({ i, kind: 'hr', part: 'avg' });
    }
    const type = metricType(h.replace(/\(.*\)/, ''));
    if (type) cols.push({ i, kind: 'metric', type, unit: unitOf(i) });
  });
  if (!cols.length) throw new Error('None of the columns in that CSV match the health metrics this app tracks.');

  for (const r of rows.slice(1)) {
    const ts = parseDate(r[dateCol]);
    if (Number.isNaN(ts)) {
      c.skipped++;
      continue;
    }
    const sleep = {};
    const hr = {};
    for (const col of cols) {
      const v = num(r[col.i]);
      if (Number.isNaN(v)) continue;
      if (col.kind === 'sleep') sleep[col.stage] = v;
      else if (col.kind === 'hr') hr[col.part] = v;
      else c.sample(col.type, ts, v, col.unit);
    }
    if (hr.avg != null) {
      const extra = {};
      if (hr.min != null) extra.min = hr.min;
      if (hr.max != null) extra.max = hr.max;
      c.sample('heart_rate', ts, hr.avg, 'bpm', extra);
    }
    if (Object.keys(sleep).length) {
      const staged = (sleep.core || 0) + (sleep.deep || 0) + (sleep.rem || 0);
      const total = sleep.total || sleep.asleep || staged || sleep.inbed;
      const n = { core: sleep.core || 0, deep: sleep.deep || 0, rem: sleep.rem || 0, awake: sleep.awake || 0 };
      c.sleepNight(dayStart(ts), total, stagesExtra(n));
    }
  }
}

/* ---------- Shortcut JSON ---------- */

function parseLoose(text) {
  const t = text.trim().replace(/^﻿/, '');
  try {
    return JSON.parse(t);
  } catch (_) {
    /* fall through */
  }
  // Shortcut text output: objects separated by newlines or commas, maybe a trailing comma.
  const cleaned = t.replace(/,\s*([\]}])/g, '$1').replace(/,\s*$/, '');
  try {
    return JSON.parse(`[${cleaned}]`);
  } catch (_) {
    /* fall through */
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
  const out = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch (_) {
      throw new Error('That file is not valid JSON or CSV.');
    }
  }
  return out;
}

function importShortcut(samples, c) {
  for (const s of samples) {
    if (!s || typeof s !== 'object') {
      c.skipped++;
      continue;
    }
    const type = metricType(s.type || s.metric || s.name);
    if (!type) {
      c.skipped++;
      continue;
    }
    const start = parseDate(s.start ?? s.startDate ?? s.date ?? s.ts);
    const end = parseDate(s.end ?? s.endDate);
    const value = s.value ?? s.qty;
    const unit = s.unit || s.units || '';
    if (type === 'sleep') {
      const v = num(value);
      if (typeof value === 'string' && Number.isNaN(v)) c.sleepSegment(start, Number.isNaN(end) ? start : end, value, num(s.hours ?? s.duration));
      else if (!Number.isNaN(end) && !Number.isNaN(start) && s.stage) c.sleepSegment(start, end, s.stage, NaN);
      else c.sleepNight(nightOf(Number.isNaN(end) ? start : end), /min/i.test(unit) ? v / 60 : v);
      continue;
    }
    if (type === 'bp') {
      c.add(rec('bp', start, num(s.systolic ?? value), { value2: num(s.diastolic ?? s.value2), unit: 'mmHg' }));
      continue;
    }
    if (type === 'workout') {
      importWorkout({ ...s, start: s.start ?? s.startDate, end: s.end ?? s.endDate, duration: s.duration ?? s.minutes }, c);
      continue;
    }
    c.sample(type, start, num(value), unit, s.source ? { source: String(s.source).slice(0, 60) } : {});
  }
}

/* ---------- entry point ---------- */

/**
 * Import one file's text. Returns a summary:
 *   { kind, added, updated, skipped, byType: {type: n}, from, to }
 */
export async function importText(text, filename = '') {
  const isCSV = /\.csv$/i.test(filename) || (!/^\s*[[{]/.test(text) && /,/.test(text.split('\n')[0]) && /date|time|start/i.test(text.split('\n')[0]));
  const c = new Collector();
  let kind;

  if (isCSV) {
    kind = 'Health Auto Export CSV';
    importCSV(text, c);
  } else {
    const obj = parseLoose(text);
    if (obj && obj.format === 'symptom-log-backup') {
      const r = await importAll(obj);
      return {
        kind: 'Symptom Log backup',
        added: r.symptoms.added + r.metrics.added,
        updated: r.symptoms.updated + r.metrics.updated,
        skipped: 0,
        byType: { 'symptom entries': (obj.symptoms || []).length, 'health records': (obj.metrics || []).length },
      };
    }
    if (obj && (obj.data?.metrics || obj.data?.workouts || obj.metrics || obj.workouts)) {
      kind = 'Health Auto Export JSON';
      importHAEJson(obj, c);
    } else {
      const samples = Array.isArray(obj) ? obj : obj?.samples || obj?.data;
      if (!Array.isArray(samples)) throw new Error('That file doesn’t look like a Health Auto Export or Shortcut export.');
      kind = 'Shortcut export';
      importShortcut(samples, c);
    }
  }

  const records = c.finish();
  if (!records.length) throw new Error('No health readings were found in that file.');
  const { added, updated } = await bulkPut('metrics', records, 'key');
  const byType = {};
  let from = Infinity;
  let to = -Infinity;
  for (const r of records) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    from = Math.min(from, r.ts);
    to = Math.max(to, r.ts);
  }
  return { kind, added, updated, skipped: c.skipped, byType, from, to };
}
