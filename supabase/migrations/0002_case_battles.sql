-- Case battles. Run after 0001_skinrush.sql. Safe to re-run.
-- 2–4 seats open the same cases round by round; the highest team total takes every drop (crazy mode: lowest).
-- Same rules as js/battles.js (SR.battleOutcome), which players can use to verify a finished battle:
--   drop(round r 1-based, seat s 0-based) = case pick of hmac_sha256(key = battle seed, msg = '<id>:<r>:<s>')
--   tie between teams: tied teams ascending, index floor(hmac(seed, '<id>:tie') × count)
--   winners share the pot: drops dealt most-expensive first (then round, seat) to the winner with the smallest haul.

/* ============================== tables ============================== */

create table if not exists public.battles (
  id           uuid primary key default gen_random_uuid(),
  creator      uuid not null references auth.users (id) on delete cascade,
  creator_name text not null,
  mode         text not null check (mode in ('1v1', '1v1v1', '1v1v1v1', '2v2')),
  crazy        boolean not null default false,
  cases        text[] not null check (cardinality(cases) between 1 and 25),
  seats        int not null,
  cost         numeric(14,2) not null check (cost > 0),
  status       text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  server_hash  text not null,
  server_seed  text,                 -- copied here (public) only when the battle finishes
  winner_team  int,
  created_at   timestamptz not null default now(),
  started_at   timestamptz
);
create index if not exists battles_status_idx on public.battles (status, created_at desc);

create table if not exists public.battle_secrets (
  battle_id   uuid primary key references public.battles (id) on delete cascade,
  server_seed text not null
);

create table if not exists public.battle_seats (
  battle_id uuid not null references public.battles (id) on delete cascade,
  seat      int  not null,
  user_id   uuid references auth.users (id) on delete set null,
  name      text not null,
  bot       boolean not null default false,
  primary key (battle_id, seat)
);
create unique index if not exists battle_seats_one_per_user on public.battle_seats (battle_id, user_id) where user_id is not null;

create table if not exists public.battle_drops (
  battle_id uuid not null references public.battles (id) on delete cascade,
  round     int  not null,
  seat      int  not null,
  item_id   text not null references public.items (id),
  price     numeric(12,2) not null,
  won_by    int,
  primary key (battle_id, round, seat)
);

alter table public.battles        enable row level security;
alter table public.battle_secrets enable row level security;   -- no policies: seeds stay secret until revealed
alter table public.battle_seats   enable row level security;
alter table public.battle_drops   enable row level security;
drop policy if exists "battles are public" on public.battles;
create policy "battles are public" on public.battles for select using (true);
drop policy if exists "battle seats are public" on public.battle_seats;
create policy "battle seats are public" on public.battle_seats for select using (true);
drop policy if exists "battle drops are public" on public.battle_drops;
create policy "battle drops are public" on public.battle_drops for select using (true);

/* ============================== helpers ============================== */

create or replace function public._battle_roll(p_seed text, p_msg text) returns double precision
language sql immutable set search_path = public, extensions as $$
  select ('x' || lpad(substr(encode(hmac(p_msg, p_seed, 'sha256'), 'hex'), 1, 13), 16, '0'))::bit(64)::bigint / 4503599627370496.0
$$;

create or replace function public._battle_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'creator', b.creator, 'creatorName', b.creator_name, 'mode', b.mode, 'crazy', b.crazy,
    'cases', to_jsonb(b.cases), 'seats', b.seats, 'cost', b.cost, 'status', b.status,
    'serverHash', b.server_hash, 'seed', b.server_seed, 'winnerTeam', b.winner_team,
    'createdAt', (extract(epoch from b.created_at) * 1000)::bigint,
    'startedAt', (extract(epoch from b.started_at) * 1000)::bigint,
    'players', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'userId', s.user_id, 'name', s.name, 'bot', s.bot) order by s.seat)
                         from battle_seats s where s.battle_id = b.id), '[]'::jsonb),
    'drops', coalesce((select jsonb_agg(jsonb_build_object('round', d.round, 'seat', d.seat, 'id', d.item_id, 'price', d.price, 'wonBy', d.won_by) order by d.round, d.seat)
                       from battle_drops d where d.battle_id = b.id), '[]'::jsonb))
  from battles b where b.id = p_id
