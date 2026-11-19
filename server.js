// Event planner backend: serves the front end, the event list grouped by week,
// postal-code geocoding (Nominatim) and public transport routes (Transitous).
import express from 'express';
import { getEventsForMonth, addManualEvent, removeManualEvent, clearSampleEvents } from './sources.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const UA = process.env.APP_USER_AGENT || 'event-planner-course-project/0.1';
const POSTAL_RE = /^\d{6}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TRANSITOUS_DAILY_CAP = 600; // stay under the ~720/day soft limit

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20kb' }));

// Anything that changes data must come from this app's own pages, not another website.
const OWN_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://[::1]:${PORT}`]);
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (origin && !OWN_ORIGINS.has(origin)) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  next();
});

// ---------- events ----------
// Events come from sources.js (currently your events.json). Every event the server
// has served is remembered by id so the route endpoint can find it later.
const knownEvents = new Map();

const weekOf = (day) => (day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4);
const WEEK_LABELS = { 1: 'Days 1–7', 2: 'Days 8–14', 3: 'Days 15–21', 4: 'Day 22 to month end' };

app.get('/api/events', async (req, res) => {
  const month = String(req.query.month || '');
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must look like 2026-12' });
  try {
    const now = Date.now();
    const { events: all, sources } = await getEventsForMonth(month);
    const events = all
      .filter((e) => e.start.startsWith(month))
      .filter((e) => new Date(e.end || e.start).getTime() >= now) // hide finished events
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    events.forEach((e) => knownEvents.set(e.id, e));
    const weeks = [1, 2, 3, 4].map((week) => ({
      week,
      label: WEEK_LABELS[week],
      events: events.filter((e) => weekOf(Number(e.start.slice(8, 10))) === week),
    }));
    res.json({ month, total: events.length, weeks, sources });
  } catch (err) {
    console.error('events error:', err.message);
    res.status(500).json({ error: 'Could not load events.' });
  }
});

// ---------- adding and removing your own events ----------
const isRealDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function httpsUrl(v) {
  const s = text(v, 500);
  if (!s) return { value: undefined };
  try { return new URL(s).protocol === 'https:' ? { value: s } : { error: true }; } catch { return { error: true }; }
}

const inSingapore = (lat, lng) => lat > 1.15 && lat < 1.48 && lng > 103.55 && lng < 104.1;

function parseCoords(v) {
  const m = text(v, 40).match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return inSingapore(lat, lng) ? { lat, lng } : null;
}

// Best available location for a venue: exact coordinates > venue name > postal code.
async function locateVenue({ coords, venue, postal }) {
  if (coords) return { ...coords, how: 'the exact location you entered', place: 'your coordinates' };
  const tries = [
    venue && { how: 'the venue name', run: () => geocodeVenue(venue) },
    POSTAL_RE.test(postal) && { how: 'the postal code', run: () => geocode(postal) },
  ].filter(Boolean);
  for (const t of tries) {
    try {
      const g = await t.run();
      if (g && inSingapore(g.lat, g.lng)) return { lat: g.lat, lng: g.lng, how: t.how, place: g.name };
    } catch { /* lookup service unavailable: try the next way */ }
  }
  return null;
}

