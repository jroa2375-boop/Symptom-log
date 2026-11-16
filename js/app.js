// App shell: hash router, migration on first load, service worker.

import { requestPersistence } from './db.js';
import { migrateLocalStorage } from './migrate.js';
import { destroyCharts } from './charts.js';
import { $, $$, toast } from './util.js';
import * as log from './views/log.js';
import * as today from './views/today.js';
import * as patterns from './views/patterns.js';
import * as report from './views/report.js';
import * as settings from './views/settings.js';

const ROUTES = {
  log: { view: log, title: 'Log an episode' },
  today: { view: today, title: 'Today' },
  patterns: { view: patterns, title: 'Patterns' },
  report: { view: report, title: 'Doctor report' },
  settings: { view: settings, title: 'Data & settings' },
};

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || 'log';
  const [name, query = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  return { name: ROUTES[name] ? name : 'log', params };
}

let renderId = 0;

async function route() {
  const { name, params } = parseHash();
  const r = ROUTES[name];
  const id = ++renderId;
  const main = $('#view');
  destroyCharts(main);
  $('#view-title').textContent = params.edit ? 'Edit episode' : r.title;
  document.title = `${r.title} – Symptom Log`;
  $$('.tabbar a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  try {
    const container = document.createElement('div');
    await r.view.render(container, { params, rerender: route });
    if (id !== renderId) return; // a newer navigation won
    destroyCharts(main);
    main.replaceChildren(...container.childNodes);
    if (r.view.mounted) r.view.mounted(main, { params, rerender: route });
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${String(err.message || err).replace(/</g, '&lt;')}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
  window.scrollTo({ top: 0 });
}

async function start() {
  requestPersistence();
  try {
    const moved = await migrateLocalStorage();
    if (moved) toast(`Moved ${moved} earlier ${moved === 1 ? 'entry' : 'entries'} into the new app`);
  } catch (err) {
    console.error('Migration failed', err);
  }
  window.addEventListener('hashchange', route);
  await route();

  // Re-render chart screens once Chart.js finishes loading (it's deferred from the CDN).
  if (typeof window.Chart !== 'function') {
    const s = document.querySelector('script[src*="chart.umd"]');
    if (s) s.addEventListener('load', () => {
      const { name } = parseHash();
      if (name === 'today' || name === 'patterns' || name === 'report') route();
    }, { once: true });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker not registered', e));
  }
}

start();
