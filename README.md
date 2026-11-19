# Event Planner SG

Plan Singapore events by week of the month, with bus and MRT directions from your postal code. See [SCOPE.md](SCOPE.md) for the agreed scope.

## Live site

A browser-only version is published with GitHub Pages at https://cjag74.github.io/event-planner-sg/ . It runs entirely in your browser: events you add are saved in that browser only, and postal codes and routes are looked up directly from Nominatim and Transitous. It starts with the sample events in `events.json`.

To update the site after changing anything in `public/`, `static/` or `events.json`, run `npm run build:static` and commit the `docs/` folder.

## Run it (full version with a local server)

```bash
npm install
npm start
```

Then open http://localhost:3000.

Optional: copy `.env.example` to `.env` and set `APP_USER_AGENT` to your app name plus a contact. Nominatim and Transitous ask for this on real use. No API keys are needed.

## Add your events

Open http://localhost:3000/add.html (or click "+ Add an event" on the main page). Enter the title, date, times, venue name and postal code, and price. The app finds the venue from its name, then its postal code, and tells you where it landed with a map link so you can check it. If it lands in the wrong place, paste exact coordinates (right-click the spot in Google Maps and copy the numbers). Online events need no venue.

Events you add can be removed from the main page with the Remove button. "Remove sample events" on the add page clears the placeholders. Everything is saved in `events.json`, which you can also edit by hand.

## What it calls

- `GET /api/events?month=YYYY-MM` returns the month's upcoming events in four week groups.
- `POST /api/events` adds an event; `DELETE /api/events/<id>` removes one you added.
- `GET /api/geocode?postal=560123` looks up a postal code (Nominatim, cached, 1 request/second).
- `GET /api/route?from=560123&event=<id>&depart=<ISO time>` returns up to 3 bus and MRT options (Transitous, cached, capped at 600 requests/day).

## Where events come from

Events come only from `events.json`, which you fill in by hand. Sources checked and not used: Eventbrite (no public search, scraping forbidden), Luma (its terms allow access only through supported interfaces), and Ticketmaster (you chose not to use it). Event sources live in `sources.js`, so another legitimate feed can be added there later.
