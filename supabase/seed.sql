-- ============================================================
-- Geoplan — données de départ (effectif réel)
-- À exécuter APRÈS schema.sql, dans le SQL Editor de Supabase.
-- Ré-exécutable : les lignes existantes sont mises à jour.
-- ============================================================

insert into public.people (id, name, phone, email, days, permis, sk, note) values
  ('p_geoffrey', 'Geoffrey', '', '', '{true,true,true,true,false,false,false}', true, '{"elec":5,"plomb":2,"platre":4,"peint":4,"menuis":3}'::jsonb, 'Référent électricité — disponibilité à confirmer'),
  ('p_morgan', 'Morgan', '', '', '{true,true,true,true,false,false,false}', true, '{"elec":3,"plomb":5,"platre":4,"peint":4,"menuis":4}'::jsonb, 'Référent plomberie — disponibilité à confirmer'),
  ('p_erwan', 'Erwan', '', '', '{true,true,true,true,false,false,false}', true, '{"elec":2,"plomb":2,"platre":3,"peint":4,"menuis":3}'::jsonb, 'Bras droit — polyvalent avancé'),
  ('p_quentin', 'Quentin', '', '', '{true,true,true,false,false,false,false}', false, '{"elec":2,"plomb":2,"platre":3,"peint":3,"menuis":5}'::jsonb, 'Expert fenêtre, menuiserie, cuisine'),
  ('p_aklan', 'Aklan', '', '', '{true,true,true,true,true,false,false}', true, '{"elec":2,"plomb":1,"platre":2,"peint":2,"menuis":2}'::jsonb, 'Bras gauche — polyvalent léger'),
  ('p_giorgi', 'Giorgi', '', '', '{true,true,true,true,true,false,false}', false, '{"elec":2,"plomb":1,"platre":2,"peint":2,"menuis":2}'::jsonb, 'Polyvalent moyen'),
  ('p_nixon', 'Nixon', '', '', '{true,true,true,true,true,false,false}', false, '{"elec":1,"plomb":1,"platre":2,"peint":1,"menuis":1}'::jsonb, 'Novice'),
  ('p_sydney', 'Sydney', '', '', '{true,true,true,true,false,false,false}', false, '{"elec":1,"plomb":1,"platre":2,"peint":1,"menuis":1}'::jsonb, ''),
  ('p_luidgi', 'Luidgi', '', '', '{true,true,true,true,false,false,false}', false, '{"elec":1,"plomb":1,"platre":2,"peint":1,"menuis":1}'::jsonb, 'Disponibilité à confirmer'),
  ('p_amir', 'Amir', '', '', '{true,true,true,true,false,false,false}', false, '{"elec":1,"plomb":1,"platre":1,"peint":1,"menuis":1}'::jsonb, 'Disponibilité à confirmer'),
  ('p_chaggy', 'Chaggy', '', '', '{false,true,false,false,false,false,false}', false, '{"elec":1,"plomb":1,"platre":2,"peint":1,"menuis":1}'::jsonb, '1 jour par semaine'),
  ('p_mojtaba', 'Mojtaba', '', '', '{false,false,true,false,false,false,false}', false, '{"elec":1,"plomb":1,"platre":2,"peint":1,"menuis":1}'::jsonb, '1 jour par semaine'),
  ('p_kia', 'Kia', '', '', '{false,false,false,true,false,false,false}', false, '{"elec":1,"plomb":1,"platre":2,"peint":1,"menuis":1}'::jsonb, '1 jour par semaine — niveaux à confirmer')
on conflict (id) do update set
  name = excluded.name, days = excluded.days, permis = excluded.permis,
  phone = case when public.people.phone = '' then excluded.phone else public.people.phone end,
  email = case when public.people.email = '' then excluded.email else public.people.email end,
  sk = excluded.sk, note = excluded.note, updated_at = now();

-- Dates de début à corriger depuis l'application : la valeur ci-dessous
-- est le lundi de la semaine où ce fichier a été produit.
insert into public.sites (id, code, addr, start_date, months, coef, ph, note, plan) values
  ('s_9md49', '9MD49', '9 Mont Doré — apt 49', '2026-08-31', 2, 1, '{0,0,0,0,0,0,0,0,0,0,0,0}', '', '{}'::jsonb),
  ('s_12ab49', '12AB49', '12 Audibert — apt 49', '2026-08-31', 2, 1, '{0,0,0,0,0,0,0,0,0,0,0,0}', '', '{}'::jsonb),
  ('s_30ja90', '30JA90', '30 Jules Amilhau — apt 90', '2026-08-31', 2, 1, '{0,0,0,0,0,0,0,0,0,0,0,0}', '', '{}'::jsonb)
on conflict (id) do nothing;
