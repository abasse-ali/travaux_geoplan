/* ============================================================
   Écran de connexion — mot de passe

   On se connecte une fois. La session est conservée sur l'appareil et
   rafraîchie automatiquement : l'écran ne réapparaît qu'en cas de
   déconnexion explicite. Aucun e-mail à attendre, aucun code à
   recopier — ce qui évite au passage le piège de l'iPhone, où une
   application posée sur l'écran d'accueil a un stockage séparé de
   Safari et ne verrait jamais une session ouverte ailleurs.

   Avec Supabase, le mot de passe oublié reste la seule porte qui passe
   par un e-mail. Avec l'API, il n'y en a aucune (ADR-002) : un compte
   se crée, et un mot de passe se change, sur le serveur. L'écran le dit
   au lieu de proposer des boutons qui n'aboutiraient pas (constat U9).
   ============================================================ */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Mark } from "./bits";
import { bouton, cn } from "./primitives/classes";
import { connecter, useSession } from "../donnees/react";
import { useEntree } from "./mouvement/entree";

type Mode = "in" | "up" | "oubli";

/* Le texte d'accueil, et l'aide qui en a le corps. */
const TEXTE = "m-0 text-[13.5px]/[1.55] text-muted";
const CHAMP = "w-full rounded-[11px] border border-line-champ bg-surface px-3.5 py-3.25 text-[16px]";

/* Les messages de Supabase Auth, traduits. */
const MESSAGES: Record<string, string> = {
  "Invalid login credentials":
    "Adresse ou mot de passe incorrect. Si vous n'avez pas encore de compte, créez-le.",
  "User already registered":
    "Ce compte existe déjà — connectez-vous plutôt.",
  "Password should be at least 6 characters":
    "Le mot de passe doit faire au moins six caractères.",
  "Email not confirmed":
    "Ce compte attend une confirmation par e-mail. Désactivez « Confirm email » dans Supabase, ou validez le message reçu."
};
const lisible = (e: { message?: string } | null | undefined): string =>
  MESSAGES[e?.message as string] || e?.message || "Connexion impossible";

/* Un mode de l'écran, qui entre en glissant s'il arrive après le premier
   affichage. Décidé à sa naissance. */
function ModeEcran({ entre, children }: { entre: boolean; children: ReactNode }){
  const anime = useEntree(entre);
  return <div className={cn(anime && "animate-[carte-in_.3s_cubic-bezier(.22,.9,.3,1)] motion-reduce:animate-none")}>{children}</div>;
}

