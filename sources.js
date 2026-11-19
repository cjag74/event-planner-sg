// Event sources. Each source returns events in the app's shape.
// Right now the only source is the hand-picked events.json; add another source function
// to the list in getEventsForMonth() to merge more feeds into the same week view.
//
// Event shape: { id, title, start, end?, venue, postal?, lat?, lng?, price, url, image?, online?, source }
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function manualSource(month) {
  const raw = JSON.parse(await readFile(path.join(__dirname, 'events.json'), 'utf8'));
  const events = raw.events
    .filter((e) => e.start.startsWith(month))
    .map((e) => ({ ...e, source: 'manual' }));
  return { name: 'Your events.json', enabled: true, events };
}

export async function getEventsForMonth(month) {
  const results = await Promise.all([manualSource(month)]);
  const events = results.flatMap((s) => s.events);
  const sources = results.map((s) => ({ name: s.name, enabled: s.enabled, count: s.events.length, error: s.error }));
  return { events, sources };
}

// ---------- editing events.json (used by the Add event page) ----------
// Writes are queued so two requests can never overwrite each other, and the file is
// replaced atomically (write a temp file, then rename).
const EVENTS_FILE = path.join(__dirname, 'events.json');
let writeQueue = Promise.resolve();

function mutateEvents(change) {
  const job = writeQueue.then(async () => {
    const raw = JSON.parse(await readFile(EVENTS_FILE, 'utf8'));
    const result = change(raw);
    const lines = raw.events.map((e) => `    ${JSON.stringify(e)}`);
    const text = `{\n  "_readme": ${JSON.stringify(raw._readme || '')},\n  "events": [\n${lines.join(',\n')}\n  ]\n}\n`;
    const tmp = `${EVENTS_FILE}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, EVENTS_FILE);
    return result;
  });
  writeQueue = job.catch(() => {});
  return job;
}

export const addManualEvent = (event) => mutateEvents((raw) => { raw.events.push(event); return event; });

// Only events added through the form (ids starting "m-") can be removed this way.
export const removeManualEvent = (id) => mutateEvents((raw) => {
  const before = raw.events.length;
  raw.events = raw.events.filter((e) => !(e.id === id && id.startsWith('m-')));
  return before - raw.events.length;
});

export const clearSampleEvents = () => mutateEvents((raw) => {
  const before = raw.events.length;
  raw.events = raw.events.filter((e) => !e.sample);
  return before - raw.events.length;
});
