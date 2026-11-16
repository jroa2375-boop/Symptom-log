// Pattern analysis shared by the Patterns screen and the doctor report.
// Everything here is descriptive: counts, averages and comparisons with
// sample sizes. Nothing here is a diagnosis.

import { label, MECHANICAL } from './options.js';
import { DAY, HOUR, addDays, countBy, dayKey, fromDayKey, mean, pct, round, sd } from './util.js';
import { fmtMetric } from './data.js';

export const TIME_BUCKETS = [
  ['night', 'Night (12–6 am)', 0, 6],
  ['morning', 'Morning (6 am–12 pm)', 6, 12],
  ['afternoon', 'Afternoon (12–6 pm)', 12, 18],
  ['evening', 'Evening (6 pm–12 am)', 18, 24],
];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function timeBucket(ts) {
  const h = new Date(ts).getHours();
  return TIME_BUCKETS.find((b) => h >= b[2] && h < b[3]);
}

function nearest(list, ts, maxGap) {
  if (!list || !list.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  let best = null;
  for (const i of [lo - 1, lo]) {
    const r = list[i];
    if (r && Math.abs(r.ts - ts) <= maxGap && (!best || Math.abs(r.ts - ts) < Math.abs(best.ts - ts))) best = r;
  }
  return best;
}

function workoutsBetween(list, from, to) {
  if (!list) return [];
  return list.filter((w) => {
    const end = w.end || w.ts + (w.value || 0) * 60000;
    return end >= from && w.ts <= to;
  });
}

/** Per-episode context drawn from the health data around it. */
export function episodeContext(e, data) {
  const k = dayKey(e.start);
  const prev = dayKey(addDays(e.start, -1));
  const { days, metrics } = data;
  const hr = nearest(metrics.heart_rate, e.start, HOUR);
  const bp = nearest(metrics.bp, e.start, 3 * HOUR);
  return {
    sleep: days.sleep.get(k) ?? null,
    hrv: days.hrv.get(k) ?? null,
    restingHr: days.resting_hr.get(k) ?? null,
    stepsPrevDay: days.steps.get(prev) ?? null,
    hrNear: hr ? hr.value : null,
    bpNear: bp ? [bp.value, bp.value2] : null,
    workout48: metrics.workout ? workoutsBetween(metrics.workout, e.start - 48 * HOUR, e.start).length > 0 : null,
  };
}

/** Days that fall inside [from, to] and that we know something about. */
function analysisDays(data, from, to, episodes) {
  const set = new Set();
  for (const k of data.dataDays) {
    const t = fromDayKey(k);
    if (t >= from - DAY && t <= to) set.add(k);
  }
  for (const e of episodes) set.add(dayKey(e.start));
  return [...set].sort();
}

const DAY_FEATURES = [
  { id: 'sleep', label: 'Sleep the night before', type: 'sleep', get: (d, k) => d.days.sleep.get(k) },
  { id: 'hrv', label: 'HRV', type: 'hrv', get: (d, k) => d.days.hrv.get(k) },
  { id: 'resting_hr', label: 'Resting heart rate', type: 'resting_hr', get: (d, k) => d.days.resting_hr.get(k) },
  { id: 'bp_sys', label: 'Blood pressure, systolic', type: 'bp_sys', get: (d, k) => d.days.bp_sys.get(k) },
  { id: 'bp_dia', label: 'Blood pressure, diastolic', type: 'bp_dia', get: (d, k) => d.days.bp_dia.get(k) },
  { id: 'steps_prev', label: 'Steps the day before', type: 'steps', get: (d, k) => d.days.steps.get(dayKey(addDays(fromDayKey(k), -1))) },
  { id: 'steps', label: 'Steps that day', type: 'steps', get: (d, k) => d.days.steps.get(k) },
  { id: 'weight', label: 'Weight', type: 'weight', get: (d, k) => d.days.weight.get(k) },
];

export function analyze(data, from, to) {
  const episodes = data.symptoms.filter((e) => e.start >= from && e.start <= to).sort((a, b) => a.start - b.start);
  const n = episodes.length;
  const contexts = episodes.map((e) => ({ e, c: episodeContext(e, data) }));

  /* ---- symptom days vs symptom-free days ---- */
  const days = analysisDays(data, from, to, episodes);
  const episodeDays = new Set(episodes.map((e) => dayKey(e.start)));
  const comparisons = [];
  for (const f of DAY_FEATURES) {
    const withS = [];
    const without = [];
    for (const k of days) {
      const v = f.get(data, k);
      if (v == null || Number.isNaN(v)) continue;
      (episodeDays.has(k) ? withS : without).push(v);
    }
    if (!withS.length && !without.length) continue;
    const mS = mean(withS);
    const mF = mean(without);
    const spread = sd([...withS, ...without]);
    let effect = null;
    if (mS != null && mF != null && spread) effect = (mS - mF) / spread;
    comparisons.push({
      ...f,
      symptom: mS,
      nS: withS.length,
      free: mF,
      nF: without.length,
      effect,
      notable: withS.length >= 3 && without.length >= 3 && effect != null && Math.abs(effect) >= 0.5,
    });
  }

  // Workouts in the 2 days before vs not, as proportions.
  let workoutCompare = null;
  if (data.metrics.workout && data.metrics.workout.length) {
    const had = (k) => {
      const start = addDays(fromDayKey(k), -2);
      return workoutsBetween(data.metrics.workout, start, fromDayKey(k)).length > 0;
    };
    const s = [...episodeDays].filter((k) => days.includes(k));
    const f = days.filter((k) => !episodeDays.has(k));
    workoutCompare = {
      symptomYes: s.filter(had).length,
      nS: s.length,
      freeYes: f.filter(had).length,
      nF: f.length,
    };
  }

  /* ---- breakdowns ---- */
  const byTime = TIME_BUCKETS.map((b) => [b[1], episodes.filter((e) => timeBucket(e.start)[0] === b[0]).length]);
  const byWeekday = WEEKDAYS.map((w, i) => [w, episodes.filter((e) => new Date(e.start).getDay() === i).length]);
  const byActivity = countBy(episodes, (e) => e.activity || []).map(([k, v]) => [label(k), v]);
  const byModifier = countBy(episodes, (e) => e.modifiers || []).map(([k, v]) => [label(k), v]);
  const byType = countBy(episodes, (e) => e.painTypes || []).map(([k, v]) => [label(k), v]);
  const byRadiates = countBy(episodes, (e) => (e.radiates || []).filter((r) => r !== 'none')).map(([k, v]) => [label(k), v]);
  const byLocation = countBy(episodes, (e) => e.location || []).map(([k, v]) => [label(k), v]);

  const intensities = episodes.map((e) => e.intensity).filter((x) => x != null);
  const durations = episodes.map((e) => e.durationMin).filter((x) => x != null);
  const weeks = Math.max(1, (to - from) / (7 * DAY));
  const stats = {
    count: n,
    perWeek: n / weeks,
    avgIntensity: mean(intensities),
    maxIntensity: intensities.length ? Math.max(...intensities) : null,
    medianDuration: durations.length ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null,
    redFlagCount: episodes.filter((e) => (e.redFlags || []).length).length,
  };

  /* ---- plain-language summaries ---- */
  const summaries = [];
  const s = data.settings;

  // Short sleep
  const withSleep = contexts.filter((x) => x.c.sleep != null);
  if (withSleep.length >= 3) {
    const short = withSleep.filter((x) => x.c.sleep < 6).length;
    const nights = days.map((k) => data.days.sleep.get(k)).filter((v) => v != null);
    const shortNights = nights.filter((v) => v < 6).length;
    summaries.push({
      text: `${short} of ${withSleep.length} episodes (${pct(short, withSleep.length)}) followed a night under 6 hours of sleep. Overall, ${shortNights} of ${nights.length} nights (${pct(shortNights, nights.length)}) were under 6 hours.`,
      weight: Math.abs(short / withSleep.length - shortNights / Math.max(1, nights.length)),
    });
  }

  // Workouts
  const withW = contexts.filter((x) => x.c.workout48 != null);
  if (withW.length >= 3 && workoutCompare) {
    const yes = withW.filter((x) => x.c.workout48).length;
    summaries.push({
      text: `${yes} of ${withW.length} episodes (${pct(yes, withW.length)}) came within 2 days after a workout. By comparison, ${workoutCompare.freeYes} of ${workoutCompare.nF} symptom-free days (${pct(workoutCompare.freeYes, workoutCompare.nF)}) had a workout in the 2 days before.`,
      weight: Math.abs(yes / withW.length - workoutCompare.freeYes / Math.max(1, workoutCompare.nF)),
    });
  }

  // Notable day comparisons
  for (const c of comparisons.filter((x) => x.notable)) {
    const dir = c.symptom > c.free ? 'higher' : 'lower';
    summaries.push({
      text: `${c.label} was ${dir} on episode days: ${fmtMetric(c.type, c.symptom, s)} on average (${c.nS} days) vs ${fmtMetric(c.type, c.free, s)} on other days (${c.nF} days).`,
      weight: Math.abs(c.effect),
    });
  }

  // BP near episodes
  const bpNear = contexts.filter((x) => x.c.bpNear);
  if (bpNear.length >= 2 && data.metrics.bp?.length >= 5) {
    const sys = mean(bpNear.map((x) => x.c.bpNear[0]));
    const dia = mean(bpNear.map((x) => x.c.bpNear[1]));
    const inRange = data.metrics.bp.filter((r) => r.ts >= from && r.ts <= to);
    const allSys = mean(inRange.map((r) => r.value));
    const allDia = mean(inRange.map((r) => r.value2));
    summaries.push({
      text: `Blood pressure readings within 3 hours of an episode averaged ${Math.round(sys)}/${Math.round(dia)} (${bpNear.length} readings), compared with ${Math.round(allSys)}/${Math.round(allDia)} across all ${inRange.length} readings in this period.`,
      weight: Math.abs(sys - allSys) / 10,
    });
  }

  // Heart rate at the time
  const hrNear = contexts.filter((x) => x.c.hrNear != null);
  if (hrNear.length >= 3) {
    const avg = mean(hrNear.map((x) => x.c.hrNear));
    const allHr = mean([...data.days.heart_rate.entries()].filter(([k]) => fromDayKey(k) >= from && fromDayKey(k) <= to).map(([, v]) => v));
    if (allHr) {
      summaries.push({
        text: `Heart rate within an hour of an episode averaged ${Math.round(avg)} bpm (${hrNear.length} episodes), vs a daily average of ${Math.round(allHr)} bpm.`,
        weight: Math.abs(avg - allHr) / 15,
      });
    }
  }

  // Time of day
  if (n >= 5) {
    const top = [...byTime].sort((a, b) => b[1] - a[1])[0];
    if (top[1] / n >= 0.4) {
      summaries.push({
        text: `${top[1]} of ${n} episodes (${pct(top[1], n)}) started in the ${top[0].toLowerCase().replace(/ \(.*/, '')} (${top[0].match(/\((.*)\)/)[1]}).`,
        weight: top[1] / n - 0.25,
      });
    }
  }

  // Activity before
  if (n >= 3 && byActivity.length && byActivity[0][1] >= 2) {
    const [act, k] = byActivity[0];
    summaries.push({
      text: `The most common activity before an episode was ${act.toLowerCase()} (${k} of ${n} episodes, ${pct(k, n)}).`,
      weight: k / n - 0.2,
    });
  }

  // Mechanical modifiers
  if (n >= 3) {
    const mech = episodes.filter((e) => (e.modifiers || []).some((m) => MECHANICAL.includes(m))).length;
    if (mech) {
      summaries.push({
        text: `In ${mech} of ${n} episodes (${pct(mech, n)}), the pain changed with breathing, twisting, pressing the spot or moving your arm. That's useful detail for your doctor or physical therapist.`,
        weight: mech / n,
      });
    }
  }

  // Weekday concentration
  if (n >= 7) {
    const top = [...byWeekday].sort((a, b) => b[1] - a[1])[0];
    if (top[1] / n >= 2 / 7 && top[1] >= 3) {
      summaries.push({ text: `${top[1]} of ${n} episodes (${pct(top[1], n)}) were on a ${top[0]}.`, weight: top[1] / n - 1 / 7 });
    }
  }

  summaries.sort((a, b) => b.weight - a.weight);

  /* ---- episodes per week ---- */
  const perWeek = [];
  let wk = new Date(from);
  wk.setHours(0, 0, 0, 0);
  wk.setDate(wk.getDate() - wk.getDay());
  while (wk.getTime() <= to) {
    const start = wk.getTime();
    const end = addDays(start, 7);
    perWeek.push([start, episodes.filter((e) => e.start >= start && e.start < end).length]);
    wk = new Date(end);
  }

  return { episodes, contexts, comparisons, workoutCompare, byTime, byWeekday, byActivity, byModifier, byType, byRadiates, byLocation, stats, summaries, perWeek };
}

/** Weekly averages of a daily map, for report trend tables. */
export function weeklyAverages(map, from, to) {
  const out = [];
  let wk = new Date(from);
  wk.setHours(0, 0, 0, 0);
  wk.setDate(wk.getDate() - wk.getDay());
  while (wk.getTime() <= to) {
    const start = wk.getTime();
    const vals = [];
    for (let i = 0; i < 7; i++) {
      const v = map.get(dayKey(addDays(start, i)));
      if (v != null) vals.push(v);
    }
    out.push([start, vals.length ? mean(vals) : null, vals.length]);
    wk = new Date(addDays(start, 7));
  }
  return out;
}

export { round };
