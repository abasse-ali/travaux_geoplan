/* ============================================================
   Un faux Supabase, pour les tests de bout en bout de la source supabase

   La production parle aujourd'hui à Supabase (ADR-004). Pour jouer les
   gestes de W1 contre cette source sans jamais toucher la vraie base,
   le test répond lui-même aux requêtes du navigateur (routes de
   Playwright) : l'adresse est factice, rien ne sort de la machine.

   Ce qui est imité, et seulement cela — ce que l'application utilise :
   • Auth : connexion par mot de passe, rafraîchissement, déconnexion ;
   • PostgREST : lecture des trois tables (filtres eq et in), upsert
     (fusion ou « ignorer les doublons »), suppression, et les deux
     fonctions de la page compagnon (avail_get, avail_set) ;
   • Realtime : le canal Phoenix (protocole 2.0.0) — rejoindre, battre,
     quitter —, et une annonce postgres_changes à chaque écriture, à
     toutes les pages abonnées.

   Chaque test a son faux, en mémoire : les tests tournent en parallèle
   sans se gêner.
   ============================================================ */

import type { BrowserContext, Route, WebSocketRoute } from "@playwright/test";

export const FAUX = { url: "https://e2e-factice.supabase.co", key: "sb_publishable_e2e_factice_0123456789" };
export const COMPTE_SB = { id: "u_geoffrey", email: "geoffrey@geoplan.test" };
export const MOT_DE_PASSE_SB = "cheval-agrafe-pile-42";
const JETON = "jeton-session-factice";

type Ligne = Record<string, unknown> & { id: string };
type Table = "people" | "sites" | "avail_requests";

/** La session que supabase-js range dans localStorage : l'application
    s'ouvre déjà connectée. `maintenant` : l'horloge figée du test. */
export function sessionEnregistree(maintenant: Date): { cle: string; valeur: string } {
  const an = 365 * 24 * 3600;
  return {
    cle: "sb-e2e-factice-auth-token",
    valeur: JSON.stringify({
      access_token: JETON, token_type: "bearer", expires_in: an,
      expires_at: Math.floor(maintenant.getTime() / 1000) + an,
      refresh_token: "rafraichir-factice", user: utilisateur()
    })
  };
}

function utilisateur() {
  return {
    id: COMPTE_SB.id, aud: "authenticated", role: "authenticated", email: COMPTE_SB.email,
    app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z"
  };
}

interface Abonnement { ws: WebSocketRoute; topic: string; joinRef: string | null; liaisons: { id: number; table: string }[] }

export class FauxSupabase {
  readonly tables: Record<Table, Map<string, Ligne>> = {
    people: new Map(), sites: new Map(), avail_requests: new Map()
  };
  private abonnements: Abonnement[] = [];

  /** L'effectif du test, dans la forme du domaine (celle du cache local). */
  constructor(d: { people: Record<string, unknown>[]; sites: Record<string, unknown>[]; avail: Record<string, unknown>[] }) {
    for (const p of d.people) this.tables.people.set(String(p.id), { ...p, id: String(p.id) });
    for (const s of d.sites) {
      const { start, ...reste } = s as { start?: string };
      this.tables.sites.set(String(s.id), { ...reste, id: String(s.id), start_date: start ?? "2026-08-31" });
    }
    for (const a of d.avail) this.tables.avail_requests.set(String(a.id), {
      id: String(a.id), token: a.token, person_id: a.personId, week: a.week, days: a.days ?? null,
      note: a.note ?? "", answered_at: a.answeredAt ?? null, expires_at: "2099-01-01T00:00:00Z"
    });
  }

  async installer(contexte: BrowserContext): Promise<void> {
    await contexte.route(FAUX.url + "/**", r => this.repondre(r));
    await contexte.routeWebSocket(/e2e-factice\.supabase\.co\/realtime/, ws => this.canal(ws));
  }

  /* ---------- HTTP ---------- */

