-- Every wear as its own item, and roll-over upgrades. Run after 0001 and 0002, then run seed.sql. Safe to re-run.

/* ---------- catalog: every wear of a skin is its own item ---------- */
-- base = the skin's main item id; main = the item that stands for the skin (its usual wear).
alter table public.items add column if not exists base text;
alter table public.items add column if not exists main boolean not null default true;
update public.items set base = id where base is null;
create index if not exists items_base_idx on public.items (base);

/* ---------- upgrade: roll under or roll over ----------
   Chance = min(0.8, stake / target × 0.95). "under" wins when roll < chance (green zone at the start of the dial);
   "over" wins when roll ≥ 1 − chance (green zone at the end). Same chance either way; mirrors js/game.js. */
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

/* ---------- quiz: ask about a skin's main item only (option names show no wear) ---------- */
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

revoke all on function public.upgrade_item(uuid[], text, text) from public, anon;
grant execute on function public.upgrade_item(uuid[], text, text) to authenticated;
