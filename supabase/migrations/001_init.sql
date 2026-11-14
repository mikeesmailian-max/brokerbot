-- Freight Command — history database
-- Run this once in Supabase: SQL Editor → paste → Run.

create extension if not exists pgcrypto;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  do_not_call boolean not null default false,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mc_number text,
  dot_number text,
  contact_name text,
  phone text,
  email text,
  equipment_types text[] not null default '{}',
  home_city text,
  home_state text,
  preferred_lanes text,
  notes text,
  do_not_call boolean not null default false,
  loads_hauled integer not null default 0,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists loads (
  id uuid primary key default gen_random_uuid(),
  ref text not null,
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  origin_city text,
  origin_state text,
  dest_city text,
  dest_state text,
  pickup_date date,
  pickup_time text,
  delivery_date date,
  delivery_time text,
  equipment text,
  commodity text,
  weight_lbs integer,
  miles integer,
  special_instructions text,
  customer_rate integer,          -- what the customer pays us
  target_rate integer,            -- opening (lowest) offer to carriers
  max_rate integer,               -- the most we will pay a carrier
  negotiation_style text not null default 'balanced' check (negotiation_style in ('fast','balanced','firm')),
  status text not null default 'draft' check (status in ('draft','open','searching','covered','delivered','cancelled')),
  source text not null default 'manual' check (source in ('upload','manual','customer_call','history')),
  covered_by_carrier_id uuid references carriers(id) on delete set null,
  covered_by_name text,
  covered_rate integer,
  covered_via text check (covered_via in ('call','email','manual')),
  covered_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('capacity','customer')),
  load_id uuid references loads(id) on delete cascade,
  status text not null default 'running' check (status in ('running','completed','stopped')),
  concurrency integer not null default 5,
  also_email boolean not null default false,
  mode text not null default 'call_only' check (mode in ('email_first','email_only','call_only','both')),
  calls_start_at timestamptz,          -- email_first: when the phone follow-up begins
  calls_started boolean not null default true,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- One row per outreach attempt: a phone call or an email.
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  type text not null check (type in ('capacity','customer')),
  channel text not null default 'call' check (channel in ('call','email')),
  load_id uuid references loads(id) on delete cascade,
  carrier_id uuid references carriers(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  company_name text not null,
  contact_name text,
  phone text,
  email text,
  status text not null default 'queued' check (status in ('queued','dialing','ringing','in_progress','sent','ended')),
  outcome text,
  stage text,
  last_ask integer,
  last_offer integer,
  rounds integer not null default 0,
  agreed_rate integer,
  mc_number text,
  bid_token text unique,
  conversation_id text,
  call_sid text,
  transcript jsonb,
  summary text,
  duration_secs integer,
  position integer not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- Every round of every negotiation, kept forever. This becomes your own rate intelligence.
create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  load_id uuid not null references loads(id) on delete cascade,
  carrier_id uuid references carriers(id) on delete set null,
  carrier_ask integer not null,
  our_offer integer,
  decision text not null check (decision in ('accepted','counter','final','covered')),
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  level text not null default 'info',
  message text not null,
  load_id uuid,
  call_id uuid,
  campaign_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  purpose text not null,
  load_id uuid references loads(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  extracted jsonb,
  created_at timestamptz not null default now()
);

create index if not exists loads_status_idx on loads (status, created_at desc);
create index if not exists loads_customer_idx on loads (customer_id);
create index if not exists calls_campaign_idx on calls (campaign_id, status, position);
create index if not exists calls_load_idx on calls (load_id);
create index if not exists calls_created_idx on calls (created_at desc);
create index if not exists calls_conversation_idx on calls (conversation_id);
create index if not exists calls_customer_idx on calls (customer_id);
create index if not exists offers_call_idx on offers (call_id, created_at);
create index if not exists events_created_idx on events (created_at desc);
create index if not exists campaigns_status_idx on campaigns (status);

-- ── First come, first served ────────────────────────────────────────────────
-- Only one caller can ever flip a load to "covered". Everyone who arrives a
-- millisecond later gets zero rows back and is told the load is gone.
create or replace function book_load(
  p_load_id uuid, p_carrier_id uuid, p_carrier_name text, p_rate integer, p_via text
) returns setof loads
language sql
set search_path = public
as $$
  update loads
     set status = 'covered',
         covered_by_carrier_id = p_carrier_id,
         covered_by_name = p_carrier_name,
         covered_rate = p_rate,
         covered_via = p_via,
         covered_at = now()
   where id = p_load_id
     and status in ('open', 'searching')
  returning *;
$$;

-- Hand out the next carriers to dial without ever exceeding the campaign's
-- line limit, even if two requests ask at the same instant.
create or replace function claim_queued_calls(p_campaign_id uuid, p_n integer)
returns setof calls
language plpgsql
set search_path = public
as $$
declare
  v_limit integer;
  v_active integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_campaign_id::text));
  select concurrency into v_limit from campaigns where id = p_campaign_id and status = 'running';
  if v_limit is null then return; end if;
  select count(*) into v_active from calls
   where campaign_id = p_campaign_id and channel = 'call' and status in ('dialing','ringing','in_progress');
  return query
    update calls c
       set status = 'dialing', started_at = now(), stage = 'Dialing…'
     where c.id in (
       select q.id from calls q
        where q.campaign_id = p_campaign_id and q.status = 'queued' and q.channel = 'call'
        order by q.position
        limit greatest(least(p_n, v_limit - v_active), 0)
        for update skip locked)
    returning c.*;
end;
$$;

-- ── Lock it down ────────────────────────────────────────────────────────────
-- The app talks to the database only from the server with the service-role key.
-- Row level security with no policies means the public (anon) key can read nothing.
alter table customers enable row level security;
alter table carriers  enable row level security;
alter table loads     enable row level security;
alter table campaigns enable row level security;
alter table calls     enable row level security;
alter table offers    enable row level security;
alter table events    enable row level security;
alter table documents enable row level security;
revoke execute on function book_load(uuid, uuid, text, integer, text) from public, anon, authenticated;
revoke execute on function claim_queued_calls(uuid, integer) from public, anon, authenticated;

-- ── Handy reports (open them in Supabase → Table Editor) ────────────────────
create or replace view lane_rates with (security_invoker = true) as
select origin_state, dest_state, equipment,
       count(*) as loads,
       round(avg(customer_rate)) as avg_customer_rate,
       round(avg(covered_rate)) as avg_carrier_rate,
       round(avg(customer_rate - covered_rate)) as avg_margin,
       max(coalesce(pickup_date, created_at::date)) as last_moved
  from loads
 where status in ('covered','delivered') and covered_rate is not null
 group by origin_state, dest_state, equipment;

create or replace view carrier_scorecard with (security_invoker = true) as
select c.id, c.name, c.mc_number,
       count(k.id) filter (where k.channel = 'call') as calls,
       count(k.id) filter (where k.outcome = 'booked') as booked,
       count(k.id) filter (where k.outcome in ('no_answer','voicemail')) as missed,
       round(avg(k.last_ask)) as avg_first_ask,
       round(avg(k.agreed_rate)) as avg_agreed
  from carriers c left join calls k on k.carrier_id = c.id
 group by c.id, c.name, c.mc_number;
