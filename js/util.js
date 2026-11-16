// Small shared helpers: dates, formatting, stats, DOM.

export const DAY = 86400000;
export const HOUR = 3600000;

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Local midnight (ms) for a timestamp. */
export function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "YYYY-MM-DD" in local time. */
export function dayKey(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/**
 * Parse the date strings Health Auto Export, Shortcuts and CSVs produce:
 * "2024-01-05 07:30:00 -0700", "2024-01-05 07:30:00", ISO strings,
 * "1/5/2024 7:30", or epoch numbers. Returns ms or NaN.
 */
export function parseDate(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  let s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) return parseDate(Number(s));
  // "2024-01-05 07:30:00 -0700"
  let m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*([+-])(\d{2}):?(\d{2})$/);
  if (m) {
    const t = m[2].length <= 5 ? m[2] + ':00' : m[2];
    return Date.parse(`${m[1]}T${t.padStart(8, '0')}${m[3]}${m[4]}:${m[5]}`);
  }
  // "2024-01-05 07:30(:00)" -> local
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  // "1/5/2024 7:30 AM" -> local
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    let h = +(m[4] || 0);
    if (m[7]) {
      const pm = /p/i.test(m[7]);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return new Date(y, +m[1] - 1, +m[2], h, +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  // Shortcuts' default "Nov 15, 2026 at 7:30 AM"
  s = s.replace(/\s+at\s+/i, ' ').replace(/ /g, ' ');
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
    if (m) {
      const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase());
      let h = +(m[4] || 0);
      if (m[7]) {
        const pm = /p/i.test(m[7]);
        if (pm && h < 12) h += 12;
        if (!pm && h === 12) h = 0;
      }
      if (mon >= 0) t = new Date(+m[3], mon, +m[2], h, +(m[5] || 0), +(m[6] || 0)).getTime();
    }
  }
  return Number.isNaN(t) ? NaN : t;
}

/** Value for <input type="datetime-local">. */
export function toLocalInput(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(ts, opts = { month: 'short', day: 'numeric' }) {
  return new Date(ts).toLocaleDateString(undefined, opts);
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtDateTime(ts) {
  return `${fmtDate(ts, { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(ts)}`;
}

export function relTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return fmtDate(ts, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDuration(min) {
  if (min == null || Number.isNaN(min)) return '';
  if (min < 1) return 'under 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtHours(h) {
  if (h == null || Number.isNaN(h)) return '–';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (mm === 60) return `${hh + 1}h`;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

export function round(n, d = 0) {
  if (n == null || Number.isNaN(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function mean(arr) {
  const v = arr.filter((x) => x != null && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function sd(arr) {
  const v = arr.filter((x) => x != null && !Number.isNaN(x));
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function sum(arr) {
  return arr.reduce((a, b) => a + (b || 0), 0);
}

export function countBy(items, keyFn) {
  const out = new Map();
  for (const it of items) {
    const keys = [].concat(keyFn(it) ?? []);
    for (const k of keys) out.set(k, (out.get(k) || 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

export function pct(n, d) {
  if (!d) return '–';
  return `${Math.round((n / d) * 100)}%`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Tagged template that returns an HTML string with escaped values (use raw() to skip). */
export function html(strings, ...values) {
  return strings.reduce((out, str, i) => {
    let v = i < values.length ? values[i] : '';
    if (Array.isArray(v)) v = v.join('');
    else if (v && v.__raw) v = v.value;
    else v = esc(v);
    return out + str + v;
  }, '');
}

export function raw(value) {
  return { __raw: true, value: Array.isArray(value) ? value.join('') : String(value ?? '') };
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Save a file: share sheet on iOS when possible, download otherwise. */
export async function saveFile(name, content, type) {
  const blob = new Blob([content], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