$$;

-- Rolls every round, picks the winner and pays out. Called once, when the last seat fills.
create or replace function public._run_battle(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.battles; v_seed text; v_team int; winners int[]; haul numeric[]; k int; d record; w record; v_uid uuid;
begin
  select * into b from battles where id = p_id for update;
  if b.status <> 'open' then return; end if;
  select server_seed into v_seed from battle_secrets where battle_id = p_id;

  insert into battle_drops (battle_id, round, seat, item_id, price)
  select p_id, r.ord, s.seat, x.item_id, i.price
  from unnest(b.cases) with ordinality as r(case_id, ord)
  cross join generate_series(0, b.seats - 1) as s(seat)
  cross join lateral (select _pick(r.case_id, _battle_roll(v_seed, p_id::text || ':' || r.ord || ':' || s.seat)) as item_id) x
  join items i on i.id = x.item_id;

  with t as (
    select case when b.mode = '2v2' then seat / 2 else seat end as team, sum(price) as total
    from battle_drops where battle_id = p_id group by 1
  ), best as (
    select case when b.crazy then min(total) else max(total) end as v from t
  ), tied as (
    select t.team, row_number() over (order by t.team) - 1 as idx, count(*) over () as cnt
    from t, best where t.total = best.v
  )
  select team into v_team from tied
  where idx = floor(_battle_roll(v_seed, p_id::text || ':tie') * cnt);

  select array_agg(g order by g) into winners
  from generate_series(0, b.seats - 1) g
  where (case when b.mode = '2v2' then g / 2 else g end) = v_team;
  haul := array_fill(0::numeric, array[cardinality(winners)]);

  for d in select round, seat, item_id, price from battle_drops where battle_id = p_id order by price desc, round, seat loop
    k := 1;
    for j in 2..cardinality(winners) loop
      if haul[j] < haul[k] then k := j; end if;
    end loop;
    haul[k] := haul[k] + d.price;
    update battle_drops set won_by = winners[k] where battle_id = p_id and round = d.round and seat = d.seat;
    select user_id into v_uid from battle_seats where battle_id = p_id and seat = winners[k] and not bot;
    if v_uid is not null then perform _add_item(v_uid, d.item_id, 'battle'); end if;
  end loop;

  for w in select seat, user_id from battle_seats where battle_id = p_id and not bot and user_id is not null loop
    perform _stat_add(w.user_id, 'battles', 1);
    if (case when b.mode = '2v2' then w.seat / 2 else w.seat end) = v_team then
      perform _stat_add(w.user_id, 'battlesWon', 1);
      select item_id into d from battle_drops where battle_id = p_id and won_by = w.seat order by price desc limit 1;
      if found then perform _drop(w.user_id, d.item_id, null, 'battle'); end if;
    end if;
  end loop;

  update battles set status = 'done', winner_team = v_team, server_seed = v_seed, started_at = now() where id = p_id;
end $$;

/* ============================== RPCs ============================== */

create or replace function public.list_battles() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_battle_json(x.id) order by x.ord, x.created_at desc), '[]'::jsonb)
  from (
    (select id, created_at, 0 as ord from battles where status = 'open' order by created_at desc limit 30)
    union all
    (select id, created_at, 1 as ord from battles where status = 'done' order by started_at desc limit 12)
  ) x
$$;

