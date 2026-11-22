// Writes daily Anki review counts to data/anki.json for the review heatmap.
// Needs Anki open with the AnkiConnect add-on. Run with: npm run anki
// Only per-day counts are written; no card content leaves Anki.

import { writeFile } from 'node:fs/promises';

const ANKI = process.env.ANKI_CONNECT_URL ?? 'http://127.0.0.1:8765';
const OUT = new URL('../data/anki.json', import.meta.url);
// Anki's "Next day starts at" (Preferences > Review). AnkiConnect's daily totals use the
// same boundary; this script needs it to place hand-rescheduled entries on the right day.
const ROLLOVER_HOURS = Number(process.env.ANKI_ROLLOVER_HOURS ?? 4);

async function anki(action, params = {}) {
  let res;
  try {
    res = await fetch(ANKI, { method: 'POST', body: JSON.stringify({ action, version: 6, params }) });
  } catch {
    throw new Error(`Cannot reach AnkiConnect at ${ANKI}. Open Anki and try again.`);
  }
  const { result, error } = await res.json();
  if (error) throw new Error(`AnkiConnect ${action} failed: ${error}`);
  return result;
}

// Anki day (local time, shifted by the rollover hour) as YYYY-MM-DD.
function ankiDay(ms) {
  const d = new Date(ms - ROLLOVER_HOURS * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 1. Every review-log entry per day, including reviews of cards deleted since.
const counts = new Map((await anki('getNumCardsReviewedByDay')).map(([day, n]) => [day, n]));

// 2. Hand reschedules ("Set due date", "Forget") are logged too, with no answer button
//    (ease 0). They are not reviews, so subtract them.
const cards = await anki('findCards', { query: 'deck:*' });
const history = await anki('getReviewsOfCards', { cards });
for (const entries of Object.values(history)) {
  for (const e of entries) {
    if (e.ease !== 0) continue;
    const day = ankiDay(e.id);
    if (counts.has(day)) counts.set(day, counts.get(day) - 1);
  }
}

// 3. One number per day, from the first review through today (zeros for days off).
const updated = ankiDay(Date.now());
const start = [...counts.keys()].sort()[0] ?? updated;
const series = [];
for (let day = start; day <= updated; day = addDays(day, 1)) series.push(Math.max(0, counts.get(day) ?? 0));

await writeFile(OUT, JSON.stringify({ updated, start, counts: series }) + '\n');
const total = series.reduce((a, b) => a + b, 0);
console.log(`Wrote ${series.length} days (${start} to ${updated}), ${total.toLocaleString('en-US')} reviews, to data/anki.json`);
