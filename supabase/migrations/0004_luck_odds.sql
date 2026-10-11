-- Luck tables: case odds that rise after losing opens (soft pity) and guarantee profit on the 6th in a row.
-- Run after 0001–0003, then run seed.sql (it fills case_items.luck). Safe to re-run.
-- The tables come from js/odds.js; each open walks the table for the player's luck level and the result
-- moves luck: profit (drop worth ≥ the case price) → 0, otherwise +1 (max 5).

alter table public.profiles   add column if not exists luck int not null default 0;
alter table public.case_items add column if not exists luck double precision[];

-- Weighted pick on the case's table for a luck level (case_items.luck[level + 1]); same walk as _pick.
create or replace function public._pick_luck(p_case text, r double precision, p_luck int) returns text
language sql stable security definer set search_path = public as $$
  with ci as (
    select item_id, ord, coalesce(luck[p_luck + 1], chance) as ch from case_items where case_id = p_case
  ), acc as (
    select item_id, ord, ch, sum(ch) over (order by ord) as acc, sum(ch) over () as tot from ci
  )
  select coalesce(
    (select item_id from acc where ch > 0 and acc > r * tot order by ord limit 1),
    (select item_id from acc where ch > 0 order by ord desc limit 1))
$$;

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
    'luck', coalesce(p.luck, 0),
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

create or replace function public.open_case(p_case text, p_count int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u uuid := _uid(); p public.profiles; c public.cases; total numeric; r record;
  it text; e jsonb; res jsonb := '[]'::jsonb; won numeric := 0; v_price numeric; v_luck int;
begin
  p := _profile(u);
  select * into c from cases where id = p_case;
  if not found or p_count is null or p_count < 1 or p_count > 5 then raise exception 'bad_request'; end if;
  total := round(c.price * p_count, 2);
  if p.balance < total then raise exception 'insufficient_funds'; end if;
  update profiles set balance = balance - total where user_id = u;
  v_luck := least(5, greatest(0, coalesce(p.luck, 0)));
  for i in 1..p_count loop
    select * into r from _roll(u);
    it := _pick_luck(c.id, r.o_value, v_luck);
    e := _add_item(u, it, 'case:' || c.id);
    res := res || jsonb_build_array(e || jsonb_build_object('roll', r.o_value, 'nonce', r.o_nonce, 'luck', v_luck));
    select price into v_price from items where id = it;
    won := won + v_price;
    -- luck: any profit resets it, a loss climbs one level (max 5 = next open is guaranteed profit)
    v_luck := case when v_price >= c.price then 0 else least(5, v_luck + 1) end;
    perform _drop(u, it, c.id, 'case');
  end loop;
  update profiles set luck = v_luck where user_id = u;
  perform _stat_add(u, 'opened', p_count);
  perform _stat_add(u, 'spent', total);
  perform _stat_add(u, 'won', won);
  return jsonb_build_object('results', res, 'state', _state(u));
end $$;

revoke all on function public._pick_luck(text, double precision, int) from public, anon, authenticated;