app.post('/api/events', async (req, res) => {
  const b = req.body || {};
  const title = text(b.title, 120), venue = text(b.venue, 120), postal = text(b.postal, 6);
  const coordsGiven = text(b.coords, 40) !== '';
  const coords = coordsGiven ? parseCoords(b.coords) : null;
  const date = text(b.date, 10), startTime = text(b.startTime, 5), endTime = text(b.endTime, 5);
  const online = b.online === true;

  if (!title) return res.status(400).json({ error: 'Add a title.' });
  if (!isRealDate(date)) return res.status(400).json({ error: 'Pick a valid date.' });
  if (!isTime(startTime)) return res.status(400).json({ error: 'Pick a start time.' });
  if (endTime && !isTime(endTime)) return res.status(400).json({ error: 'The end time is not valid.' });
  if (!online && !venue) return res.status(400).json({ error: 'Add the venue name, or tick "Online event".' });
  if (coordsGiven && !coords) return res.status(400).json({ error: 'The exact location should look like 1.2816, 103.8636 and be inside Singapore.' });
  if (!online && !coords && !POSTAL_RE.test(postal)) return res.status(400).json({ error: 'Enter the venue\'s 6-digit postal code, or tick "Online event".' });
  const url = httpsUrl(b.url), image = httpsUrl(b.image);
  if (url.error) return res.status(400).json({ error: 'The event link must start with https://' });
  if (image.error) return res.status(400).json({ error: 'The image link must start with https://' });

  let end;
  if (endTime) {
    const endDate = endTime > startTime ? date : new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    end = `${endDate}T${endTime}:00+08:00`; // an earlier end time means it finishes after midnight
  }

  const event = {
    id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    title,
    start: `${date}T${startTime}:00+08:00`,
    end,
    venue: online ? 'Online' : venue,
    price: b.free === true ? 'Free' : (text(b.price, 40) || 'See event page'),
    url: url.value,
    image: image.value,
  };
  let located = null;
  if (online) {
    event.online = true;
  } else {
    if (POSTAL_RE.test(postal)) event.postal = postal;
    located = await locateVenue({ coords, venue, postal });
    if (located) { event.lat = located.lat; event.lng = located.lng; }
  }

  try {
    await addManualEvent(event);
    knownEvents.set(event.id, { ...event, source: 'manual' });
    res.status(201).json({
      event,
      located: located ? { how: located.how, place: located.place, lat: located.lat, lng: located.lng } : null,
    });
  } catch (err) {
    console.error('save error:', err.message);
    res.status(500).json({ error: 'Could not save the event.' });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    const removed = await removeManualEvent(req.params.id);
    if (!removed) return res.status(404).json({ error: 'That event was not added through the form, so it cannot be removed here.' });
    knownEvents.delete(req.params.id);
    res.json({ removed });
  } catch (err) {
    console.error('remove error:', err.message);
    res.status(500).json({ error: 'Could not remove the event.' });
  }
});

app.post('/api/events-clear-samples', async (req, res) => {
  try {
    res.json({ removed: await clearSampleEvents() });
  } catch (err) {
    console.error('clear error:', err.message);
    res.status(500).json({ error: 'Could not remove the sample events.' });
  }
});

// ---------- geocoding (Nominatim: max 1 request/second, cached) ----------
const geoCache = new Map();
let nominatimQueue = Promise.resolve();

const GENERIC_PLACES = new Set(['city', 'state', 'country', 'administrative', 'county', 'region', 'suburb']);

