-- AquaSense schema. Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again: it only adds what is missing.
-- All tables are private (RLS on, no policies). Only the backend (service key) reads or writes them.

create table if not exists public.devices (
  device_id        text primary key,
  key_hash         text not null,
  name             text not null default 'My tank',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  last_seen        timestamptz,
  last_stored_at   timestamptz,
  last_level_pct   real,
  last_distance_cm real,
  last_water_cm    real,
  last_volume_ml   real,
  last_pump_on     boolean,
  last_locked      boolean
);
alter table public.devices add column if not exists last_sensor_ok boolean;

create table if not exists public.device_members (
  device_id  text not null references public.devices(device_id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_id, user_id)
);
alter table public.device_members add column if not exists role text not null default 'member';
update public.device_members as m set role = 'owner'
  from public.devices as d
  where d.device_id = m.device_id and d.created_by = m.user_id;

create table if not exists public.device_settings (
  device_id        text primary key references public.devices(device_id) on delete cascade,
  capacity_litres  real not null default 600 check (capacity_litres > 0 and capacity_litres <= 100000),
  low_alert_pct    real not null default 20  check (low_alert_pct >= 0 and low_alert_pct <= 100),
  offline_after_s  integer not null default 120 check (offline_after_s between 30 and 86400)
);
alter table public.device_settings add column if not exists start_pct real not null default 25;
alter table public.device_settings add column if not exists stop_pct  real not null default 100;

create table if not exists public.readings (
  id           bigint generated always as identity primary key,
  device_id    text not null references public.devices(device_id) on delete cascade,
  created_at   timestamptz not null default now(),
  distance_cm  real,
  water_cm     real,
  volume_ml    real,
  level_pct    real not null,
  pump_on      boolean not null default false,
  locked       boolean not null default false
);
create index if not exists readings_device_time_idx on public.readings (device_id, created_at desc);

create table if not exists public.events (
  id          bigint generated always as identity primary key,
  device_id   text not null references public.devices(device_id) on delete cascade,
  created_at  timestamptz not null default now(),
  kind        text not null,
  detail      text,
  level_pct   real
);
create index if not exists events_device_time_idx on public.events (device_id, created_at desc);

create table if not exists public.device_invites (
  code_hash   text primary key,
  device_id   text not null references public.devices(device_id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_by     uuid references auth.users(id) on delete set null,
  used_at     timestamptz
);

create table if not exists public.commands (
  id            bigint generated always as identity primary key,
  device_id     text not null references public.devices(device_id) on delete cascade,
  action        text not null check (action in ('pump_on', 'pump_off')),
  status        text not null default 'pending' check (status in ('pending', 'sent', 'done', 'failed', 'expired')),
  requested_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  finished_at   timestamptz,
  note          text
);
create index if not exists commands_device_time_idx on public.commands (device_id, created_at desc);

alter table public.devices         enable row level security;
alter table public.device_members  enable row level security;
alter table public.device_settings enable row level security;
alter table public.readings        enable row level security;
alter table public.events          enable row level security;
alter table public.device_invites  enable row level security;
alter table public.commands        enable row level security;
