-- Contract difficulties (easy / medium / hard) and a sharing mode for case battles. Run after 0001–0004. Safe to re-run.

alter table public.battles add column if not exists share boolean not null default false;

create or replace function public._battle_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'creator', b.creator, 'creatorName', b.creator_name, 'mode', b.mode, 'crazy', b.crazy, 'share', b.share,
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

create or replace function public._run_battle(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.battles; v_seed text; v_team int; winners int[]; haul numeric[]; k int; d record; w record; v_uid uuid; v_each numeric;
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

  if b.share then
    -- sharing mode: nobody wins outright; every seat gets an equal share of the pot
    v_team := null;
    select array_agg(g order by g) into winners from generate_series(0, b.seats - 1) g;
  else
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
  end if;
  if b.share then
    -- sharing mode: the pot becomes coins, split exactly equally between all seats; the skins (and bot shares) go to the house
    select round(coalesce(sum(price), 0) / b.seats, 2) into v_each from battle_drops where battle_id = p_id;
    update profiles pr set balance = pr.balance + v_each
    from battle_seats s where s.battle_id = p_id and not s.bot and s.user_id = pr.user_id;
  else
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
  end if;

  for w in select seat, user_id from battle_seats where battle_id = p_id and not bot and user_id is not null loop
    perform _stat_add(w.user_id, 'battles', 1);
    if b.share or (case when b.mode = '2v2' then w.seat / 2 else w.seat end) = v_team then
      if not b.share then perform _stat_add(w.user_id, 'battlesWon', 1); end if;
      select item_id into d from battle_drops where battle_id = p_id and won_by = w.seat order by price desc limit 1;
      if found then perform _drop(w.user_id, d.item_id, null, 'battle'); end if;
    end if;
  end loop;

  update battles set status = 'done', winner_team = v_team, server_seed = v_seed, started_at = now() where id = p_id;
end $$;

drop function if exists public.create_battle(text[], text, boolean);
create or replace function public.create_battle(p_cases text[], p_mode text, p_crazy boolean default false, p_share boolean default false) returns jsonb
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
  insert into battles (id, creator, creator_name, mode, crazy, share, cases, seats, cost, server_hash)
  values (v_id, u, p.username, p_mode, coalesce(p_crazy, false) and not coalesce(p_share, false), coalesce(p_share, false), p_cases,
          case p_mode when '1v1' then 2 when '1v1v1' then 3 else 4 end, v_cost, encode(digest(s, 'sha256'), 'hex'));
  insert into battle_secrets (battle_id, server_seed) values (v_id, s);
  insert into battle_seats (battle_id, seat, user_id, name) values (v_id, 0, u, p.username);
  return jsonb_build_object('battle', _battle_json(v_id), 'state', _state(u));
end $$;

-- Contract: 3–10 skins in, one out. Target value = total × lo × (hi/lo)^(roll^p), then the catalog item nearest that
-- value (ties: lowest id in byte order). Each difficulty averages 0.9× the total (mirrors SR.CONTRACT_MODES in js/game.js):
--   easy 0.6×–1.2× (p 0.7881)   medium 0.25×–5× (p 2.5955)   hard 0.1×–10× (p 3.1097)
drop function if exists public.sign_contract(uuid[]);
create or replace function public.sign_contract(p_uids uuid[], p_mode text default 'medium') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := _uid(); total numeric; r record; m double precision; it text; e jsonb;
        lo double precision; hi double precision; pw double precision;
begin
  perform _profile(u);
  if p_uids is null or cardinality(p_uids) < 3 or cardinality(p_uids) > 10 then raise exception 'bad_request'; end if;
  case coalesce(p_mode, 'medium')
    when 'easy'   then lo := 0.6;  hi := 1.2; pw := 0.7881;
    when 'medium' then lo := 0.25; hi := 5;   pw := 2.5955;
    when 'hard'   then lo := 0.1;  hi := 10;  pw := 3.1097;
    else raise exception 'bad_request';
  end case;
  total := _take(u, p_uids);
  select * into r from _roll(u);
  m := lo * power(hi / lo, power(r.o_value, pw));
  select id into it from items
  order by abs(price::double precision - total::double precision * m), id collate "C"
  limit 1;
  e := _add_item(u, it, 'contract');
  perform _drop(u, it, null, 'contract');
  perform _stat_add(u, 'contracts', 1);
  return jsonb_build_object('entry', e, 'roll', r.o_value, 'nonce', r.o_nonce, 'multiplier', m, 'total', total,
                            'mode', coalesce(p_mode, 'medium'), 'state', _state(u));
end $$;

revoke all on function public.create_battle(text[], text, boolean, boolean), public.sign_contract(uuid[], text) from public, anon;
grant execute on function public.create_battle(text[], text, boolean, boolean), public.sign_contract(uuid[], text) to authenticated;