create or replace function public.get_battle(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select _battle_json(p_id)
$$;

create or replace function public.create_battle(p_cases text[], p_mode text, p_crazy boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); p public.profiles; n int; v_cost numeric; v_id uuid := gen_random_uuid(); s text := encode(gen_random_bytes(32), 'hex');
begin
  p := _profile(u);
  if p_mode is null or p_mode not in ('1v1', '1v1v1', '1v1v1v1', '2v2')
     or p_cases is null or cardinality(p_cases) < 1 or cardinality(p_cases) > 25 then
    raise exception 'bad_request';
  end if;
  select count(*), sum(c.price) into n, v_cost from unnest(p_cases) x(id) join cases c on c.id = x.id;
  if n <> cardinality(p_cases) then raise exception 'bad_request'; end if;
  v_cost := round(v_cost, 2);
  if p.balance < v_cost then raise exception 'insufficient_funds'; end if;
  update profiles set balance = balance - v_cost where user_id = u;
  insert into battles (id, creator, creator_name, mode, crazy, cases, seats, cost, server_hash)
  values (v_id, u, p.username, p_mode, coalesce(p_crazy, false), p_cases,
          case p_mode when '1v1' then 2 when '1v1v1' then 3 else 4 end, v_cost, encode(digest(s, 'sha256'), 'hex'));
  insert into battle_secrets (battle_id, server_seed) values (v_id, s);
  insert into battle_seats (battle_id, seat, user_id, name) values (v_id, 0, u, p.username);
  return jsonb_build_object('battle', _battle_json(v_id), 'state', _state(u));
end $$;

create or replace function public.join_battle(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); p public.profiles; b public.battles; v_seat int;
begin
  p := _profile(u);
  select * into b from battles where id = p_id for update;
  if not found or b.status <> 'open' then raise exception 'battle_closed'; end if;
  if exists (select 1 from battle_seats where battle_id = p_id and user_id = u) then raise exception 'already_joined'; end if;
  select min(g) into v_seat from generate_series(0, b.seats - 1) g
  where not exists (select 1 from battle_seats s where s.battle_id = p_id and s.seat = g);
  if v_seat is null then raise exception 'battle_closed'; end if;
  if p.balance < b.cost then raise exception 'insufficient_funds'; end if;
  update profiles set balance = balance - b.cost where user_id = u;
  insert into battle_seats (battle_id, seat, user_id, name) values (p_id, v_seat, u, p.username);
  if (select count(*) from battle_seats where battle_id = p_id) = b.seats then perform _run_battle(p_id); end if;
  return jsonb_build_object('battle', _battle_json(p_id), 'state', _state(u));
end $$;

create or replace function public.call_bots(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); b public.battles;
begin
  perform _profile(u);
  select * into b from battles where id = p_id for update;
  if not found or b.status <> 'open' then raise exception 'battle_closed'; end if;
  if b.creator <> u then raise exception 'bad_request'; end if;
  insert into battle_seats (battle_id, seat, user_id, name, bot)
  select p_id, g, null, (array['Bot Ace', 'Bot Blitz', 'Bot Clutch', 'Bot Dust'])[g + 1], true
  from generate_series(0, b.seats - 1) g
  where not exists (select 1 from battle_seats s where s.battle_id = p_id and s.seat = g);
  perform _run_battle(p_id);
  return jsonb_build_object('battle', _battle_json(p_id), 'state', _state(u));
end $$;

create or replace function public.cancel_battle(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); b public.battles;
begin
  perform _profile(u);
  select * into b from battles where id = p_id for update;
  if not found or b.status <> 'open' then raise exception 'battle_closed'; end if;
  if b.creator <> u then raise exception 'bad_request'; end if;
  update profiles pr set balance = pr.balance + b.cost
  from battle_seats s where s.battle_id = p_id and not s.bot and s.user_id = pr.user_id;
  update battles set status = 'cancelled' where id = p_id;
  return jsonb_build_object('battle', _battle_json(p_id), 'state', _state(u));
end $$;

/* ============================== permissions ============================== */

revoke all on function public._battle_roll(text, text), public._battle_json(uuid), public._run_battle(uuid)
  from public, anon, authenticated;
revoke all on function public.list_battles(), public.get_battle(uuid), public.create_battle(text[], text, boolean),
  public.join_battle(uuid), public.call_bots(uuid), public.cancel_battle(uuid)
  from public, anon;
grant execute on function public.list_battles(), public.get_battle(uuid), public.create_battle(text[], text, boolean),
  public.join_battle(uuid), public.call_bots(uuid), public.cancel_battle(uuid)
  to authenticated;

/* live lobby and battle rooms over Realtime */
do $$ begin
  alter publication supabase_realtime add table public.battles;
exception when duplicate_object or undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.battle_seats;
exception when duplicate_object or undefined_object then null;
end $$;
