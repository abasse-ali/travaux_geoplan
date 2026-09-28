-- ============================================================
-- Geoplan — schéma de base
-- À coller dans  Supabase › SQL Editor › New query , puis exécuter.
-- Le script est ré-exécutable sans dommage, et reprend en passant
-- une base créée par une version antérieure.
-- ============================================================

-- ---------- compagnons ----------
-- days : SEPT cases, lundi à dimanche. Sur un chantier le samedi se
--        travaille, et parfois le dimanche.
create table if not exists public.people (
  id          text primary key,
  name        text        not null,
  phone       text        not null default '',   -- format international, +33612345678
  email       text        not null default '',   -- c'est par la que part le rappel du samedi
  days        boolean[]   not null default '{true,true,true,true,true,false,false}',
  permis      boolean     not null default false,
  sk          jsonb       not null default '{"elec":1,"plomb":1,"platre":1,"peint":1,"menuis":1}'::jsonb,
  note        text        not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.people add column if not exists phone text not null default '';
alter table public.people add column if not exists email text not null default '';

-- ---------- chantiers ----------
-- ph   : les 12 étapes, en pourcentage d'avancement
-- plan : { "2026-09-01": ["p_erwan","p_nixon"], ... }
--        l'affectation est datée AU JOUR (clé = date ISO réelle)
create table if not exists public.sites (
  id          text primary key,
  code        text        not null,
  addr        text        not null default '',
  start_date  date        not null,
  months      int         not null default 2,
  coef        real        not null default 1,
  ph          int[]       not null default '{0,0,0,0,0,0,0,0,0,0,0,0}',
  note        text        not null default '',
  plan        jsonb       not null default '{}'::jsonb,
  tasks       jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint sites_ph_len check (array_length(ph, 1) = 12),
  constraint sites_months check (months between 1 and 12)
);

alter table public.sites add column if not exists plan  jsonb not null default '{}'::jsonb;
alter table public.sites add column if not exists tasks jsonb not null default '{}'::jsonb;
create index if not exists sites_start_idx on public.sites (start_date);

-- ---------- demandes de disponibilité ----------
-- Une ligne par compagnon et par semaine. Le lien envoyé par SMS porte
-- le jeton ; c'est la seule chose que le compagnon possède, et il n'a
-- pas de compte. `days` reste nul tant qu'il n'a pas répondu.
create table if not exists public.avail_requests (
  id          text primary key,                  -- "<person_id>@<lundi ISO>"
  token       text        not null unique,
  person_id   text        not null references public.people(id) on delete cascade,
  week        date        not null,
  days        boolean[],
  note        text        not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '60 days'),
  answered_at timestamptz,
  constraint avail_unique unique (person_id, week)
);

create index if not exists avail_week_idx on public.avail_requests (week);

-- ============================================================
-- Reprise d'une base créée avant le passage au jour
--   • la semaine passe de cinq à sept jours ;
--   • l'affectation passe de la semaine au jour : une équipe posée sur
--     une semaine est étalée sur lundi-vendredi, ce qu'elle signifiait.
-- Sans effet sur une base neuve.
-- ============================================================

alter table public.people         drop constraint if exists people_days_len;
alter table public.avail_requests drop constraint if exists avail_days_len;

update public.people
   set days = days || array[false, false]
 where array_length(days, 1) = 5;

update public.avail_requests
   set days = days || array[false, false]
 where days is not null and array_length(days, 1) = 5;

do $$
declare
  r record; wk text; d date; acc jsonb; i int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sites' and column_name = 'weeks'
  ) then
    return;                                  -- rien à reprendre
  end if;

  for r in execute 'select id, weeks from public.sites where plan = ''{}''::jsonb' loop
    acc := '{}'::jsonb;
    for wk in select jsonb_object_keys(r.weeks) loop
      for i in 0..4 loop                     -- une semaine valait lundi-vendredi
        d := wk::date + i;
        acc := jsonb_set(acc, array[to_char(d, 'YYYY-MM-DD')], r.weeks -> wk);
      end loop;
    end loop;
    if acc <> '{}'::jsonb then
      update public.sites set plan = acc where id = r.id;
    end if;
  end loop;

  alter table public.sites drop column weeks;
end $$;

alter table public.people
  add constraint people_days_len check (array_length(days, 1) = 7);
alter table public.avail_requests
  add constraint avail_days_len check (days is null or array_length(days, 1) = 7);

-- ============================================================
-- Accès
-- Toute personne CONNECTÉE lit et écrit. Les visiteurs anonymes ne
-- voient rien — sauf à travers les deux fonctions ci-dessous, qui
-- n'ouvrent qu'une seule ligne, celle dont on connaît le jeton.
-- ============================================================

alter table public.people         enable row level security;
alter table public.sites          enable row level security;
alter table public.avail_requests enable row level security;

drop policy if exists people_rw on public.people;
create policy people_rw on public.people
  for all to authenticated using (true) with check (true);

drop policy if exists sites_rw on public.sites;
create policy sites_rw on public.sites
  for all to authenticated using (true) with check (true);

drop policy if exists avail_rw on public.avail_requests;
create policy avail_rw on public.avail_requests
  for all to authenticated using (true) with check (true);

-- Le rôle anonyme n'a aucun accès direct aux tables.
revoke all on public.people         from anon;
revoke all on public.sites          from anon;
revoke all on public.avail_requests from anon;

-- ============================================================
-- La porte du compagnon : deux fonctions, un jeton
-- `security definer` : elles s'exécutent avec les droits du
-- propriétaire, mais ne touchent QUE la ligne portant le jeton fourni.
-- ============================================================

create or replace function public.avail_get(p_token text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n text;
begin
  select * into r
    from public.avail_requests
   where token = p_token and expires_at > now();
  if not found then
    return null;
  end if;
  select name into n from public.people where id = r.person_id;
  return json_build_object(
    'name',     coalesce(n, ''),
    'week',     to_char(r.week, 'YYYY-MM-DD'),
    'days',     r.days,
    'note',     r.note,
    'answered', r.answered_at is not null
  );
end;
$$;

create or replace function public.avail_set(p_token text, p_days boolean[], p_note text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_days is null or array_length(p_days, 1) <> 7 then
    raise exception 'jours invalides';
  end if;
  update public.avail_requests
     set days = p_days,
         note = left(coalesce(p_note, ''), 300),
         answered_at = now()
   where token = p_token and expires_at > now();
  return found;
end;
$$;

revoke all on function public.avail_get(text) from public;
revoke all on function public.avail_set(text, boolean[], text) from public;
grant execute on function public.avail_get(text) to anon, authenticated;
grant execute on function public.avail_set(text, boolean[], text) to anon, authenticated;

-- ============================================================
-- Temps réel : les autres appareils voient les changements sans
-- recharger la page — y compris l'arrivée des réponses.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['people', 'sites', 'avail_requests'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
