// Quick-entry screen: log an episode in a few taps, plus recent entries to edit.

import { del, get, getAll, put } from '../db.js';
import { ACTIVITIES, DURATIONS, LOCATIONS, MODIFIERS, PAIN_TYPES, RADIATES, RED_FLAGS, durationLabel, label, labels } from '../options.js';
import { $, $$, fmtDateTime, fmtDuration, html, raw, relTime, toLocalInput, toast, uid } from '../util.js';

const WORDS = ['', 'Barely there', 'Mild', 'Mild', 'Moderate', 'Moderate', 'Moderate', 'Severe', 'Severe', 'Very severe', 'Worst ever'];
const EXCLUSIVE = { radiates: 'none', modifiers: 'nothing' };

function blank() {
  return {
    id: null,
    start: Date.now(),
    durationMin: null,
    intensity: 4,
    painTypes: [],
    location: 'left-chest',
    radiates: [],
    activity: [],
    modifiers: [],
    redFlags: [],
    notes: '',
  };
}

function chipGroup(name, options, selected, { single = false, flags = false } = {}) {
  const sel = new Set([].concat(selected ?? []));
  return html`<div class="chips${flags ? ' flags' : ''}" role="group" data-group="${name}" data-single="${single ? '1' : ''}">
    ${options.map(([id, text]) => html`<button type="button" class="chip" data-value="${id}" aria-pressed="${sel.has(id) ? 'true' : 'false'}">${text}</button>`)}
  </div>`;
}

function groupValues(root, name) {
  return $$(`[data-group="${name}"] .chip[aria-pressed="true"]`, root).map((b) => b.dataset.value);
}

let showAll = false;

export async function render(root, { params, rerender }) {
  let entry = blank();
  if (params.edit) {
    const existing = await get('symptoms', params.edit);
    if (existing) entry = { ...blank(), ...existing };
  }
  const editing = Boolean(entry.id);

  root.innerHTML = html`
    <form id="log-form" autocomplete="off" novalidate>
      ${raw(editing ? html`<div class="editing-banner"><span>Editing ${fmtDateTime(entry.start)}</span><a class="link-btn" href="#log">Cancel</a></div>` : '')}

      <div class="field" style="margin-top:${editing ? '14px' : '4px'}">
        <span class="label" id="int-label">How bad is it?</span>
        <div class="scale">
          <div class="scale-readout">
            <span class="scale-num" id="int-num">${entry.intensity}</span>
            <div>
              <div class="scale-word" id="int-word">${WORDS[entry.intensity]}</div>
              <div class="scale-of">out of 10</div>
            </div>
          </div>
          <input class="pain-range" type="range" min="1" max="10" step="1" value="${entry.intensity}" id="intensity" aria-labelledby="int-label">
          <div class="scale-ticks" aria-hidden="true">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => html`<span>${n}</span>`)}</div>
        </div>
      </div>

      <div class="field">
        <span class="label">What does it feel like?</span>
        ${raw(chipGroup('painTypes', PAIN_TYPES, entry.painTypes))}
      </div>

      <div class="field">
        <span class="label">Where?</span>
        ${raw(chipGroup('location', LOCATIONS, entry.location, { single: true }))}
      </div>

      <div class="field">
        <span class="label">Spreads to</span>
        ${raw(chipGroup('radiates', RADIATES, entry.radiates))}
      </div>

      <div class="field">
        <span class="label">What were you doing just before?</span>
        ${raw(chipGroup('activity', ACTIVITIES, entry.activity))}
      </div>

      <div class="field">
        <span class="label">What changes it?</span>
        ${raw(chipGroup('modifiers', MODIFIERS, entry.modifiers))}
      </div>

      <div class="field">
        <span class="label">Also having any of these?</span>
        ${raw(chipGroup('redFlags', RED_FLAGS, entry.redFlags, { flags: true }))}
        <div class="alert" id="red-alert" role="alert" ${entry.redFlags.length ? '' : 'hidden'}>
          <strong>Get emergency care now.</strong>
          Chest pain with shortness of breath, sweating, dizziness or nausea can be a heart attack. Call 911 rather than driving yourself.
          <br><a class="call" href="tel:911">Call 911</a>
        </div>
      </div>

      <div class="field">
        <label class="label" for="start">When did it start?</label>
        <div class="time-row">
          <input type="datetime-local" id="start" value="${toLocalInput(entry.start)}">
          <button type="button" class="chip" data-ago="0">Now</button>
          <button type="button" class="chip" data-ago="30">−30m</button>
        </div>
      </div>

      <div class="field">
        <span class="label">How long did it last?</span>
        ${raw(chipGroup('duration', DURATIONS.map(([v, t]) => [String(v), t]), entry.durationMin != null && DURATIONS.some(([v]) => v === entry.durationMin) ? String(entry.durationMin) : null, { single: true }))}
        <div class="duration-row">
          <input type="number" inputmode="decimal" min="0" step="1" id="duration" placeholder="min" value="${entry.durationMin ?? ''}" aria-label="Duration in minutes">
          <span class="hint">minutes, or pick a range above</span>
        </div>
      </div>

      <div class="field">
        <label class="label" for="notes">Notes</label>
        <textarea id="notes" placeholder="Anything else: food, stress, posture, what helped">${entry.notes || ''}</textarea>
      </div>

      <div class="save-bar">
        <button type="submit" class="btn primary">${editing ? 'Save changes' : 'Save episode'}</button>
      </div>
      ${raw(editing ? '<button type="button" class="btn danger block" id="delete-btn" style="margin-top:12px">Delete episode</button>' : '')}
    </form>

    <section class="section" id="recent" aria-labelledby="recent-h"></section>
  `;

  const form = $('#log-form', root);
  const range = $('#intensity', form);
  range.addEventListener('input', () => {
    $('#int-num', form).textContent = range.value;
    $('#int-word', form).textContent = WORDS[range.value];
  });

  form.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.ago != null) {
      $('#start', form).value = toLocalInput(Date.now() - Number(chip.dataset.ago) * 60000);
      return;
    }
    const group = chip.closest('[data-group]');
    if (!group) return;
    const name = group.dataset.group;
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    if (group.dataset.single) {
      $$('.chip', group).forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', pressed && name !== 'location' ? 'false' : 'true');
    } else {
      chip.setAttribute('aria-pressed', pressed ? 'false' : 'true');
      const excl = EXCLUSIVE[name];
      if (excl && !pressed) {
        $$('.chip', group).forEach((c) => {
          if (chip.dataset.value === excl ? c !== chip : c.dataset.value === excl) c.setAttribute('aria-pressed', 'false');
        });
      }
    }
    if (name === 'duration') {
      const sel = groupValues(form, 'duration')[0];
      $('#duration', form).value = sel ?? '';
    }
    if (name === 'redFlags') {
      const alert = $('#red-alert', form);
      const any = groupValues(form, 'redFlags').length > 0;
      alert.hidden = !any;
      if (any && !pressed) alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  $('#duration', form).addEventListener('input', () => {
    const v = $('#duration', form).value;
    $$('[data-group="duration"] .chip', form).forEach((c) => c.setAttribute('aria-pressed', c.dataset.value === v ? 'true' : 'false'));
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const startVal = $('#start', form).value;
    const start = startVal ? new Date(startVal).getTime() : Date.now();
    const dur = $('#duration', form).value;
    const record = {
      ...entry,
      id: entry.id || uid(),
      start: Number.isNaN(start) ? Date.now() : start,
      durationMin: dur === '' ? null : Math.max(0, Number(dur)),
      intensity: Number(range.value),
      painTypes: groupValues(form, 'painTypes'),
      location: groupValues(form, 'location')[0] || 'left-chest',
      radiates: groupValues(form, 'radiates'),
      activity: groupValues(form, 'activity'),
      modifiers: groupValues(form, 'modifiers'),
      redFlags: groupValues(form, 'redFlags'),
      notes: $('#notes', form).value.trim(),
      createdAt: entry.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await put('symptoms', record);
    if (record.redFlags.length) toast('Saved. If you have those symptoms now, call 911.');
    else toast(editing ? 'Changes saved' : 'Episode saved');
    if (editing) location.hash = '#log';
    else await rerender();
  });

  const delBtn = $('#delete-btn', root);
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this episode? This can’t be undone.')) return;
      await del('symptoms', entry.id);
      toast('Episode deleted');
      location.hash = '#log';
    });
  }

  await renderRecent($('#recent', root), entry.id);
}

