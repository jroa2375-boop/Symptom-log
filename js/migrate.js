// One-time migration of entries saved by the first version of the app
// (localStorage) into IndexedDB. The old data is left in place as a safety net.

import { bulkPut, getMeta, setMeta } from './db.js';
import { PAIN_TYPES, LOCATIONS, RADIATES, ACTIVITIES, MODIFIERS, RED_FLAGS } from './options.js';
import { parseDate, uid } from './util.js';

const TIME_FIELDS = ['start', 'startTime', 'startedAt', 'time', 'timestamp', 'datetime', 'dateTime', 'date', 'when', 'createdAt', 'created', 'loggedAt'];
const INTENSITY_FIELDS = ['intensity', 'severity', 'pain', 'painLevel', 'level', 'score', 'rating'];

function pick(obj, fields) {
  for (const f of fields) {
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === f.toLowerCase() && obj[k] != null && obj[k] !== '') return obj[k];
    }
  }
  return undefined;
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z]/g, '');
}

/** Map free-form values ("Sharp", "deep breath", ["Arm","Back"]) onto option ids. */
function matchOptions(value, options) {
  if (value == null) return [];
  let items = value;
  if (typeof items === 'string') items = items.split(/[,;/|]+/);
  if (!Array.isArray(items)) {
    if (typeof items === 'object') items = Object.keys(items).filter((k) => items[k]);
    else items = [items];
  }
  const out = new Set();
  for (const raw of items) {
    const n = norm(raw);
    if (!n) continue;
    const hit = options.find(([id, label]) => norm(id) === n || norm(label) === n || norm(label).startsWith(n) || n.startsWith(norm(id)));
    if (hit) out.add(hit[0]);
  }
  return [...out];
}

function parseDuration(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).toLowerCase();
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  if (/h/.test(s) && !/min/.test(s)) return n * 60;
  if (/sec/.test(s)) return n / 60;
  return n;
}

function looksLikeEntry(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const hasTime = pick(o, TIME_FIELDS) !== undefined;
  const hasPain = pick(o, INTENSITY_FIELDS) !== undefined || pick(o, ['type', 'types', 'painType', 'painTypes', 'quality']) !== undefined;
  return hasTime && hasPain;
}

export function convertLegacy(o) {
  const startRaw = pick(o, TIME_FIELDS);
  let start = parseDate(startRaw);
  if (Number.isNaN(start)) start = Date.now();
  let intensity = Number(pick(o, INTENSITY_FIELDS));
  if (Number.isNaN(intensity)) intensity = null;
  else intensity = Math.max(0, Math.min(10, Math.round(intensity)));

  const loc = matchOptions(pick(o, ['location', 'where', 'area', 'spot']), LOCATIONS);
  const notesParts = [pick(o, ['notes', 'note', 'comment', 'comments', 'details', 'description'])].filter(Boolean);
  const rawLoc = pick(o, ['location', 'where', 'area', 'spot']);
  if (rawLoc && !loc.length) notesParts.push(`Location: ${rawLoc}`);

  return {
    id: o.id ? String(o.id) : uid(),
    start,
    durationMin: parseDuration(pick(o, ['durationMin', 'duration', 'durationMinutes', 'length', 'lasted'])),
    intensity,
    painTypes: matchOptions(pick(o, ['painTypes', 'painType', 'types', 'type', 'quality', 'feel', 'feeling']), PAIN_TYPES),
    location: loc[0] || 'left-chest',
    radiates: matchOptions(pick(o, ['radiates', 'radiatesTo', 'spreads', 'spreadsTo', 'radiation', 'spread']), RADIATES),
    activity: matchOptions(pick(o, ['activity', 'activities', 'doing', 'context', 'before', 'activityBefore', 'trigger']), ACTIVITIES),
    modifiers: matchOptions(pick(o, ['modifiers', 'changes', 'whatChanges', 'changedBy', 'affects', 'worseWith', 'triggers']), MODIFIERS),
    redFlags: matchOptions(pick(o, ['redFlags', 'symptoms', 'associated', 'alsoHaving']), RED_FLAGS),
    notes: notesParts.join('\n'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    legacy: o,
  };
}

function findEntryArrays(value, depth = 0) {
  if (depth > 3 || value == null) return [];
  if (Array.isArray(value)) {
    if (value.length && value.filter(looksLikeEntry).length >= Math.ceil(value.length / 2)) return [value.filter(looksLikeEntry)];
    return value.flatMap((v) => findEntryArrays(v, depth + 1));
  }
  if (typeof value === 'object') {
    if (looksLikeEntry(value)) return [[value]];
    return Object.values(value).flatMap((v) => findEntryArrays(v, depth + 1));
  }
  return [];
}

/** Scan localStorage for old symptom entries and copy them in. Returns the number migrated. */
export async function migrateLocalStorage() {
  let total = 0;
  let keys = [];
  try {
    keys = Object.keys(localStorage);
  } catch (_) {
    return 0;
  }
  for (const key of keys) {
    if (await getMeta(`migrated:${key}`)) continue;
    let parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(key));
    } catch (_) {
      continue;
    }
    const arrays = findEntryArrays(parsed);
    if (!arrays.length) continue;
    const entries = arrays.flat().map(convertLegacy);
    const { added } = await bulkPut('symptoms', entries, 'id');
    total += added;
    await setMeta(`migrated:${key}`, { at: Date.now(), count: entries.length });
  }
  return total;
}
