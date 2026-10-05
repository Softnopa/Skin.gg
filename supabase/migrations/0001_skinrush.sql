-- SkinRush on Supabase: catalog, wallets, inventory, provably-fair seeds, live drops, and the game RPCs.
-- Every money-moving rule runs here (security definer functions). Players can read their own rows and call RPCs;
-- they cannot write any table directly. Mirrors js/game.js (local mode) — change both together.
--
-- Roll: hmac_sha256(key = server_seed, msg = client_seed || ':' || nonce), first 13 hex chars / 2^52  ->  [0, 1)

create extension if not exists pgcrypto with schema extensions;

/* ============================== tables ============================== */

create table if not exists public.items (
  id      text primary key,
  weapon  text not null,
  finish  text not null,
  wear    text not null default '',
  type    text not null,
  tier    text not null,
  price   numeric(12,2) not null check (price > 0),
  color   text,
  sheet   int  not null,
  cell    int  not null,
  base    text,                          -- the skin's main item id (every wear is its own item)
  main    boolean not null default true  -- the item that stands for the skin
);
create index if not exists items_price_idx on public.items (price);
alter table public.items add column if not exists base text;
alter table public.items add column if not exists main boolean not null default true;

create table if not exists public.cases (
  id    text primary key,
  name  text not null,
  grp   text not null,
  glow  text not null,
  price numeric(12,2) not null check (price > 0),
  sort  int  not null default 0
);

create table if not exists public.case_items (
  case_id text not null references public.cases (id) on delete cascade,
  ord     int  not null,
  item_id text not null references public.items (id),
  chance  double precision not null check (chance > 0),
  primary key (case_id, ord)
);

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  balance      numeric(14,2) not null default 2000 check (balance >= 0),
  stats        jsonb not null default '{}'::jsonb,
  quiz_next_at timestamptz not null default now() + interval '15 minutes',
  quiz_tries   int not null default 3,
  quiz_q       jsonb,
  tag          text not null,                      -- public name shown in live drops (= username)
  username     text not null unique,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Usernames that become admins when their account is created. Register these names yourself first.
-- (Grant later with: update public.profiles set is_admin = true where username = '<name>';)
create table if not exists public.admins (username text primary key);
insert into public.admins (username) values ('aziz') on conflict do nothing;

