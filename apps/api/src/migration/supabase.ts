/* ============================================================
   Lire les données de Geoplan dans Supabase

   Avec la clé PUBLIABLE et une session du chef d'équipe, exactement
   comme l'application : les règles RLS s'appliquent, rien n'est lu que
   l'application ne lise déjà. Aucune clé secrète n'est nécessaire.

   Les lignes Supabase sont traduites dans la forme du domaine, avec les
   mêmes correspondances que apps/web/src/store.ts (start_date → start,
   person_id → personId, answered_at → answeredAt).
   ============================================================ */

import type { Person, Site } from "@geoplan/domain";
import type { AvailImport, Donnees } from "./importer.ts";

export interface SourceSupabase {
  url: string;                   // https://<projet>.supabase.co
  cle: string;                   // sb_publishable_…
  email: string;
  motDePasse: string;
  fetch?: typeof fetch;          // injectable pour les tests
}

interface LigneSite {
  id: string; code: string; addr: string; start_date: string; months: number; coef: number;
  ph: number[]; note: string; plan: Record<string, string[]>; tasks: Record<string, boolean[]>; weeks?: unknown;
}
interface LigneDemande {
  id: string; token: string; person_id: string; week: string;
  days: boolean[] | null; note: string; answered_at: string | null;
  created_at: string | null; expires_at: string | null;
}

/* PostgREST ne rend jamais plus que le plafond du projet (1 000 lignes
   par défaut sur Supabase, parfois moins) : il répond 206 avec une page
   partielle, sans erreur. S'arrêter à la première page incomplète
   tronquerait donc en silence un projet réglé plus bas. On demande le
   total (Prefer: count=exact, rendu dans Content-Range) et on lit, dans
   un ordre stable, jusqu'à l'avoir atteint. Sans total, on refuse : une
   migration tronquée serait pire qu'une migration arrêtée. */
const PAGE = 1000;

function totalDe(t: Response, table: string): number {
  const total = Number((t.headers.get("content-range") ?? "").split("/")[1]);
  if (!Number.isInteger(total) || total < 0)
    throw new Error("Supabase n'a pas donné le nombre de lignes de " + table + " : lecture arrêtée plutôt que tronquée.");
  return total;
}

export async function lireSupabase(src: SourceSupabase): Promise<Donnees> {
  if (/^sb_secret_/.test(src.cle))
    throw new Error("Clé secrète refusée : la migration lit avec la clé publiable et une session.");
  const f = src.fetch ?? fetch;
  const base = src.url.replace(/\/$/, "");

  const r = await f(base + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: src.cle, "content-type": "application/json" },
    body: JSON.stringify({ email: src.email, password: src.motDePasse })
  });
  if (!r.ok) throw new Error("Connexion à Supabase refusée (" + r.status + ")");
  const { access_token: jeton } = await r.json() as { access_token: string };

  const lire = async <T>(table: string): Promise<T[]> => {
    const tout: T[] = [];
    for (;;) {
      const debut = tout.length;
      const t = await f(base + "/rest/v1/" + table + "?select=*&order=id.asc", {
        headers: {
          apikey: src.cle, authorization: "Bearer " + jeton,
          range: debut + "-" + (debut + PAGE - 1), "range-unit": "items", prefer: "count=exact"
        }
      });
      if (!t.ok) throw new Error("Lecture de " + table + " impossible (" + t.status + ")");
      const total = totalDe(t, table);
      const page = await t.json() as T[];
      tout.push(...page);
      if (tout.length >= total) return tout;
      if (!page.length)
        throw new Error("Lecture de " + table + " incomplète : " + tout.length + " lignes sur " + total + ".");
    }
  };

  const people = await lire<Person>("people");
  const lignesSites = await lire<LigneSite>("sites");
  const lignesDemandes = await lire<LigneDemande>("avail_requests");

  const sites = lignesSites.map(r => ({
    id: r.id, code: r.code, addr: r.addr, start: r.start_date, months: r.months, coef: r.coef,
    ph: r.ph, note: r.note, plan: r.plan, tasks: r.tasks, weeks: r.weeks
  }) as Site & { weeks?: unknown });
  const avail: AvailImport[] = lignesDemandes.map(r => ({
    id: r.id, token: r.token, personId: r.person_id, week: r.week,
    days: r.days, note: r.note, answeredAt: r.answered_at,
    createdAt: r.created_at, expiresAt: r.expires_at
  }));
  return { people, sites, avail };
}
