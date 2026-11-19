// Front end for Event Planner SG. All text is inserted with textContent (never innerHTML).
const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: app still works */ }
  },
};

const state = {
  postal: store.get('postal', ''),
  plan: new Set(store.get('plan', [])),
  userCoords: null,
  data: null,
};

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'onclick') node.addEventListener('click', v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);
const fmt = (iso, opts) => new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', ...opts });
const fmtWhen = (e) => fmt(e.start, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function km(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function setPostalMsg(text, isError = false) {
  const m = $('postalMsg');
  m.textContent = text;
  m.className = isError ? 'msg error' : 'msg';
}

const api = apiCall; // defined in api.js

// ---------- postal code ----------
async function applyPostal(value) {
  const postal = value.trim();
  state.userCoords = null;
  if (!postal) { state.postal = ''; store.set('postal', ''); setPostalMsg(''); render(); return; }
  if (!/^\d{6}$/.test(postal)) { setPostalMsg('Enter a 6-digit Singapore postal code.', true); return; }
  setPostalMsg('Looking up postal code…');
  try {
    const g = await api(`/api/geocode?postal=${postal}`);
    state.postal = postal;
    state.userCoords = { lat: g.lat, lng: g.lng };
    store.set('postal', postal);
    setPostalMsg(`Starting from ${postal}`);
  } catch (err) {
    setPostalMsg(err.message, true);
  }
  render();
}

// ---------- directions ----------
function googleMapsLink(event) {
  const dest = event.postal ? `${event.venue}, Singapore ${event.postal}` : event.venue;
  const params = new URLSearchParams({ api: '1', destination: dest, travelmode: 'transit' });
  if (state.postal) params.set('origin', `Singapore ${state.postal}`);
  return `https://www.google.com/maps/dir/?${params}`;
}

function renderOptions(box, result) {
  box.replaceChildren();
  if (!result.options.length) { box.append(el('p', { class: 'meta' }, 'No public transport route found for that time.')); return; }
  result.options.forEach((opt, i) => {
    const list = el('ul');
    for (const leg of opt.legs) {
      const what = leg.mode === 'WALK' ? 'Walk' : `${leg.mode === 'SUBWAY' ? 'MRT' : leg.mode === 'BUS' ? 'Bus' : leg.mode} ${leg.line}`.trim();
      list.append(el('li', {}, `${what}: ${leg.from} → ${leg.to} (${leg.minutes} min)`));
    }
    box.append(el('div', { class: 'option' },
      el('strong', {}, `Option ${i + 1}: about ${opt.minutes} min, ${opt.transfers} transfer${opt.transfers === 1 ? '' : 's'}`),
      list));
  });
}

function directionsPanel(event) {
  const panel = el('div', { class: 'route' });
  const defaultTime = fmt(new Date(new Date(event.start).getTime() - 3600_000).toISOString(), { hour: '2-digit', minute: '2-digit', hour12: false });
  const timeInput = el('input', { type: 'time', value: defaultTime });
  const out = el('div');
  const go = el('button', { class: 'primary' }, 'Get route');

  async function load() {
    go.disabled = true;
    out.replaceChildren(el('p', { class: 'meta' }, 'Finding routes…'));
    const day = event.start.slice(0, 10);
    const depart = new Date(`${day}T${timeInput.value || defaultTime}:00+08:00`).toISOString();
    try {
      const r = await api(`/api/route?from=${state.postal}&event=${encodeURIComponent(event.id)}&depart=${encodeURIComponent(depart)}`);
      renderOptions(out, r);
      out.prepend(el('p', { class: 'meta' }, `Leaving about ${fmt(r.depart, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`));
    } catch (err) {
      out.replaceChildren(el('p', { class: 'msg error' }, err.message),
        el('a', { class: 'btn', href: googleMapsLink(event), target: '_blank', rel: 'noopener' }, 'Open in Google Maps'));
    } finally { go.disabled = false; }
  }
  go.addEventListener('click', load);
  panel.append(el('div', { class: 'row' }, el('label', {}, 'Leave at '), timeInput, go,
    el('a', { class: 'btn', href: googleMapsLink(event), target: '_blank', rel: 'noopener' }, 'Google Maps')), out);
  load();
  return panel;
}

// ---------- rendering ----------
function card(event) {
  const url = safeUrl(event.url);
  const tags = el('div', { class: 'tags' });
  if (event.online) tags.append(el('span', { class: 'tag' }, 'Online'));
  if (/^free$/i.test(event.price)) tags.append(el('span', { class: 'tag' }, 'Free'));
  if (event.sample) tags.append(el('span', { class: 'tag' }, 'Sample'));
  if (event._km != null) tags.append(el('span', { class: 'tag' }, `${event._km.toFixed(1)} km away`));

  const planBtn = el('button', { class: state.plan.has(event.id) ? 'on' : '' }, state.plan.has(event.id) ? '★ In my plan' : '☆ Add to plan');
  planBtn.addEventListener('click', () => {
    if (state.plan.has(event.id)) state.plan.delete(event.id); else state.plan.add(event.id);
    store.set('plan', [...state.plan]);
    render();
  });

  const actions = el('div', { class: 'actions' }, planBtn);
  if (url) actions.append(el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Event page'));

  if (event.id.startsWith('m-')) {
    const rm = el('button', {}, 'Remove');
    rm.addEventListener('click', async () => {
      if (!confirm(`Remove "${event.title}"?`)) return;
      try { await api(`/api/events/${encodeURIComponent(event.id)}`, { method: 'DELETE' }); } catch { /* reload shows the truth */ }
      loadMonth();
    });
    actions.append(rm);
  }

  const holder = el('div', { class: 'holder' });
  if (!event.online) {
    const dirBtn = el('button', {}, 'Directions');
    dirBtn.addEventListener('click', () => {
      if (!state.postal) { setPostalMsg('Enter your postal code first to get directions.', true); $('postal').focus(); return; }
      if (holder.firstChild) { holder.replaceChildren(); return; }
      holder.append(directionsPanel(event));
    });
    actions.append(dirBtn);
  }

  const image = safeUrl(event.image);
  const badge = el('div', { class: 'date-badge' },
    el('b', {}, fmt(event.start, { day: 'numeric' })),
    el('span', {}, fmt(event.start, { month: 'short' })));
  const thumb = el('div', { class: 'thumb' }, image ? el('img', { src: image, alt: '', loading: 'lazy' }) : null, badge);
  const isFree = /^free$/i.test(event.price);

  return el('article', { class: 'card' },
    thumb,
    el('div', { class: 'body' },
      el('div', { class: 'top' },
        el('h3', {}, event.title),
        el('div', { class: isFree ? 'price free' : 'price' }, event.price || '')),
      el('p', { class: 'meta' }, fmtWhen(event)),
      el('p', { class: 'meta' }, `${event.venue}${event.postal ? ` · ${event.postal}` : ''}`),
      tags, actions),
    holder);
}

function render() {
  const root = $('weeks');
  root.replaceChildren();
  if (!state.data) return;
  const freeOnly = $('freeOnly').checked, planOnly = $('planOnly').checked, sort = $('sort').value;
  $('sampleBanner').hidden = !state.data.weeks.some((w) => w.events.some((e) => e.sample));

  for (const w of state.data.weeks) {
    let events = w.events
      .filter((e) => !freeOnly || /^free$/i.test(e.price))
      .filter((e) => !planOnly || state.plan.has(e.id))
      .map((e) => ({ ...e, _km: state.userCoords && e.lat != null ? km(state.userCoords, e) : null }));
    if (sort === 'nearest' && state.userCoords) {
      events.sort((a, b) => (a._km ?? Infinity) - (b._km ?? Infinity));
    }
    const section = el('section', { class: 'week' },
      el('h2', {}, `Week ${w.week}`, el('small', {}, w.label)));
    if (!events.length) section.append(el('p', { class: 'empty' }, 'No events this week.'));
    events.forEach((e) => section.append(card(e)));
    root.append(section);
  }
}

async function loadMonth() {
  const month = $('month').value;
  if (!month) return;
  $('weeks').replaceChildren(el('p', { class: 'empty' }, 'Loading events…'));
  try {
    state.data = await api(`/api/events?month=${month}`);
    render();
  } catch (err) {
    state.data = null;
    $('weeks').replaceChildren(el('p', { class: 'msg error' }, err.message));
  }
}

// ---------- init ----------
$('month').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }).slice(0, 7);
$('postal').value = state.postal;
$('month').addEventListener('change', loadMonth);
$('sort').addEventListener('change', () => {
  if ($('sort').value === 'nearest' && !state.userCoords) setPostalMsg('Enter your postal code to sort by nearest.', true);
  render();
});
$('freeOnly').addEventListener('change', render);
$('planOnly').addEventListener('change', render);
$('postal').addEventListener('change', (e) => applyPostal(e.target.value));
$('postal').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyPostal(e.target.value); });

if (window.STATIC_MODE) {
  const f = document.querySelector('footer');
  if (f) f.append(el('p', {}, 'Events you add are saved in this browser only, so they are private to you on this device.'));
}

loadMonth();
if (state.postal) applyPostal(state.postal);
