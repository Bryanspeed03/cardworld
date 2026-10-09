-- Turn on live updates between devices.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- This adds the app's tables to Supabase Realtime, which pushes every change
-- to your other open devices. Row Level Security still decides who sees what.
alter publication supabase_realtime add table
  public.cards, public.lots, public.shows, public.expenses, public.payouts, public.settings;