create table if not exists public.admin_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid not null references auth.users (id) on delete cascade,
  target_id  uuid not null references auth.users (id) on delete cascade,
  amount     numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory (
  uid        uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  item_id    text not null references public.items (id),
  src        text not null default '',
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists inventory_user_idx on public.inventory (user_id, created_at desc);

create table if not exists public.seeds (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  server_seed text not null,
  server_hash text not null,
  client_seed text not null,
  nonce       int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  revealed_at timestamptz
);
create unique index if not exists seeds_one_active on public.seeds (user_id) where active;

create table if not exists public.drops (
  id         bigint generated always as identity primary key,
  item_id    text not null references public.items (id),
  case_id    text references public.cases (id) on delete set null,
  kind       text not null,
  player     text not null,
  created_at timestamptz not null default now()
);

/* ============================== row level security ============================== */

alter table public.items      enable row level security;
alter table public.cases      enable row level security;
alter table public.case_items enable row level security;
alter table public.profiles   enable row level security;
alter table public.inventory  enable row level security;
alter table public.seeds      enable row level security;   -- no policies: server seeds stay secret
alter table public.drops      enable row level security;
alter table public.admins     enable row level security;   -- no policies: server only
alter table public.admin_log  enable row level security;   -- no policies: server only

drop policy if exists "catalog is public" on public.items;
create policy "catalog is public" on public.items for select using (true);
drop policy if exists "cases are public" on public.cases;
create policy "cases are public" on public.cases for select using (true);
drop policy if exists "case odds are public" on public.case_items;
create policy "case odds are public" on public.case_items for select using (true);
drop policy if exists "drops are public" on public.drops;
create policy "drops are public" on public.drops for select using (true);
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (user_id = auth.uid());
drop policy if exists "own inventory" on public.inventory;
create policy "own inventory" on public.inventory for select using (user_id = auth.uid());

/* ============================== internal helpers ============================== */

create or replace function public._uid() returns uuid
language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return u;
end $$;

create or replace function public._new_seed(u uuid, p_client text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text := encode(gen_random_bytes(32), 'hex');
begin
  insert into seeds (user_id, server_seed, server_hash, client_seed)
  values (u, s, encode(digest(s, 'sha256'), 'hex'), coalesce(nullif(p_client, ''), encode(gen_random_bytes(8), 'hex')));
end $$;

-- Returns the caller's profile row, locked for this transaction; creates it ($2,000 + a seed) on first use.
create or replace function public._profile(u uuid) returns public.profiles
language plpgsql security definer set search_path = public, extensions as $$
declare p public.profiles; v_email text; v_name text;
begin
  select * into p from profiles where user_id = u for update;
  if not found then
    -- The site signs people up as <username>@skinrush.local; anything else gets a generated name.
    select lower(email) into v_email from auth.users where id = u;
    if v_email like '%@skinrush.local' and split_part(v_email, '@', 1) ~ '^[a-z0-9_]{3,20}$' then
      v_name := split_part(v_email, '@', 1);
    else
      v_name := 'player_' || substr(md5(u::text), 1, 6);
    end if;
    insert into profiles (user_id, tag, username, is_admin)
    values (u, v_name, v_name, exists (select 1 from admins a where a.username = v_name))
    on conflict (user_id) do nothing
    returning * into p;
    if found then perform _new_seed(u, null); end if;
    select * into p from profiles where user_id = u for update;
  end if;
  return p;
end $$;

create or replace function public._roll(u uuid, out o_value double precision, out o_nonce int)
language plpgsql security definer set search_path = public, extensions as $$
declare s public.seeds; h text;
begin
  update seeds set nonce = seeds.nonce + 1 where seeds.user_id = u and seeds.active returning * into s;
  if not found then
    perform _new_seed(u, null);
    update seeds set nonce = seeds.nonce + 1 where seeds.user_id = u and seeds.active returning * into s;
  end if;
  h := encode(hmac(s.client_seed || ':' || s.nonce, s.server_seed, 'sha256'), 'hex');
  o_value := ('x' || lpad(substr(h, 1, 13), 16, '0'))::bit(64)::bigint / 4503599627370496.0;
  o_nonce := s.nonce;
end $$;

-- Weighted pick: first row (by ord) whose running chance total passes roll × total.
create or replace function public._pick(p_case text, r double precision) returns text
language sql stable security definer set search_path = public as $$
  with ci as (
    select item_id, ord,
           sum(chance) over (order by ord) as acc,
           sum(chance) over () as tot
    from case_items where case_id = p_case
  )
  select coalesce(
    (select item_id from ci where acc > r * tot order by ord limit 1),
    (select item_id from ci order by ord desc limit 1))
$$;

create or replace function public._stat_add(u uuid, k text, amount numeric) returns void
language sql security definer set search_path = public as $$
  update profiles
  set stats = jsonb_set(stats, array[k], to_jsonb(round(coalesce((stats ->> k)::numeric, 0) + amount, 2)))
  where user_id = u
$$;

-- Adds an item; past 1,500 items it is sold on the spot so the inventory stays bounded.
create or replace function public._add_item(u uuid, p_item text, p_src text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.inventory; v_price numeric;
begin
  select i.price into v_price from items i where i.id = p_item;
  if v_price is null then raise exception 'bad_request'; end if;
  update profiles pr set stats = jsonb_set(pr.stats, '{best}', to_jsonb(p_item))
  where pr.user_id = u
    and (pr.stats ->> 'best' is null
         or coalesce((select b.price from items b where b.id = pr.stats ->> 'best'), 0) < v_price);
  if (select count(*) from inventory iv where iv.user_id = u) >= 1500 then
    update profiles set balance = balance + v_price where user_id = u;
    return jsonb_build_object('uid', gen_random_uuid(), 'id', p_item, 'ts', (extract(epoch from now()) * 1000)::bigint, 'src', p_src, 'sold', true);
  end if;
  insert into inventory (user_id, item_id, src) values (u, p_item, p_src) returning * into e;
  return jsonb_build_object('uid', e.uid, 'id', e.item_id, 'ts', (extract(epoch from e.created_at) * 1000)::bigint, 'src', e.src);
end $$;

-- Removes the caller's items and returns their total value; fails (rolling everything back) if any isn't theirs.
create or replace function public._take(u uuid, p_uids uuid[]) returns numeric
language plpgsql security definer set search_path = public as $$
declare n int; total numeric;
begin
  if p_uids is null or cardinality(p_uids) = 0 then return 0; end if;
  if cardinality(p_uids) <> (select count(distinct x) from unnest(p_uids) x) then raise exception 'bad_request'; end if;
  with del as (
    delete from inventory iv where iv.user_id = u and iv.uid = any (p_uids) returning iv.item_id
  )
  select count(*), coalesce(sum(i.price), 0) into n, total from del join items i on i.id = del.item_id;
  if n <> cardinality(p_uids) then raise exception 'not_owned'; end if;
  return total;
end $$;

create or replace function public._drop(u uuid, p_item text, p_case text, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into drops (item_id, case_id, kind, player)
  select p_item, p_case, p_kind, pr.tag from profiles pr where pr.user_id = u;
  delete from drops where id <= (select max(id) - 300 from drops);
end $$;

create or replace function public._state(u uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles; s public.seeds;
begin
  select * into p from profiles where user_id = u;
  select * into s from seeds where user_id = u and active;
  return jsonb_build_object(
    'balance', p.balance,
    'stats', p.stats,
    'tag', p.tag,
    'username', p.username,
    'isAdmin', p.is_admin,
    'quiz', jsonb_build_object(
      'nextAt', (extract(epoch from p.quiz_next_at) * 1000)::bigint,
      'tries', p.quiz_tries,
      'q', case when p.quiz_q is null then null else p.quiz_q - 'id' end),
    'fair', jsonb_build_object(
      'serverHash', s.server_hash, 'client', s.client_seed, 'nonce', s.nonce,
      'revealed', coalesce((
        select jsonb_agg(jsonb_build_object('server', r.server_seed, 'serverHash', r.server_hash, 'client', r.client_seed, 'nonces', r.nonce) order by r.revealed_at desc)
        from (select * from seeds where user_id = u and not active order by revealed_at desc limit 5) r), '[]'::jsonb)),
    'inv', coalesce((
      select jsonb_agg(jsonb_build_object('uid', i.uid, 'id', i.item_id, 'ts', (extract(epoch from i.created_at) * 1000)::bigint, 'src', i.src)
                       order by i.created_at desc, i.uid)
      from inventory i where i.user_id = u), '[]'::jsonb)
  );
end $$;

/* ============================== game RPCs ============================== */

create or replace function public.get_state() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid();
begin
  perform _profile(u);
  return jsonb_build_object('state', _state(u));
end $$;

create or replace function public.open_case(p_case text, p_count int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u uuid := _uid(); p public.profiles; c public.cases; total numeric; r record;
  it text; e jsonb; res jsonb := '[]'::jsonb; won numeric := 0;
begin
  p := _profile(u);
  select * into c from cases where id = p_case;
  if not found or p_count is null or p_count < 1 or p_count > 5 then raise exception 'bad_request'; end if;
  total := round(c.price * p_count, 2);
  if p.balance < total then raise exception 'insufficient_funds'; end if;
  update profiles set balance = balance - total where user_id = u;
  for i in 1..p_count loop
    select * into r from _roll(u);
    it := _pick(c.id, r.o_value);
    e := _add_item(u, it, 'case:' || c.id);
    res := res || jsonb_build_array(e || jsonb_build_object('roll', r.o_value, 'nonce', r.o_nonce));
    won := won + (select price from items where id = it);
    perform _drop(u, it, c.id, 'case');
  end loop;
  perform _stat_add(u, 'opened', p_count);
  perform _stat_add(u, 'spent', total);
  perform _stat_add(u, 'won', won);
  return jsonb_build_object('results', res, 'state', _state(u));
end $$;

create or replace function public.sell_items(p_uids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); total numeric;
begin
  perform _profile(u);
  if p_uids is null or cardinality(p_uids) = 0 then raise exception 'bad_request'; end if;
  total := _take(u, p_uids);
  update profiles set balance = balance + total where user_id = u;
  return jsonb_build_object('count', cardinality(p_uids), 'total', total, 'state', _state(u));
end $$;

create or replace function public.buy_item(p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); p public.profiles; v_price numeric; e jsonb;
begin
  p := _profile(u);
  select price into v_price from items where id = p_item;
  if v_price is null then raise exception 'bad_request'; end if;
  if p.balance < v_price then raise exception 'insufficient_funds'; end if;
  update profiles set balance = balance - v_price where user_id = u;
  e := _add_item(u, p_item, 'market');
  return jsonb_build_object('entry', e, 'state', _state(u));
end $$;

drop function if exists public.upgrade_item(uuid[], text);
create or replace function public.upgrade_item(p_uids uuid[], p_target text, p_side text default 'under') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); stake numeric; tp numeric; v_chance double precision; r record; won boolean; e jsonb;
begin
  perform _profile(u);
  if p_uids is null or cardinality(p_uids) < 1 or cardinality(p_uids) > 4 then raise exception 'bad_request'; end if;
  if coalesce(p_side, 'under') not in ('under', 'over') then raise exception 'bad_request'; end if;
  select price into tp from items where id = p_target;
  if tp is null then raise exception 'bad_request'; end if;
  stake := _take(u, p_uids);
  if tp <= stake then raise exception 'bad_request'; end if;
  v_chance := least(0.8, stake::double precision / tp::double precision * 0.95);
  select * into r from _roll(u);
  won := case when coalesce(p_side, 'under') = 'over' then r.o_value >= 1 - v_chance else r.o_value < v_chance end;
  if won then
    e := _add_item(u, p_target, 'upgrade');
    perform _drop(u, p_target, null, 'upgrade');
    perform _stat_add(u, 'upgradesWon', 1);
  end if;
  perform _stat_add(u, 'upgrades', 1);
  return jsonb_build_object('won', won, 'roll', r.o_value, 'nonce', r.o_nonce, 'chance', v_chance, 'side', coalesce(p_side, 'under'),
                            'entry', e, 'state', _state(u));
end $$;

create or replace function public.trade_items(p_give uuid[], p_get text[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); p public.profiles; give numeric; getv numeric; n int; diff numeric; x text;
begin
  p := _profile(u);
  p_give := coalesce(p_give, '{}'); p_get := coalesce(p_get, '{}');
  if cardinality(p_get) > 10 or (cardinality(p_give) = 0 and cardinality(p_get) = 0) then raise exception 'bad_request'; end if;
  select coalesce(sum(i.price), 0), count(*) into getv, n from unnest(p_get) g(id) join items i on i.id = g.id;
  if n <> cardinality(p_get) then raise exception 'bad_request'; end if;
  give := _take(u, p_give);
  diff := getv - give;
  if diff > p.balance then raise exception 'insufficient_funds'; end if;
  update profiles set balance = balance - diff where user_id = u;
  foreach x in array p_get loop perform _add_item(u, x, 'trade'); end loop;
  perform _stat_add(u, 'trades', 1);
  return jsonb_build_object('received', cardinality(p_get), 'diff', diff, 'state', _state(u));
end $$;

-- Contract: 3–10 skins in, one out. Target value = total × 0.25 × 16^(roll^2.07) (0.25×–4×, average ≈ 0.90×);
-- the result is the catalog item nearest that value (ties: lowest id in byte order).
create or replace function public.sign_contract(p_uids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); total numeric; r record; m double precision; it text; e jsonb;
begin
  perform _profile(u);
  if p_uids is null or cardinality(p_uids) < 3 or cardinality(p_uids) > 10 then raise exception 'bad_request'; end if;
  total := _take(u, p_uids);
  select * into r from _roll(u);
  m := 0.25 * power(16::double precision, power(r.o_value, 2.07));
  select id into it from items
  order by abs(price::double precision - total::double precision * m), id collate "C"
  limit 1;
  e := _add_item(u, it, 'contract');
  perform _drop(u, it, null, 'contract');
  perform _stat_add(u, 'contracts', 1);
  return jsonb_build_object('entry', e, 'roll', r.o_value, 'nonce', r.o_nonce, 'multiplier', m, 'total', total, 'state', _state(u));
end $$;

-- Quiz: every 15 minutes, 3 tries, +$1,000 for naming the skin. The answer never leaves the server until answered.
create or replace function public.quiz_question() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); p public.profiles; q jsonb; ans public.items; opts text[];
begin
  p := _profile(u);
  if now() < p.quiz_next_at then raise exception 'quiz_not_ready'; end if;
  if p.quiz_q is null then
    select * into ans from items
    where main and type <> 'Sticker' and finish not like '%Blue Gem%' and finish <> 'Vanilla'
    order by random() limit 1;
    opts := array[ans.id];
    opts := opts || coalesce((
      select array_agg(s.id) from (
        select id from items
        where main and weapon = ans.weapon and type <> 'Sticker'
          and split_part(finish, ' (', 1) <> split_part(ans.finish, ' (', 1)
        order by random() limit 1) s), '{}');
    opts := opts || coalesce((
      select array_agg(s.id) from (
        select id from items
        where main and type <> 'Sticker' and finish not like '%Blue Gem%' and id <> all (opts)
        order by random() limit (4 - cardinality(opts))) s), '{}');
    select array_agg(x order by random()) into opts from unnest(opts) x;
    q := jsonb_build_object('id', ans.id, 'options', to_jsonb(opts), 'sheet', ans.sheet, 'cell', ans.cell);
    update profiles set quiz_q = q where user_id = u;
  else
    q := p.quiz_q;
  end if;
  return jsonb_build_object('q', q - 'id', 'state', _state(u));
end $$;

create or replace function public.quiz_answer(p_choice text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); p public.profiles; ans text; ok boolean; v_left int;
begin
  p := _profile(u);
  if now() < p.quiz_next_at or p.quiz_q is null then raise exception 'quiz_not_ready'; end if;
  ans := p.quiz_q ->> 'id';
  ok := p_choice = ans;
  if ok then
    update profiles set balance = balance + 1000, quiz_q = null, quiz_tries = 3, quiz_next_at = now() + interval '15 minutes' where user_id = u;
    perform _stat_add(u, 'quizWon', 1);
    v_left := 0;
  elsif p.quiz_tries <= 1 then
    update profiles set quiz_q = null, quiz_tries = 3, quiz_next_at = now() + interval '15 minutes' where user_id = u;
    v_left := 0;
  else
    update profiles set quiz_q = null, quiz_tries = p.quiz_tries - 1 where user_id = u;
    v_left := p.quiz_tries - 1;
  end if;
  return jsonb_build_object('correct', ok, 'answer', ans, 'triesLeft', v_left, 'state', _state(u));
end $$;

create or replace function public.rotate_seed(p_client text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); old_client text;
begin
  perform _profile(u);
  update seeds set active = false, revealed_at = now() where user_id = u and active returning client_seed into old_client;
  perform _new_seed(u, coalesce(nullif(p_client, ''), old_client));
  return jsonb_build_object('state', _state(u));
end $$;

create or replace function public.set_client_seed(p_client text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid();
begin
  perform _profile(u);
  if p_client is null or p_client !~ '^[A-Za-z0-9_\-]{1,64}$' then raise exception 'bad_request'; end if;
  update seeds set client_seed = p_client where user_id = u and active;
  return jsonb_build_object('state', _state(u));
end $$;

/* ============================== accounts & admin ============================== */

-- Create the profile ($2,000, seed, admin flag) as soon as someone registers.
create or replace function public._on_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _profile(new.id);
  return new;
end $$;
drop trigger if exists skinrush_on_new_user on auth.users;
create trigger skinrush_on_new_user after insert on auth.users
  for each row execute function public._on_new_user();

-- Admin only: add free money to any account by username (empty username = yourself). Logged in admin_log.
create or replace function public.admin_deposit(p_username text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); me public.profiles; target public.profiles; v_amount numeric;
begin
  me := _profile(u);
  if not me.is_admin then raise exception 'not_admin'; end if;
  v_amount := round(p_amount, 2);
  if v_amount is null or v_amount <= 0 or v_amount > 1000000 then raise exception 'bad_request'; end if;
  select * into target from profiles
  where username = lower(trim(coalesce(nullif(trim(p_username), ''), me.username)))
  for update;
  if not found then raise exception 'no_such_user'; end if;
  update profiles set balance = balance + v_amount where user_id = target.user_id;
  insert into admin_log (admin_id, target_id, amount) values (u, target.user_id, v_amount);
  return jsonb_build_object('username', target.username, 'amount', v_amount, 'balance', target.balance + v_amount, 'state', _state(u));
end $$;

/* ============================== permissions ============================== */

revoke all on function public._uid(), public._new_seed(uuid, text), public._profile(uuid), public._roll(uuid),
  public._pick(text, double precision), public._stat_add(uuid, text, numeric), public._add_item(uuid, text, text),
  public._take(uuid, uuid[]), public._drop(uuid, text, text, text), public._state(uuid), public._on_new_user()
  from public, anon, authenticated;

revoke all on function public.get_state(), public.open_case(text, int), public.sell_items(uuid[]), public.buy_item(text),
  public.upgrade_item(uuid[], text, text), public.trade_items(uuid[], text[]), public.sign_contract(uuid[]),
  public.quiz_question(), public.quiz_answer(text), public.rotate_seed(text), public.set_client_seed(text), public.admin_deposit(text, numeric)
  from public, anon;
grant execute on function public.get_state(), public.open_case(text, int), public.sell_items(uuid[]), public.buy_item(text),
  public.upgrade_item(uuid[], text, text), public.trade_items(uuid[], text[]), public.sign_contract(uuid[]),
  public.quiz_question(), public.quiz_answer(text), public.rotate_seed(text), public.set_client_seed(text), public.admin_deposit(text, numeric)
  to authenticated;

/* live drops over Realtime */
do $$ begin
  alter publication supabase_realtime add table public.drops;
exception when duplicate_object or undefined_object then null;
end $$;
