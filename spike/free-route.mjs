// Spike: Singapore postal code -> public transport route using free, keyless APIs.
//   Geocoding: Nominatim (OpenStreetMap)     Routing: Transitous (MOTIS)
// Usage: node spike/free-route.mjs <fromPostal> <toPostal> [HH:MM] [YYYY-MM-DD]
// Example: node spike/free-route.mjs 560123 018956 18:00 2026-11-20
//
// Both services require an identifying User-Agent. Set APP_USER_AGENT to something like
// "event-planner/0.1 (you@example.com)" before any real use; the default is generic.
// Nominatim allows 1 request/second and returns postcode-area centroids, not exact buildings.

const UA = process.env.APP_USER_AGENT || 'event-planner-course-project/0.1';
const [fromPostal, toPostal, timeArg, dateArg] = process.argv.slice(2);

if (!fromPostal || !toPostal) {
  console.error('Usage: node spike/free-route.mjs <fromPostal> <toPostal> [HH:MM] [YYYY-MM-DD]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(postal) {
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(postal)}&country=sg&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Nominatim failed for ${postal} (${res.status})`);
  const hit = (await res.json())[0];
  if (!hit) throw new Error(`No location found for postal code ${postal}`);
  return { lat: hit.lat, lng: hit.lon, name: hit.display_name };
}

const mins = (sec) => Math.round(sec / 60);

try {
  const from = await geocode(fromPostal);
  await sleep(1100); // Nominatim: max 1 request per second
  const to = await geocode(toPostal);
  console.log(`From ${fromPostal}: ${from.lat},${from.lng}  (${from.name})`);
  console.log(`To   ${toPostal}: ${to.lat},${to.lng}  (${to.name})`);

  const date = dateArg || new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const when = new Date(`${date}T${timeArg || '09:00'}:00+08:00`);
  if (Number.isNaN(when.getTime())) throw new Error('Bad date/time. Use HH:MM and YYYY-MM-DD.');

  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lng}`,
    toPlace: `${to.lat},${to.lng}`,
    time: when.toISOString(),
    numItineraries: '5',
  });
  const res = await fetch(`https://api.transitous.org/api/v5/plan?${params}`, { headers: { 'User-Agent': UA } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.itineraries)) {
    console.error(`Transitous failed (${res.status}):`, JSON.stringify(data).slice(0, 500));
    process.exit(1);
  }

  // Transitous can return near-duplicate itineraries; dedupe by the sequence of lines used.
  const seen = new Set();
  const options = data.itineraries.filter((it) => {
    const key = it.legs.map((l) => `${l.mode}:${l.routeShortName || ''}`).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\nDeparting ${when.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} (Singapore time)`);
  options.forEach((it, i) => {
    const total = it.duration ?? (new Date(it.endTime) - new Date(it.startTime)) / 1000;
    console.log(`\nOption ${i + 1}: ${mins(total)} min, ${it.transfers ?? '?'} transfer(s)`);
    for (const leg of it.legs) {
      const label = leg.mode === 'WALK' ? 'WALK' : `${leg.mode} ${leg.routeShortName || ''} ${leg.agencyName ? `(${leg.agencyName})` : ''}`.replace(/\s+/g, ' ').trim();
      console.log(`  - ${label}: ${leg.from?.name} -> ${leg.to?.name} (${mins(leg.duration)} min)`);
    }
  });
  console.log('\nData: Transitous (transitous.org) and OpenStreetMap contributors.');
} catch (err) {
  console.error('Spike failed:', err.message);
  process.exit(1);
}
