/* Produit les données de départ à partir d'une source unique :
     supabase/seed.sql   — à exécuter après schema.sql
     data/effectif.json  — importable depuis l'application (Données › Restaurer)
   npm run seed

   Les niveaux et les jours viennent du brief. Les fiches marquées
   « à confirmer » portent une valeur par défaut, pas une information.

   Le lundi et les métiers viennent du domaine : l'outil n'a plus sa
   propre copie du calendrier. */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SK, mondayOf, todayISO, type Levels, type Person, type Site } from "../packages/domain/src/domain.ts";

type Jour = "lun" | "mar" | "mer" | "jeu" | "ven" | "sam" | "dim";
const L: Jour = "lun", M: Jour = "mar", W: Jour = "mer", J: Jour = "jeu", V: Jour = "ven", S: Jour = "sam", U: Jour = "dim";
/* Sept jours : sur un chantier le samedi se travaille. */
const D = (list: Jour[]): boolean[] => [L, M, W, J, V, S, U].map(d => list.indexOf(d) > -1);

/* nom, jours, permis, [élec, plomberie, plâtre, peinture, menuiserie], remarque.
   Les numéros de téléphone sont volontairement vides : ils se saisissent
   depuis l'application, fiche par fiche. */
const PEOPLE: [string, boolean[], boolean, number[], string][] = [
  ["Geoffrey", D([L,M,W,J]),     true,  [5,2,4,4,3], "Référent électricité — disponibilité à confirmer"],
  ["Morgan",   D([L,M,W,J]),     true,  [3,5,4,4,4], "Référent plomberie — disponibilité à confirmer"],
  ["Erwan",    D([L,M,W,J]),     true,  [2,2,3,4,3], "Bras droit — polyvalent avancé"],
  ["Quentin",  D([L,M,W]),       false, [2,2,3,3,5], "Expert fenêtre, menuiserie, cuisine"],
  ["Aklan",    D([L,M,W,J,V]),   true,  [2,1,2,2,2], "Bras gauche — polyvalent léger"],
  ["Giorgi",   D([L,M,W,J,V]),   false, [2,1,2,2,2], "Polyvalent moyen"],
  ["Nixon",    D([L,M,W,J,V]),   false, [1,1,2,1,1], "Novice"],
  ["Sydney",   D([L,M,W,J]),     false, [1,1,2,1,1], ""],
  ["Luidgi",   D([L,M,W,J]),     false, [1,1,2,1,1], "Disponibilité à confirmer"],
  ["Amir",     D([L,M,W,J]),     false, [1,1,1,1,1], "Disponibilité à confirmer"],
  ["Chaggy",   D([M]),           false, [1,1,2,1,1], "1 jour par semaine"],
  ["Mojtaba",  D([W]),           false, [1,1,2,1,1], "1 jour par semaine"],
  ["Kia",      D([J]),           false, [1,1,2,1,1], "1 jour par semaine — niveaux à confirmer"]
];

/* code, adresse. Avancement à zéro, date de début à corriger sur place. */
const SITES: [string, string][] = [
  ["9MD49",  "9 Mont Doré — apt 49"],
  ["12AB49", "12 Audibert — apt 49"],
  ["30JA90", "30 Jules Amilhau — apt 90"]
];

const slug = (n: string): string =>
  "p_" + n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const siteId = (code: string): string => "s_" + code.toLowerCase();

/* lundi de la semaine en cours, comme date de début par défaut */
const MONDAY = mondayOf(todayISO());

const people: Person[] = PEOPLE.map(([name, days, permis, lv, note]) => {
  const sk = {} as Levels;
  SK.forEach((k, i) => sk[k] = lv[i]);
  return { id: slug(name), name, phone: "", email: "", days, permis, sk, note };
});

/* Pas de `tasks` : le fichier garde la forme qu'il a toujours eue ;
   normSite le complète à l'import. */
const sites: Omit<Site, "tasks">[] = SITES.map(([code, addr]) => ({
  id: siteId(code), code, addr, start: MONDAY, months: 2, coef: 1,
  ph: Array(12).fill(0), note: "", plan: {}
}));

/* ---------- SQL ---------- */
const q = (s: unknown): string => "'" + String(s).replace(/'/g, "''") + "'";
const arrBool = (a: boolean[]): string => "'{" + a.map(v => v ? "true" : "false").join(",") + "}'";
const arrInt = (a: number[]): string => "'{" + a.join(",") + "}'";

const sql = [
  "-- ============================================================",
  "-- Geoplan — données de départ (effectif réel)",
  "-- À exécuter APRÈS schema.sql, dans le SQL Editor de Supabase.",
  "-- Ré-exécutable : les lignes existantes sont mises à jour.",
  "-- ============================================================",
  "",
  "insert into public.people (id, name, phone, email, days, permis, sk, note) values"
];
sql.push(people.map(p =>
  "  (" + [q(p.id), q(p.name), q(p.phone), q(p.email), arrBool(p.days), p.permis,
          q(JSON.stringify(p.sk)) + "::jsonb", q(p.note)].join(", ") + ")"
).join(",\n") + "\non conflict (id) do update set");
sql.push("  name = excluded.name, days = excluded.days, permis = excluded.permis,");
sql.push("  phone = case when public.people.phone = '' then excluded.phone else public.people.phone end,");
sql.push("  email = case when public.people.email = '' then excluded.email else public.people.email end,");
sql.push("  sk = excluded.sk, note = excluded.note, updated_at = now();");
sql.push("");
sql.push("-- Dates de début à corriger depuis l'application : la valeur ci-dessous");
sql.push("-- est le lundi de la semaine où ce fichier a été produit.");
sql.push("insert into public.sites (id, code, addr, start_date, months, coef, ph, note, plan) values");
sql.push(sites.map(s =>
  "  (" + [q(s.id), q(s.code), q(s.addr), q(s.start), s.months, s.coef,
          arrInt(s.ph), q(s.note), q("{}") + "::jsonb"].join(", ") + ")"
).join(",\n") + "\non conflict (id) do nothing;");
sql.push("");

const root = new URL("../", import.meta.url);
mkdirSync(fileURLToPath(new URL("supabase/", root)), { recursive: true });
mkdirSync(fileURLToPath(new URL("data/", root)), { recursive: true });
writeFileSync(new URL("supabase/seed.sql", root), sql.join("\n"));
writeFileSync(new URL("data/effectif.json", root), JSON.stringify(
  { app: "geoplan", v: 1, exportedAt: new Date().toISOString(), people, sites }, null, 2));

console.log("supabase/seed.sql   " + people.length + " compagnons, " + sites.length + " chantiers");
console.log("data/effectif.json  idem, importable depuis Données › Restaurer");
