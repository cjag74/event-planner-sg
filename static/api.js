// Browser-only data layer for the GitHub Pages build. It answers the same "/api/..." calls as
// server.js, but entirely in the visitor's browser:
//   - events: the sample events from events.json plus events the visitor added (localStorage)
//   - postal codes and venues: Nominatim (OpenStreetMap), called directly
//   - routes: Transitous, called directly
// The browser sends the site's address as the Referer, which both services accept in place of a User-Agent.
window.STATIC_MODE = true;

(() => {
  const POSTAL_RE = /^\d{6}$/;
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const WEEK_LABELS = { 1: 'Days 1–7', 2: 'Days 8–14', 3: 'Days 15–21', 4: 'Day 22 to month end' };
  const weekOf = (day) => (day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4);

  class HttpError extends Error {}
  const fail = (message) => { throw new HttpError(message); };

  // ----- storage (falls back to memory if the browser blocks localStorage) -----
  const memory = {};
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return key in memory ? memory[key] : fallback; }
    },
    set(key, value) {
      memory[key] = value;
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* memory copy still works for this visit */ }
    },
  };

  // ----- events -----
  let seedPromise;
  const loadSeed = () => (seedPromise ||= fetch('events.json').then((r) => r.json()).then((j) => j.events.map((e) => ({ ...e, source: 'manual' }))));
  const added = () => store.get('ep.added', []);
  async function allEvents() {
    const seed = await loadSeed();
    const hideSamples = store.get('ep.hideSamples', false);
    return [...seed.filter((e) => !(hideSamples && e.sample)), ...added().map((e) => ({ ...e, source: 'manual' }))];
  }

  async function getEvents(query) {
    const month = query.get('month') || '';
    if (!MONTH_RE.test(month)) fail('month must look like 2026-12');
    const now = Date.now();
    const events = (await allEvents())
      .filter((e) => e.start.startsWith(month))
      .filter((e) => new Date(e.end || e.start).getTime() >= now) // hide finished events
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    const weeks = [1, 2, 3, 4].map((week) => ({
      week, label: WEEK_LABELS[week],
      events: events.filter((e) => weekOf(Number(e.start.slice(8, 10))) === week),
    }));
    return { month, total: events.length, weeks, sources: [{ name: 'Your events', enabled: true, count: events.length }] };
  }

  // ----- Nominatim lookups: one request a second, cached -----
  const GENERIC_PLACES = new Set(['city', 'state', 'country', 'administrative', 'county', 'region', 'suburb']);
  const geoCache = new Map();
  let queue = Promise.resolve();

  function nominatim(key, params) {
    if (geoCache.has(key)) return Promise.resolve(geoCache.get(key));
    const job = queue.then(async () => {
      if (geoCache.has(key)) return geoCache.get(key);
      const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'json', limit: '1', ...params })}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Location lookup failed (${r.status})`);
      const hit = (await r.json())[0];
      const usable = hit && !GENERIC_PLACES.has(hit.type) && !GENERIC_PLACES.has(hit.addresstype);
      const result = usable ? { lat: Number(hit.lat), lng: Number(hit.lon), name: hit.display_name } : null;
      if (result) geoCache.set(key, result);
      return result;
    });
    queue = job.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
    return job;
  }
  const geocode = (postal) => nominatim(`postal:${postal}`, { postalcode: postal, country: 'sg' });
  const geocodeVenue = (name) => nominatim(`venue:${name.toLowerCase()}`, { q: `${name}, Singapore`, countrycodes: 'sg' });

  async function getGeocode(query) {
    const postal = query.get('postal') || '';
    if (!POSTAL_RE.test(postal)) fail('Enter a 6-digit Singapore postal code.');
    let g;
    try { g = await geocode(postal); } catch { fail('Postal code lookup is unavailable right now. Try again shortly.'); }
    if (!g) fail('We could not find that postal code.');
    return g;
  }

  // ----- adding and removing events -----
  const inSingapore = (lat, lng) => lat > 1.15 && lat < 1.48 && lng > 103.55 && lng < 104.1;
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const isRealDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  function httpsUrl(v) {
    const s = text(v, 500);
    if (!s) return { value: undefined };
    try { return new URL(s).protocol === 'https:' ? { value: s } : { error: true }; } catch { return { error: true }; }
  }
  function parseCoords(v) {
    const m = text(v, 40).match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return inSingapore(lat, lng) ? { lat, lng } : null;
  }

  // Best available location: exact coordinates > venue name > postal code.
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
      } catch { /* lookup unavailable: try the next way */ }
    }
    return null;
  }

  async function postEvent(b = {}) {
    const title = text(b.title, 120), venue = text(b.venue, 120), postal = text(b.postal, 6);
    const date = text(b.date, 10), startTime = text(b.startTime, 5), endTime = text(b.endTime, 5);
    const online = b.online === true;
    const coordsGiven = text(b.coords, 40) !== '';
    const coords = coordsGiven ? parseCoords(b.coords) : null;

    if (!title) fail('Add a title.');
    if (!isRealDate(date)) fail('Pick a valid date.');
    if (!isTime(startTime)) fail('Pick a start time.');
    if (endTime && !isTime(endTime)) fail('The end time is not valid.');
    if (!online && !venue) fail('Add the venue name, or tick "Online event".');
    if (coordsGiven && !coords) fail('The exact location should look like 1.2816, 103.8636 and be inside Singapore.');
    if (!online && !coords && !POSTAL_RE.test(postal)) fail('Enter the venue\'s 6-digit postal code, or tick "Online event".');
    const url = httpsUrl(b.url), image = httpsUrl(b.image);
    if (url.error) fail('The event link must start with https://');
    if (image.error) fail('The image link must start with https://');

    let end;
    if (endTime) {
      const endDate = endTime > startTime ? date : new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      end = `${endDate}T${endTime}:00+08:00`; // an earlier end time means it finishes after midnight
    }
    const event = {
      id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      title, start: `${date}T${startTime}:00+08:00`, end,
      venue: online ? 'Online' : venue,
      price: b.free === true ? 'Free' : (text(b.price, 40) || 'See event page'),
      url: url.value, image: image.value,
    };
    let located = null;
    if (online) {
      event.online = true;
    } else {
      if (POSTAL_RE.test(postal)) event.postal = postal;
      located = await locateVenue({ coords, venue, postal });
      if (located) { event.lat = located.lat; event.lng = located.lng; }
    }
    store.set('ep.added', [...added(), event]);
    return { event, located: located ? { how: located.how, place: located.place, lat: located.lat, lng: located.lng } : null };
  }

  function deleteEvent(id) {
    const list = added();
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) fail('That event was not added through the form, so it cannot be removed here.');
    store.set('ep.added', next);
    return { removed: 1 };
  }

  async function clearSamples() {
    const seed = await loadSeed();
    const already = store.get('ep.hideSamples', false);
    store.set('ep.hideSamples', true);
    return { removed: already ? 0 : seed.filter((e) => e.sample).length };
  }

  // ----- routes (Transitous) -----
  const routeCache = new Map();

  async function getRoute(query) {
    const from = query.get('from') || '';
    if (!POSTAL_RE.test(from)) fail('Enter a 6-digit Singapore postal code.');
    const event = (await allEvents()).find((e) => e.id === (query.get('event') || ''));
    if (!event) fail('Unknown event. Reload the page and try again.');
    if (event.online) fail('This is an online event, so there is no trip to plan.');

    let depart = query.get('depart') ? new Date(query.get('depart')) : new Date(new Date(event.start).getTime() - 3600_000);
    if (Number.isNaN(depart.getTime())) fail('Bad departure time.');
    if (depart.getTime() < Date.now() + 300_000) depart = new Date(Date.now() + 300_000);
    depart = new Date(Math.round(depart.getTime() / 300_000) * 300_000);

    const key = `${from}|${event.id}|${depart.toISOString()}`;
    const hit = routeCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data;

    let origin;
    try { origin = await geocode(from); } catch { fail('Postal code lookup is unavailable right now. Try again shortly.'); }
    if (!origin) fail('We could not find that postal code.');
    let dest = event.lat != null && event.lng != null ? { lat: event.lat, lng: event.lng } : null;
    if (!dest && event.postal) { try { dest = await geocode(event.postal); } catch { /* handled below */ } }
    if (!dest) fail('We could not locate the venue.');

    let body;
    try {
      const params = new URLSearchParams({
        fromPlace: `${origin.lat},${origin.lng}`, toPlace: `${dest.lat},${dest.lng}`,
        time: depart.toISOString(), numItineraries: '5',
      });
      const r = await fetch(`https://api.transitous.org/api/v5/plan?${params}`);
      body = await r.json();
      if (!r.ok || !Array.isArray(body.itineraries)) throw new Error(`Transitous responded ${r.status}`);
    } catch {
      fail('Directions are unavailable right now. Use the Google Maps link instead.');
    }

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
          mode: l.mode, line: l.routeShortName || '', agency: l.agencyName || '',
          from: l.from?.name || '', to: l.to?.name || '', minutes: Math.round((l.duration || 0) / 60),
        })),
      }));
    const data = { depart: depart.toISOString(), options };
    routeCache.set(key, { expires: Date.now() + 10 * 60_000, data });
    return data;
  }

  // ----- dispatcher: same paths as server.js -----
  window.apiCall = async function apiCall(path, options = {}) {
    const url = new URL(path, 'http://static.local');
    const method = options.method || 'GET';
    const q = url.searchParams;
    try {
      if (method === 'GET' && url.pathname === '/api/events') return await getEvents(q);
      if (method === 'GET' && url.pathname === '/api/geocode') return await getGeocode(q);
      if (method === 'GET' && url.pathname === '/api/route') return await getRoute(q);
      if (method === 'POST' && url.pathname === '/api/events') return await postEvent(options.body);
      if (method === 'POST' && url.pathname === '/api/events-clear-samples') return await clearSamples();
      if (method === 'DELETE' && url.pathname.startsWith('/api/events/')) return deleteEvent(decodeURIComponent(url.pathname.slice('/api/events/'.length)));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error(err);
      throw new Error('Something went wrong. Please try again.');
    }
    throw new Error('Unknown request.');
  };
})();