export default function Gate(){
  const depot = useSession(s => s.depot);
  const serveur = depot?.source === "api";
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const affiche = useRef(false);
  useEffect(() => { affiche.current = true; }, []);

  const pret = email.trim().length > 3 && (mode === "oubli" || pass.length >= 6);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pret || busy) return;
    setBusy(true); setErr(null); setInfo(null);
    try {
      if (mode === "in") {
        await connecter(email, pass);
      } else if (mode === "up") {
        const compte = await depot!.inscrire!(email, pass);
        if (compte) useSession.setState({ compte });
        else {
          setInfo("Compte créé. Un message de confirmation vous attend — " +
                  "ouvrez-le, puis revenez vous connecter.");
          setMode("in");
        }
      } else {
        await depot!.reinitialiser!(email);
        setInfo("Un lien de réinitialisation est parti vers " + email + ".");
        setMode("in");
      }
    } catch(e) {
      setErr(lisible(e as Error));
    } finally { setBusy(false); }
  };

  const titres: Record<Mode, { p: string; b: string }> = {
    in: { p: "Planification des chantiers et de l'équipe. Connectez-vous : " +
            "vous ne le referez plus, la session reste ouverte sur cet appareil.",
          b: "Se connecter" },
    up: { p: "Choisissez un mot de passe d'au moins six caractères. " +
            "Votre téléphone vous proposera de le retenir.",
          b: "Créer le compte" },
    oubli: { p: "Indiquez votre adresse : un lien de réinitialisation vous sera envoyé.",
             b: "Envoyer le lien" }
  };

  return (
    <div className={cn("fixed inset-0 z-60 mx-auto flex max-w-[430px] flex-col justify-center bg-ground",
      "px-5.5 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))]")}>
      <Mark taille="accueil" />
      <h2 className="mx-0 mt-0 mb-1.5 font-display text-[24px]/[1.15] font-bold tracking-[-.02em]">Geoplan</h2>

      {/* Chaque mode (connexion, création, mot de passe oublié) entre en
          CSS (carte-in) quand on en change ; l'ancien laisse sa place d'un
          coup. Le premier, là d'emblée, n'entre pas (ADR-006 ; il glissait
          à chaque ouverture, relecture adversariale de W6). */}
      <ModeEcran key={mode} entre={affiche.current}>

          <p className={TEXTE}>{titres[mode].p}</p>

          <form onSubmit={submit} method="post" action="#" className="mt-5.5 flex flex-col gap-2.5">
            {/* name et id sont ce que le trousseau iOS cherche pour
                reconnaitre un couple identifiant / mot de passe. Sans
                eux, Safari ne propose jamais de l'enregistrer. */}
            <input type="email" name="email" id="geoplan-email" className={CHAMP}
              placeholder="vous@exemple.fr" value={email}
              autoComplete="username" inputMode="email" required
              autoCapitalize="off" autoCorrect="off" spellCheck="false"
              onChange={e => setEmail(e.target.value)} />

            {mode !== "oubli" && (
              <input type="password" name="password" id="geoplan-password" className={CHAMP}
                placeholder="Mot de passe" value={pass}
                autoComplete={mode === "up" ? "new-password" : "current-password"}
                minLength={6} required
                onChange={e => setPass(e.target.value)} />
            )}

            <button className={bouton({ teinte: "primaire", large: true })} type="submit" disabled={busy || !pret}>
              {busy ? "…" : titres[mode].b}
            </button>
          </form>

          <div className="mt-4.5 flex flex-col border-t border-line pt-4">
            {/* Une aide, mais du corps du texte d'accueil : la règle de
                l'écran l'emportait sur celle des aides. */}
            {mode === "in" && serveur && (
              <p className={TEXTE}>Pas encore de compte, ou mot de passe perdu ? Le responsable
                du serveur le crée ou le change pour vous.</p>
            )}
            {mode === "in" && !serveur && (
              <>
                <button className={bouton({ large: true })} onClick={() => { setMode("up"); setErr(null); }}>
                  Créer un compte
                </button>
                {/* Un lien discret sous les boutons. Au doigt, 44 px : 6 px
                    vers le bouton du dessus (qui prend 4 px des 10 qui les
                    séparent), 14 px vers le bas, où rien ne se touche. */}
                <button className="relative isolate mt-2.5 block w-full p-1.5 text-center font-body text-[12.5px]/none font-medium text-muted active:text-ink-2 after:absolute after:-z-10 after:inset-x-0 after:-top-[6px] after:-bottom-[14px] after:content-['']"
                  onClick={() => { setMode("oubli"); setErr(null); }}>
                  Mot de passe oublié
                </button>
              </>
            )}
            {mode !== "in" && (
              <button className={bouton({ large: true })} onClick={() => { setMode("in"); setErr(null); }}>
                Revenir à la connexion
              </button>
            )}
          </div>
      </ModeEcran>

      {(err || info) && (
        <div data-etat={err ? "erreur" : "info"}
          className={cn("mt-3.5 rounded-[10px] border-l-3 bg-surface px-3.25 py-2.75 text-[13px]/[1.5] text-ink-2",
            "animate-[message-in_.2s_ease] motion-reduce:animate-none",
            err ? "border-urgence" : "border-ok")}>
          {err || info}
        </div>
      )}
    </div>
  );
}
