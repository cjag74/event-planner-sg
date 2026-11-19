# Event Planner (Singapore) - Scope

Agreed after a grill-me interview. Date: 2026-11-19.

## Who it's for
Anyone in Singapore who gets around by public transport and wants to plan which events to attend in a month. The course assessor is a second audience.

## Why it needs to exist
Eventbrite lists events and Google Maps gives directions, but neither shows the month by week alongside how hard each event is to reach from home. This app shows this month's events in four week groups, each with a door-to-door bus and MRT route from the user's postal code.

## What we're building
- **Weeks:** days 1-7, 8-14, 15-21, and 22 to month end. A month picker defaults to the current month. Finished events are hidden.
- **Events:** a hand-picked `events.json` that you maintain through an Add event page (venue located from its name, then postal code, with an optional exact-coordinates override). No live event feed is used: Eventbrite (no public search, scraping forbidden), Luma (terms allow only supported interfaces) and Ticketmaster (not wanted) were ruled out. Each event has title, start and end time, venue, location (coordinates or postal code), price, event URL and image. Online events carry a flag and get no directions button. `sources.js` lets another feed be added later.
- **Postal code:** Nominatim (OpenStreetMap, free, no account) turns it into coordinates. It returns the postcode-area centre, not the exact building, so event venues get fixed coordinates in `events.json` instead. The code is remembered in the browser.
- **Directions:** Transitous (free, no key) gives the full bus and MRT journey, travel time and line names, assuming departure 1 hour before the event starts, with a box to change the departure time. (Changed from OneMap, then Google, on 2026-11-19 so no account, key or card is needed.) On failure the app shows a clear message and an "Open in Google Maps" link.
- **Sorting and filtering:** date and time by default, with a "closest first" option and a free-only toggle.
- **Live extras:** ArriveLah shows live bus arrivals for events happening today. data.gov.sg adds a "rain expected" warning (nice-to-have).
- **Saved plan:** starred events go into "My plan" in the browser's local storage. No login.
- **Stack:** Node and Express for a small backend that proxies the free APIs, caches results and sends the required User-Agent, plus a plain HTML/CSS/JS front end. Runs on the developer's computer first. If a live fetch fails, the demo falls back to saved events with a banner.

**Must-haves:** the four week groups with real events; directions from a postal code.
**Nice-to-haves, in order:** saved plan, phone-sized layout, live arrivals, weather.

## Build order
1. **Routing spike (done):** `spike/free-route.mjs` turns two postal codes into bus and MRT routes. 
2. Event list and week groups.
3. Directions panel.
4. Saved plan.
5. Live arrivals and weather.

## Changes from the original request
- Events do not come from scraping the Eventbrite page. That page loads its events with JavaScript, and Eventbrite's terms prohibit automated scraping.
- ArriveLah and data.gov.sg cannot plan journeys. Transitous does the routing; the two named APIs add live arrivals and weather.

## Data source facts (checked 2026-11-19)
- **Eventbrite:** no public search API (shut down Dec 2019). The official API reads events only by known ID, venue or organisation, and no source confirmed that a free personal token can read other organisers' events.
- **Transitous (routing):** `GET api.transitous.org/api/v5/plan`. Verified 2026-11-19: returned real MRT and bus journeys for Singapore with no key. Terms: open-source, non-commercial use only; every request needs an identifying User-Agent (app name, version, contact); best-effort volunteer service; about 720 plan requests a day is the soft limit, so cache results; credit Transitous and OpenStreetMap. MRT timetable data in the feed may be approximate, so treat MRT times as estimates.
- **ArriveLah:** `https://arrivelah2.busrouter.sg/?id=<5-digit stop code>`, CORS open, 15-second cache. Stop data at `https://data.busrouter.sg/v1/stops.min.json` (longitude first). It is a personal project with no published rate limits or terms.
- **data.gov.sg:** real-time APIs cover weather, PSI, taxis, carparks and traffic images. No routing. The v2 API allows 6 calls per 10 seconds without a key; a free key raises this.

## Still to find out
- Whether Transitous times match reality for real trips, especially MRT, and whether it stays available.
- Nominatim policy: 1 request a second maximum, custom User-Agent, cache results.
- ArriveLah terms and limits.
- The course brief: if it requires a specific stack or deployment, parts of this change.
- Picking and copying in about 5-8 real events per week for `events.json`.
