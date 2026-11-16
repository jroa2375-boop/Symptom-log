// Choices for the symptom form. Ids are stored; labels are shown.

export const PAIN_TYPES = [
  ['sharp', 'Sharp'],
  ['dull', 'Dull'],
  ['burning', 'Burning'],
  ['pressure', 'Pressure'],
  ['aching', 'Aching'],
];

export const LOCATIONS = [
  ['left-chest', 'Left chest'],
  ['upper-left-chest', 'Upper left chest'],
  ['under-left-breast', 'Under left pec'],
  ['left-ribs', 'Left side / ribs'],
  ['center-chest', 'Center chest'],
  ['left-shoulder', 'Left shoulder'],
];

export const RADIATES = [
  ['arm', 'Arm'],
  ['back', 'Back'],
  ['neck', 'Neck'],
  ['jaw', 'Jaw'],
  ['none', 'None'],
];

export const ACTIVITIES = [
  ['resting', 'Resting'],
  ['lifting', 'Lifting'],
  ['driving', 'Driving'],
  ['after-eating', 'After eating'],
  ['lying-down', 'Lying down'],
  ['exercising', 'Exercising'],
  ['working', 'Working'],
  ['other', 'Other'],
];

export const MODIFIERS = [
  ['deep-breathing', 'Deep breathing'],
  ['twisting', 'Twisting'],
  ['pressing', 'Pressing the spot'],
  ['moving-arm', 'Moving arm'],
  ['nothing', 'Nothing'],
];

export const RED_FLAGS = [
  ['sob', 'Short of breath'],
  ['sweating', 'Sweating'],
  ['dizziness', 'Dizzy'],
  ['nausea', 'Nausea'],
];

export const DURATIONS = [
  [1, '< 1 min'],
  [5, '1–5 min'],
  [15, '5–15 min'],
  [30, '15–30 min'],
  [60, '30–60 min'],
  [120, '1 h +'],
];

const ALL = [PAIN_TYPES, LOCATIONS, RADIATES, ACTIVITIES, MODIFIERS, RED_FLAGS].flat();
const LABELS = new Map(ALL.map(([id, label]) => [id, label]));

export function label(id) {
  return LABELS.get(id) || String(id).replace(/-/g, ' ');
}

export function labels(ids) {
  return (ids || []).map(label).join(', ');
}

/** Modifiers that suggest a mechanical (muscle, rib, joint) component when they change the pain. */
export const MECHANICAL = ['twisting', 'pressing', 'moving-arm', 'deep-breathing'];

/** "5–15 min" for a duration picked from the ranges, otherwise null. */
export function durationLabel(min) {
  const hit = DURATIONS.find(([v]) => v === min);
  return hit ? hit[1] : null;
}