async function renderRecent(el, editingId) {
  const all = (await getAll('symptoms')).sort((a, b) => b.start - a.start);
  if (!all.length) {
    el.innerHTML = html`<h2 id="recent-h">Recent episodes</h2>
      <p class="hint" style="margin-top:6px">Episodes you save show up here. Tap one to edit it.</p>`;
    return;
  }
  const list = showAll ? all : all.slice(0, 8);
  el.innerHTML = html`
    <div class="section-head"><h2 id="recent-h">Recent episodes</h2><span class="hint">${all.length} total</span></div>
    <div class="panel" style="padding-block:4px">
      <ul class="episodes">
        ${list.map((e) => html`<li class="episode" tabindex="0" role="button" data-id="${e.id}" aria-label="Edit episode from ${fmtDateTime(e.start)}" ${e.id === editingId ? 'aria-current="true"' : ''}>
          <span class="mark" aria-label="Intensity ${e.intensity ?? '?'} of 10">${e.intensity ?? '?'}</span>
          <div>
            <div class="when">${fmtDateTime(e.start)} <span class="hint">(${relTime(e.start)})</span></div>
            <div class="what">${[labels(e.painTypes), label(e.location), e.durationMin != null ? durationLabel(e.durationMin) || fmtDuration(e.durationMin) : '', (e.activity || []).length ? `while ${labels(e.activity).toLowerCase()}` : ''].filter(Boolean).join(', ') || 'No details'}</div>
            ${raw((e.redFlags || []).length ? html`<div class="flag">With ${labels(e.redFlags).toLowerCase()}</div>` : '')}
          </div>
        </li>`)}
      </ul>
    </div>
    ${raw(all.length > 8 ? html`<button type="button" class="link-btn" id="toggle-all">${showAll ? 'Show fewer' : `Show all ${all.length}`}</button>` : '')}
  `;
  const open = (li) => {
    location.hash = `#log?edit=${encodeURIComponent(li.dataset.id)}`;
  };
  el.onclick = (ev) => {
    const li = ev.target.closest('.episode');
    if (li) open(li);
    if (ev.target.id === 'toggle-all') {
      showAll = !showAll;
      renderRecent(el, editingId);
    }
  };
  el.onkeydown = (ev) => {
    const li = ev.target.closest('.episode');
    if (li && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      open(li);
    }
  };
}
