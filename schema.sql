create table spots (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  type text not null,
  address text,
  lat float not null,
  lng float not null,
  avg_download float,
  avg_upload float,
  avg_ping float,
  tags text[],
  created_at timestamp default now(),
  last_tested_at timestamp
);

-- Ookla open-data speed tiles (zoom-16 quadkeys)
create table speed_tiles (
  quadkey text primary key,
  avg_d_kbps float not null,
  avg_u_kbps float not null,
  avg_lat_ms float not null,
  tests int not null,
  devices int not null
);

alter table speed_tiles enable row level security;
create policy "Public read tiles" on speed_tiles for select using (true);
create policy "Public insert tiles" on speed_tiles for insert with check (true);

-- Enable Row Level Security
alter table spots enable row level security;

-- Allow public read
create policy "Public read" on spots for select using (true);

-- Allow public insert
create policy "Public insert" on spots for insert with check (true);

-- Allow public update
create policy "Public update" on spots for update using (true);