function nominatim(key, params) {
  if (geoCache.has(key)) return Promise.resolve(geoCache.get(key));
  const job = nominatimQueue.then(async () => {
    if (geoCache.has(key)) return geoCache.get(key);
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'json', limit: '1', ...params })}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Location lookup failed (${r.status})`);
    const hit = (await r.json())[0];
    // A hit that is just "Singapore" the city or a whole district says nothing about the venue.
    const usable = hit && !GENERIC_PLACES.has(hit.type) && !GENERIC_PLACES.has(hit.addresstype);
    const result = usable ? { lat: Number(hit.lat), lng: Number(hit.lon), name: hit.display_name } : null;
    if (result) geoCache.set(key, result);
    return result;
  });
  // keep the queue moving and space requests 1.1s apart
  nominatimQueue = job.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
  return job;
}

const geocode = (postal) => nominatim(`postal:${postal}`, { postalcode: postal, country: 'sg' });
const geocodeVenue = (name) => nominatim(`venue:${name.toLowerCase()}`, { q: `${name}, Singapore`, countrycodes: 'sg' });

app.get('/api/geocode', async (req, res) => {
  const postal = String(req.query.postal || '');
  if (!POSTAL_RE.test(postal)) return res.status(400).json({ error: 'Enter a 6-digit Singapore postal code.' });
  try {
    const g = await geocode(postal);
    if (!g) return res.status(404).json({ error: 'We could not find that postal code.' });
    res.json(g);
  } catch (err) {
    res.status(502).json({ error: 'Postal code lookup is unavailable right now. Try again shortly.' });
  }
});

// ---------- routing (Transitous: cached, daily request cap) ----------
const routeCache = new Map();
let dayKey = '';
let dayCount = 0;

function underDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCount = 0; }
  return dayCount < TRANSITOUS_DAILY_CAP;
}

app.get('/api/route', async (req, res) => {
  const from = String(req.query.from || '');
  if (!POSTAL_RE.test(from)) return res.status(400).json({ error: 'Enter a 6-digit Singapore postal code.' });
  try {
    const event = knownEvents.get(String(req.query.event || ''));
    if (!event) return res.status(404).json({ error: 'Unknown event. Reload the page and try again.' });
    if (event.online) return res.status(400).json({ error: 'This is an online event, so there is no trip to plan.' });

    // Default: leave 1 hour before the event starts. Never plan a trip in the past.
    let depart = req.query.depart ? new Date(String(req.query.depart)) : new Date(new Date(event.start).getTime() - 3600_000);
    if (Number.isNaN(depart.getTime())) return res.status(400).json({ error: 'Bad departure time.' });
    if (depart.getTime() < Date.now() + 300_000) depart = new Date(Date.now() + 300_000);
    depart = new Date(Math.round(depart.getTime() / 300_000) * 300_000); // 5-minute buckets help the cache

    const key = `${from}|${event.id}|${depart.toISOString()}`;
    const hit = routeCache.get(key);
    if (hit && hit.expires > Date.now()) return res.json(hit.data);

    const origin = await geocode(from);
    if (!origin) return res.status(404).json({ error: 'We could not find that postal code.' });
    const dest = event.lat != null && event.lng != null ? { lat: event.lat, lng: event.lng }
      : event.postal ? await geocode(event.postal) : null;
    if (!dest) return res.status(404).json({ error: 'We could not locate the venue.' });

    if (!underDailyCap()) return res.status(429).json({ error: 'Daily route limit reached. Please use the Google Maps link instead.' });
    dayCount += 1;

    const params = new URLSearchParams({
      fromPlace: `${origin.lat},${origin.lng}`,
      toPlace: `${dest.lat},${dest.lng}`,
      time: depart.toISOString(),
      numItineraries: '5',
    });
    const r = await fetch(`https://api.transitous.org/api/v5/plan?${params}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(body.itineraries)) throw new Error(`Transitous responded ${r.status}`);

    const seen = new Set();
    const options = body.itineraries
      .filter((it) => {
        const k = it.legs.map((l) => `${l.mode}:${l.routeShortName || ''}`).join('|');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 3)
      .map((it) => ({
        minutes: Math.round((it.duration ?? (new Date(it.endTime) - new Date(it.startTime)) / 1000) / 60),
        transfers: it.transfers ?? 0,
        legs: it.legs.map((l) => ({
          mode: l.mode,
          line: l.routeShortName || '',
          agency: l.agencyName || '',
          from: l.from?.name || '',
          to: l.to?.name || '',
          minutes: Math.round((l.duration || 0) / 60),
        })),
      }));

    const data = { depart: depart.toISOString(), options };
    routeCache.set(key, { expires: Date.now() + 10 * 60_000, data });
    res.json(data);
  } catch (err) {
    console.error('route error:', err.message);
    res.status(502).json({ error: 'Directions are unavailable right now. Use the Google Maps link instead.' });
  }
});

app.listen(PORT, '127.0.0.1', () => console.log(`Event planner running at http://localhost:${PORT}`));
