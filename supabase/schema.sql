-- Card World database setup
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Every table has a user_id column. Row Level Security (RLS) makes sure a
-- signed-in user can only read and change their own rows, even though the
-- app's public key is visible in the website code.

-- Lots: a group of cards bought for one price
create table if not exists public.lots (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  date        date not null,
  total_paid  numeric(12,2) not null default 0,
  total_comp  numeric(12,2) not null default 0,
  buy_pct     numeric(6,2)  not null default 0,
  card_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Shows: card shows with a table cost
create table if not exists public.shows (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  date        date not null,
  table_cost  numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Cards: every card bought, its cost, grading, and sale
create table if not exists public.cards (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null,
  category     text not null default 'sports' check (category in ('sports','pokemon')),
  type         text not null default 'raw' check (type in ('raw','slab')),
  grade        text not null default '',
  status       text not null default 'inventory' check (status in ('inventory','grading','sold')),
  buy_date     date,
  buy_price    numeric(12,2) not null default 0,  -- what you paid (or this card's share of a lot)
  buy_market   numeric(12,2) not null default 0,  -- comp value when you bought it
  market_value numeric(12,2) not null default 0,  -- current comp value
  grading_fee  numeric(12,2) not null default 0,
  sold_date    date,
  sold_price   numeric(12,2) not null default 0,
  show_id      uuid references public.shows(id) on delete set null,
  lot_id       uuid references public.lots(id) on delete set null,
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Other business expenses (supplies, shipping, fees)
create table if not exists public.expenses (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label       text not null,
  amount      numeric(12,2) not null default 0,
  date        date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Money you paid yourself
create table if not exists public.payouts (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount      numeric(12,2) not null default 0,
  date        date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- How profit is split (one row per user)
create table if not exists public.settings (
  id          uuid primary key,
  user_id     uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  reinvest    integer not null default 70,
  taxes       integer not null default 20,
  pay         integer not null default 10,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Keep updated_at current on every change
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Lock every table to its owner
do $$
declare t text;
begin
  foreach t in array array['lots','shows','cards','expenses','payouts','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner only" on public.%I', t);
    execute format(
      'create policy "owner only" on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop trigger if exists touch on public.%I', t);
    execute format(
      'create trigger touch before update on public.%I
         for each row execute function public.touch_updated_at()', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_idx', t);
  end loop;
end $$;

-- Live updates between devices (Supabase Realtime)
alter publication supabase_realtime add table
  public.cards, public.lots, public.shows, public.expenses, public.payouts, public.settings;
