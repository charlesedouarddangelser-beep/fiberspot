# Fiberspot

A community-driven map of Wi-Fi spots — find a fast connection near you, contribute the ones you know, test them on the spot.

> **Status:** Early MVP. Working but rough around the edges. Production hardening in progress (auth, moderation, server-side validation).

![Made with React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite)

## What it does

- **Map of Wi-Fi spots** — cafés, libraries, coworkings, hotels — with their measured download/upload/ping.
- **OpenStreetMap layer** — places that *could* be spots but haven't been added yet, so the map isn't empty in your area.
- **Run a speed test on the spot** — geo-gated (you have to actually be there, within 200m).
- **Ookla area estimate** — for spots no one has tested yet, show a rough estimate from open Ookla data.
- **Search any address** — and either land on an existing spot or be prompted to add it.

## Stack

- **Frontend** — React 19 + TypeScript + Vite
- **Map** — Mapbox GL JS
- **Backend** — Supabase (Postgres + Auth + Storage)
- **POI data** — OpenStreetMap via the Overpass API
- **Speed measurement** — Cloudflare's public speed test endpoints

## Getting started

### Prerequisites

- Node 20+ and npm
- A Mapbox account (free tier works)
- A Supabase project (free tier works)

### Install

```bash
git clone https://github.com/<your-username>/fiberspot.git
cd fiberspot
npm install
```

### Configure environment

```bash
cp .env.example .env
```

Then fill in `.env` with your own keys:

| Variable | Where to get it |
|---|---|
| `VITE_MAPBOX_TOKEN` | [Mapbox tokens](https://account.mapbox.com/access-tokens/) — restrict it to your domain once deployed |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `VITE_BTC_ADDRESS` | Optional. Leave empty to hide the Donate button. |

### Database schema

You need two tables in Supabase. Minimal schema:

```sql
-- Spots: user-contributed Wi-Fi locations
create table spots (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text not null,
  address       text,
  lat           double precision not null,
  lng           double precision not null,
  avg_download  numeric,
  avg_upload    numeric,
  avg_ping      numeric,
  tags          text[],
  created_at    timestamptz default now(),
  last_tested_at timestamptz
);

-- Speed tiles: pre-loaded Ookla area estimates by quadkey (zoom 16)
create table speed_tiles (
  quadkey      text primary key,
  avg_d_kbps   integer,
  avg_u_kbps   integer,
  avg_lat_ms   integer
);
```

> Row-Level Security policies are coming in the next iteration. For now the table is open — fine for local dev, **not** for production.

### Run

```bash
npm run dev
```

Open http://localhost:5173. Allow geolocation when prompted.

### Build

```bash
npm run build
npm run preview   # serves the production build locally
```

## Project structure

```
src/
├── components/        UI components (Map, Sidebar, SpotDetail, etc.)
├── hooks/             Custom hooks (Overpass POI fetching with debounce + abort)
├── lib/               Pure utilities (geo, quadkey, speedtest, supabase, overpass)
├── types/             TypeScript types (Spot, OsmPoi)
├── App.tsx            Root component, top-level state
└── main.tsx           Entry point
```

## Roadmap

- [x] MVP map + add/test spots
- [x] OpenStreetMap POI suggestions
- [x] Ookla area estimates
- [ ] Auth (magic link)
- [ ] Row-Level Security + server-side speed test validation
- [ ] Spot edit / delete by author
- [ ] Reporting & moderation
- [ ] Photos, comments, ratings
- [ ] i18n (FR + EN)
- [ ] PWA / offline support
- [ ] Deep links (`/spot/:id`)

## Contributing

The project is small and pre-1.0 — issues, PRs, and feedback are welcome. Open an issue first for anything non-trivial so we can talk it through.

## License

TBD.
