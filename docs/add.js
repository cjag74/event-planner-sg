const form = document.getElementById('form');
const msg = document.getElementById('msg');
const save = document.getElementById('save');
const where = document.getElementById('where');

function say(text, kind = '') {
  msg.textContent = text;
  msg.className = kind === 'error' ? 'msg error' : kind === 'ok' ? 'msg ok' : 'msg';
}

function syncFields() {
  const online = form.online.checked;
  document.getElementById('placeFields').hidden = online;
  document.getElementById('coordsField').hidden = online;
  form.price.disabled = form.free.checked;
}
form.online.addEventListener('change', syncFields);
form.free.addEventListener('change', syncFields);
syncFields();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: form.title.value,
    date: form.date.value,
    startTime: form.startTime.value,
    endTime: form.endTime.value,
    online: form.online.checked,
    venue: form.venue.value,
    postal: form.postal.value.trim(),
    coords: form.coords.value,
    free: form.free.checked,
    price: form.price.value,
    url: form.url.value,
    image: form.image.value,
  };
  save.disabled = true;
  say('Saving…');
  where.replaceChildren();
  try {
    const data = await apiCall('/api/events', { method: 'POST', body });
    const month = data.event.start.slice(0, 7);
    say(`Saved "${data.event.title}". It shows under ${month} on the events page.`, 'ok');
    if (data.located) {
      const link = document.createElement('a');
      link.href = `https://www.google.com/maps?q=${data.located.lat},${data.located.lng}`;
      link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Check it on a map';
      where.className = 'msg';
      where.append(`Located using ${data.located.how}: ${String(data.located.place).slice(0, 110)}. `, link);
    } else if (!data.event.online) {
      where.className = 'msg error';
      where.textContent = "We couldn't locate this venue, so directions won't work for it. Remove it from the events page and add it again with an exact location.";
    }
    // Keep the date so several events on the same day are quick to add.
    const keepDate = form.date.value;
    form.reset();
    form.date.value = keepDate;
    syncFields();
    form.title.focus();
  } catch (err) {
    say(err.message, 'error');
  } finally {
    save.disabled = false;
  }
});

document.getElementById('clearSamples').addEventListener('click', async () => {
  if (!confirm('Remove all the SAMPLE placeholder events? Events you added stay.')) return;
  try {
    const data = await apiCall('/api/events-clear-samples', { method: 'POST', body: {} });
    say(data.removed ? `Removed ${data.removed} sample event(s).` : 'There were no sample events to remove.', 'ok');
  } catch (err) {
    say(err.message, 'error');
  }
});

if (window.STATIC_MODE) say('Events you add are saved in this browser only, so they are private to you on this device.');