  private async repondre(r: Route): Promise<void> {
    const req = r.request();
    const url = new URL(req.url());
    const json = (status: number, corps?: unknown) =>
      r.fulfill({ status, contentType: "application/json", body: corps === undefined ? "" : JSON.stringify(corps) });

    /* Auth */
    if (url.pathname === "/auth/v1/token") {
      const corps = req.postDataJSON() as { email?: string; password?: string };
      if (url.searchParams.get("grant_type") === "password" &&
          (String(corps.email).toLowerCase() !== COMPTE_SB.email || corps.password !== MOT_DE_PASSE_SB))
        return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials",
          error: "invalid_grant", error_description: "Invalid login credentials" });
      return json(200, JSON.parse(sessionEnregistree(new Date()).valeur));
    }
    if (url.pathname === "/auth/v1/logout") return r.fulfill({ status: 204, body: "" });
    if (url.pathname === "/auth/v1/user") return json(200, utilisateur());

    /* PostgREST : une session est exigée, comme les règles RLS du schéma. */
    if (req.headers()["authorization"] !== "Bearer " + JETON)
      return json(401, { code: "PGRST301", message: "JWT expired" });

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) return this.fonction(rpc[1]!, req.postDataJSON() as Record<string, unknown>, json);

    const table = url.pathname.replace(/^\/rest\/v1\//, "") as Table;
    const t = this.tables[table];
    if (!t) return json(404, { message: "table inconnue" });
    const choisies = (): Ligne[] => {
      let lignes = [...t.values()];
      const id = url.searchParams.get("id");
      if (id?.startsWith("eq.")) lignes = lignes.filter(l => l.id === id.slice(3));
      if (id?.startsWith("in.(")) {
        const ids = id.slice(4, -1).split(",").map(v => v.replace(/^"|"$/g, ""));
        lignes = lignes.filter(l => ids.includes(l.id));
      }
      return lignes;
    };

    if (req.method() === "GET") return json(200, choisies());
    if (req.method() === "DELETE") {
      for (const l of choisies()) { t.delete(l.id); this.annoncer(table, "DELETE", l); }
      return r.fulfill({ status: 204, body: "" });
    }
    if (req.method() === "POST") {
      const ignorer = /resolution=ignore-duplicates/.test(req.headers()["prefer"] ?? "");
      const corps = req.postDataJSON() as Ligne | Ligne[];
      for (const l of Array.isArray(corps) ? corps : [corps]) {
        const avant = t.get(l.id);
        if (avant && ignorer) continue;
        const neuve = { ...(avant ?? {}), ...l };
        t.set(l.id, neuve);
        this.annoncer(table, avant ? "UPDATE" : "INSERT", neuve);
      }
      return r.fulfill({ status: 201, body: "" });
    }
    return json(405, { message: "méthode non imitée" });
  }

  private fonction(nom: string, arg: Record<string, unknown>, json: (s: number, c?: unknown) => Promise<void>): Promise<void> {
    const d = [...this.tables.avail_requests.values()].find(a => a.token === arg.p_token);
    if (nom === "avail_get") {
      if (!d) return json(200, null);
      const p = this.tables.people.get(String(d.person_id));
      return json(200, { name: String(p?.name ?? "").split(/\s+/)[0], week: d.week, days: d.days,
        note: d.note, answered: d.answered_at !== null });
    }
    if (nom === "avail_set") {
      if (!d) return json(200, false);
      const neuve = { ...d, days: arg.p_days, note: String(arg.p_note ?? "").slice(0, 300), answered_at: new Date().toISOString() };
      this.tables.avail_requests.set(d.id, neuve);
      this.annoncer("avail_requests", "UPDATE", neuve);
      return json(200, true);
    }
    return json(404, { message: "fonction inconnue" });
  }

  /* ---------- Realtime ---------- */

  private canal(ws: WebSocketRoute): void {
    const envoyer = (m: unknown[]) => ws.send(JSON.stringify(m));
    ws.onMessage(brut => {
      const [joinRef, ref, topic, evenement, charge] = JSON.parse(String(brut)) as
        [string | null, string | null, string, string, Record<string, unknown>];
      if (evenement === "heartbeat") return envoyer([null, ref, topic, "phx_reply", { status: "ok", response: {} }]);
      if (evenement === "phx_join") {
        const demandees = ((charge.config as { postgres_changes?: Record<string, unknown>[] } | undefined)?.postgres_changes ?? []);
        const liaisons = demandees.map((c, i) => ({ ...c, id: 1000 + i }));
        this.abonnements.push({ ws, topic, joinRef, liaisons: demandees.map((c, i) => ({ id: 1000 + i, table: String(c.table) })) });
        return envoyer([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: liaisons } }]);
      }
      if (evenement === "phx_leave") {
        this.abonnements = this.abonnements.filter(a => !(a.ws === ws && a.topic === topic));
        return envoyer([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]);
      }
      /* access_token, et le reste : rien à répondre. */
    });
    ws.onClose(() => { this.abonnements = this.abonnements.filter(a => a.ws !== ws); });
  }

  private annoncer(table: Table, type: "INSERT" | "UPDATE" | "DELETE", ligne: Ligne): void {
    for (const a of this.abonnements) {
      const ids = a.liaisons.filter(l => l.table === table || l.table === "*").map(l => l.id);
      if (!ids.length) continue;
      try {
        a.ws.send(JSON.stringify([a.joinRef, null, a.topic, "postgres_changes", {
          ids, data: {
            schema: "public", table, commit_timestamp: new Date().toISOString(), type, errors: null,
            columns: [], record: type === "DELETE" ? {} : ligne, old_record: type === "DELETE" ? { id: ligne.id } : {}
          }
        }]));
      } catch { /* page fermée entre-temps */ }
    }
  }

  /* ---------- lectures pour les tests ---------- */

  /** Les affectations d'un jour, comme les rendrait la base de l'API. */
  affectations(jour: string): { site_id: string; person_id: string }[] {
    return [...this.tables.sites.values()].sort((a, b) => a.id.localeCompare(b.id)).flatMap(s =>
      (((s.plan as Record<string, string[]> | undefined) ?? {})[jour] ?? []).map(pid => ({ site_id: s.id, person_id: pid })));
  }
}
