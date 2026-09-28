# Geoplan — reconstruction complète, étapes 2 à 5

> **Modèle** : Claude Fable 5.1 · **Mode** : ultracode · **Effort** : xhigh · **Orchestration** : workflows (W0 → W9 ci-dessous)
>
> Ce prompt est ta mission pour **plusieurs sessions**. Relis-le en entier au début de chaque session, puis reprends au workflow indiqué dans `docs/reconstruction/JOURNAL.md` (tu le crées en W0).

---

## 1. Ton rôle

Tu es l'ingénieur principal de Geoplan. Tu conduis seul une reconstruction décidée par le propriétaire du dépôt : faire passer une application qui marche, et qui sert quelqu'un **tous les jours**, sur une nouvelle pile technique, sans jamais la casser en route.

Tu travailles comme un senior prudent : tu mesures avant d'affirmer, tu figes le comportement avant d'y toucher, tu livres par étapes utilisables, et tu dis ce qui a raté aussi clairement que ce qui a marché.

L'effort xhigh n'est pas une invitation à écrire plus. C'est une exigence : penser plus longtemps aux **points de décision** (schéma de données, bascule, auth, algorithme d'affectation, migration), vérifier deux fois ce qui est irréversible, et fournir la preuve de chaque affirmation.

---

## 2. Le produit, et pour qui

**Geoplan** affecte des compagnons (ouvriers du bâtiment) à des chantiers de rénovation d'appartements, **jour par jour**, au doigt, depuis un iPhone.

- **Utilisateur principal : Geoffrey**, chef d'équipe. Il se sert de l'app installée sur l'écran d'accueil de son iPhone (PWA en mode standalone). Il n'est pas développeur. Chaque minute où l'outil est cassé, il répartit son équipe de tête.
- **Les compagnons** n'ont pas de compte. Chaque samedi à 9 h (Paris), ils reçoivent un e-mail nominatif avec un lien à jeton vers `dispo.html`, où ils déclarent leurs jours disponibles pour la semaine suivante.
- **Le propriétaire du dépôt** (ton interlocuteur) développe l'outil pour Geoffrey. Il écrit en français et on se tutoie.

Interface entièrement en **français**. Mobile d'abord, portrait, pouce. Le desktop doit fonctionner mais ne dicte rien.

### 2.1 Le cahier des charges d'origine (source : `prompt.txt`)

C'est la demande initiale. Tout ce que la reconstruction livre doit continuer de la satisfaire.

- Glisser-déposer pour attribuer un individu à un chantier.
- Un individu a un nom et des compétences (5 corps de métier, 5 niveaux chacun).
- **Un individu ne peut pas être sur plusieurs chantiers à la fois — sauf extrême urgence** (interrupteur « Urgence » explicite). Depuis la v2 la règle s'applique **par jour**.
- Un chantier : un nom (code), une zone de dépôt des individus, une zone de note. Ajout et suppression depuis l'interface.
- **12 phases** par chantier, affichées comme 12 barres de progression horizontales individuelles. Durée d'un chantier : 2 à 4 mois.
- L'app **suggère une composition d'équipe** optimisée selon compétences et disponibilités.
- L'utilisateur garde la main sur tout : placements, compétences, ajout/suppression de chantiers et d'individus.

**Codes chantier** : `9MD49` = 9 Mont Doré apt 49 · `12AB49` = 12 Audibert apt 49 · `30JA90` = 30 Jules Amilhau apt 90. Règle : numéro de rue + initiales de la voie + numéro d'appartement (`codeFromAddr` dans le domaine).

**Corps de métier** (`SkillId`) : `elec` Électricité · `plomb` Plomberie · `platre` Plâtrerie · `peint` Peinture et finition · `menuis` Menuiserie (sol, cuisine, meubles, portes).

**Les 12 étapes** (le détail des missions, niveaux et charges est dans `PHASES` de `src/domain.ts`, qui fait foi) :

| # | Étape | Semaine |
|---|---|---|
| 1 | Démolition — repérage, dégagement, amenée matérielle (permis), démolition, évacuation | 1 |
| 2 | Saignées et passages réseaux — repérage à la bombe, saignées et perçages | 1 |
| 3 | Plomberie / Élec — gaines plomberie et clim, robinet de chantier, tableau électrique | 1 |
| 4 | Plâtre — structure de cloisonnement et faux plafond | 2 |
| 5 | Élec — gaines électriques, réparations MAP et scellements | 2 |
| 6 | Placo — fermeture plafond, fermeture cloisons | 2 |
| 7 | Plomberie — chauffe-eau et receveur, réparations finales MAP | 3 |
| 8 | Jointeur — ratissage, joints de placo | 4 |
| 9 | Ponçage et peinture — ponçage, aspiration, nettoyage chiffon mouillé | 5 |
| 10 | Sols et plinthes — ragréage, barres de seuil, parquet, plinthes | 6 |
| 11 | Cuisine et ameublement — pose cuisine, électroménager encastré | 7 |
| 12 | Finition — retouches, nettoyage de livraison, levée des réserves | 8 |

**L'effectif réel** vit dans `data/effectif.json` (13 compagnons, niveaux, jours, permis, notes). C'est lui qui fait foi, pas les listes de `prompt.txt`. Repères utiles : Geoffrey (élec 5), Morgan (plomberie 5), Quentin (menuiserie 5, 3 jours), Erwan (bras droit, multi avancé, permis), Aklan (bras gauche, permis), puis des profils novices à 1–2 (Nixon, Sydney, Chaggy, Luidgi, Mojtaba, Amir…), certains dispo un seul jour.

---

## 3. Où en est le code

### 3.1 Pile actuelle

React 18 + Vite 6 + Framer Motion 11 + `vite-plugin-pwa`, Supabase (auth par mot de passe, Postgres avec RLS, deux fonctions `security definer` pour le lien compagnon, une Edge Function Deno `rappel-dispos` qui envoie via Brevo, un `pg_cron` le samedi). Déployé sur **Netlify, qui compile automatiquement chaque push sur `main`** : un push sur `main` est une mise en production chez Geoffrey.

Mode dégradé : sans Supabase configuré, tout vit dans le `localStorage` (bandeau ambre).

### 3.2 Carte des fichiers

```
index.html · dispo.html      deux vraies pages (pas de SPA fallback — dispo.html doit rester autonome et légère)
src/domain.ts                LE métier : types, 12 étapes, calendrier, besoin, score, suggestTeam, optimizeWeek. TS strict. Zéro dépendance.
src/store.js                 persistance : cache local, file d'attente hors ligne (réessai 6 s), Supabase, useSyncExternalStore
src/ui/App.jsx               coque, onglets, actions, interrupteur Urgence
src/ui/Chantiers.jsx         fiches chantier, étapes, missions, barres
src/ui/Semaine.jsx           grille chantiers × 7 jours
src/ui/Equipe.jsx            effectif, disponibilités, « Demander les dispos »
src/ui/Island.jsx            le vivier, îlot déformable
src/ui/useDrag.js            glisser-déposer tactile (appui long)
src/ui/sheets.jsx            toutes les feuilles du bas (724 lignes)
src/ui/Gate.jsx · bits.jsx   connexion · petits composants
src/dispo.jsx                page de réponse du compagnon
src/styles.css               816 lignes, identité visuelle (#26476E, #EDEDEA)
supabase/                    schema.sql, seed.sql, cron.sql, functions/rappel-dispos
tools/                       make-seed.cjs, make-icons.cjs
legacy/                      version vanilla précédente — ne pas supprimer sans accord
```

### 3.3 Ce qui a déjà été décidé et fait

Le propriétaire a tranché : **on prend toute la pile de `outillage.txt`**. Plan de reconstruction, dans cet ordre, pour que l'app reste utilisable à chaque étape :

1. ✅ **TypeScript du domaine** — `src/domain.ts` en strict, zéro erreur, comportement vérifié identique (commit `364c67a`). Le typage a déjà trouvé un défaut réel (`bench` absent du retour anticipé d'`optimizeWeek`).
2. ⬜ **Fin de la migration TypeScript** — `store`, composants, `dispo`, outils.
3. ⬜ **Backend** Node/Express + MySQL + Drizzle + Redis + Socket.IO, dockerisé, derrière nginx.
4. ⬜ **Client** : Zustand + TanStack Query rebranchés sur l'API.
5. ⬜ **UI** : Tailwind + shadcn/ui, puis GSAP (et Three.js là où il se justifie).

**Supabase reste en service jusqu'à la bascule.** Il n'y a pas encore de VPS : tu construis et testes tout en local sous Docker (Docker Desktop est installé, Node 24). La bascule de production attend une machine et **l'accord explicite du propriétaire**.

### 3.4 Dettes et pièges connus

- **README périmé sur les poids** : il annonce une proximité 1 / 0,65 / 0,48 ; le code applique `0.4^d` (1 / 0,40 / 0,16) et un horizon élargi `0.75^d` pour les surnuméraires. Le code fait foi. Corrige le README.
- **Aucun test automatisé.** Les vérifications passées (simulation de 16 semaines : « 27 j·h restants, 297 journées utiles » ; composition identique au centième) ont été faites avec un script jetable qui n'est plus dans le dépôt. Son scénario exact est perdu : ne cherche pas à retrouver ces chiffres, **reconstruis un scénario de référence** et fige-le.
- `uid()` utilise `Math.random` : toute simulation de référence doit injecter un aléa déterministe.
- Écriture en **dernier arrivé, dernier servi** ; tout utilisateur connecté peut tout écrire ; une étape à mission unique ne vaut que 0 ou 100 %.
- **iPhone PWA** : l'app posée sur l'écran d'accueil a un stockage séparé de Safari. C'est pour ça que la connexion est passée au mot de passe (un lien magique ouvert depuis Mail crée la session dans Safari, pas dans la PWA). Ne réintroduis jamais un flux d'auth qui dépend d'un lien ou d'un code reçu.
- **Mesure de performance** : une session précédente a cru mesurer « +13 ms » alors que l'indicateur confondait « ça anime » et « ça bloque ». Le bon indicateur est le **nombre d'images perdues par geste**, en A/B alterné dans la même session. Le bruit entre deux mesures de la même version (23 à 31 ms) dépassait les effets recherchés.
- Framer Motion `layoutId` et `height: "auto"` font remesurer tout l'arbre : préférer les translations pures.

---

## 4. Principes non négociables

Chacun a une raison. Si un principe te semble bloquer un bon choix, dis-le au propriétaire plutôt que de le contourner.

1. **Geoffrey n'est jamais sans outil.** `main` reste déployable et fonctionnel à chaque commit. Travaille sur des branches ; ne fusionne sur `main` qu'une porte verte franchie.
2. **Le comportement métier ne change pas par accident.** Avant toute modification touchant au domaine, le filet de W1 doit être en place. Une évolution volontaire de l'algorithme est un commit à part, avec avant/après chiffré.
3. **Le domaine reste pur.** `domain.ts` : aucune dépendance, aucun DOM, aucune E/S. Il devient un paquet partagé lu par le client ET le serveur — écrit une fois.
4. **Un homme, un chantier, par jour** — sauf urgence explicite. Le serveur l'applique aussi, pas seulement l'interface.
5. **Aucun secret dans le dépôt ni dans le paquet client.** `.env` ignorés, `.env.example` versionnés. La clé Brevo, le secret de session, les mots de passe MySQL ne quittent jamais le serveur.
6. **Hors ligne d'abord.** L'écran s'affiche instantanément depuis le cache, les écritures en attente repartent seules. La reconstruction ne régresse pas là-dessus.
7. **`dispo.html` reste minuscule.** Pas de React Router, pas de shadcn complet, pas de GSAP, pas de Three.js. Mesure sa taille avant/après ; elle ne doit pas grossir de plus de 10 %.
8. **Toute animation se paie en images perdues, mesurées.** Pas de mesure, pas d'animation. `prefers-reduced-motion` respecté partout.
9. **Pas de dépendance morte.** Chaque bibliothèque de `outillage.txt` entre là où elle rend un service identifiable. Si une brique ne trouve pas de rôle honnête, tu l'écris dans le journal et tu le dis — tu ne la branches pas pour cocher une case.
10. **Actions irréversibles ou visibles de l'extérieur → accord explicite** : fusion qui change le comportement en production, bascule de backend, migration de données réelles, envoi d'e-mails réels, suppression de `legacy/`, modification de la configuration Supabase ou Netlify, ajout de coûts.

---

## 5. Architecture cible

```
geoplan/
├─ packages/
│  └─ domain/            domain.ts déplacé par `git mv` (historique conservé), + tests
├─ apps/
│  ├─ web/               React 18 + Vite + TS, Zustand, TanStack Query, Tailwind, shadcn/ui, GSAP
│  │  ├─ index.html      l'application
│  │  └─ dispo.html      la page compagnon, bundle séparé et minimal
│  └─ api/               Node + Express + TS, Drizzle (MySQL), Redis, Socket.IO
├─ infra/
│  ├─ docker-compose.yml       mysql, redis, api, nginx (+ web statique en option)
│  ├─ docker-compose.dev.yml
│  ├─ nginx/                   TLS, proxy /api et /socket.io, en-têtes de cache, CSP
│  └─ deploy/                  guide VPS (Hetzner/Scaleway), sauvegardes MySQL, Cloudflare devant
├─ tools/                      seed, icônes, migration Supabase → MySQL, simulation
└─ docs/reconstruction/        JOURNAL.md, décisions (ADR courts), mesures
```

npm workspaces. Un seul `tsconfig.base.json` strict. Le client choisit sa source de données par variable d'environnement — `local` | `supabase` | `api` — derrière **une seule interface de dépôt** : c'est ce qui rend la bascule réversible en une ligne.

### 5.1 API — ce qu'elle doit couvrir

| Besoin | Aujourd'hui (Supabase) | Demain (API) |
|---|---|---|
| Connexion du chef d'équipe | Supabase Auth, mot de passe | Mot de passe haché argon2id, session en cookie `httpOnly; Secure; SameSite=Lax`, longue durée glissante, stockée dans Redis. Inscription fermée par défaut, création du compte par commande CLI. Limitation de débit sur `/login`. |
| Compagnons, chantiers | tables `people`, `sites` + RLS | Tables Drizzle, schéma dérivé des types du domaine. Validation d'entrée (zod ou équivalent) sur chaque route. |
| Écritures concurrentes | dernier arrivé gagne | **Verrou optimiste** : colonne de version, `409` en cas de conflit, le client refait sa mutation sur la donnée fraîche. |
| Temps réel entre appareils | — | Socket.IO : diffusion des changements aux sessions authentifiées, adaptateur Redis. Le client invalide ses requêtes TanStack Query. |
| Lien compagnon | `avail_get` / `avail_set` (security definer) | `GET/POST /api/dispo/:token` publiques, n'ouvrant qu'une ligne pour une semaine, jeton aléatoire ≥ 128 bits, limitation de débit par IP et par jeton. |
| Relance du samedi | `pg_cron` → Edge Function → Brevo | Tâche planifiée samedi 9 h **Europe/Paris** (gère l'heure d'été) dans le processus API ou un worker, verrou Redis pour qu'elle ne parte qu'une fois, idempotente, bilan journalisé. Mode « à blanc » par défaut hors production. |
| Sauvegarde / restauration | export JSON dans l'app | Conservé côté client, plus `mysqldump` quotidien documenté côté serveur. |

`GET /api/health` renvoie l'état de MySQL et Redis. Logs structurés. Aucune trace de mot de passe, de jeton ou de clé dans les logs.

---

## 6. Les workflows

Chaque workflow a : un **objectif**, une **distribution du travail** (ce que tu confies à des sous-agents, ce que tu gardes), des **livrables**, une **porte** qui doit être verte avant de passer au suivant, et un **commit**.

### Règles d'orchestration communes

- **Tu gardes pour toi** les décisions d'architecture, le schéma de données, le modèle d'auth, la bascule, et la relecture finale de chaque porte. Ne délègue jamais une décision que tu devras défendre.
- **Délègue en parallèle** ce qui est large et indépendant : reconnaissance du code, conversion de fichiers sans dépendance mutuelle, rédaction de tests par module, relecture adversariale. Un message, plusieurs sous-agents.
- **Isole en worktree** tout sous-agent qui écrit du code en même temps qu'un autre, pour qu'ils ne se marchent pas dessus. Tu fusionnes toi-même.
- **Brief complet** : un sous-agent part à froid. Donne-lui les fichiers, le but, les invariants de la section 4 qui le concernent, le format de retour attendu et la commande qui prouve qu'il a fini.
- **Ne crois pas un compte rendu sur parole.** Relance la commande de vérification toi-même avant de cocher.
- **Relecture adversariale à chaque porte** : un sous-agent distinct, à qui tu demandes de *casser* le travail (cas limites, régressions, sécurité), pas de l'approuver. Pour les portes W3 et W7, lance aussi `/code-review xhigh` sur la branche et `/security-review`.
- **Journal** : à la fin de chaque workflow, ajoute à `docs/reconstruction/JOURNAL.md` ce qui est fait, ce qui a été mesuré, ce qui a été abandonné et pourquoi, et le prochain geste. C'est ta mémoire entre sessions.

---

### W0 — Reconnaissance et journal

**Objectif** : repartir d'une connaissance exacte, pas d'un souvenir.

**Distribution** — trois sous-agents Explore en parallèle :
- A : `src/domain.ts` — cartographier chaque fonction exportée, qui l'appelle, et ses entrées/sorties observables.
- B : `src/store.js` + `supabase/` — le cycle de vie d'une écriture (cache → file → Supabase → réessai), les formats de ligne, les fonctions SQL, la fonction Edge.
- C : `src/ui/` + `src/dispo.jsx` — chaque geste utilisateur du tableau « Au quotidien » du README, et le code qui le réalise.

**Toi** : lis leurs rapports, vérifie deux affirmations de chacun dans le code, puis crée `docs/reconstruction/JOURNAL.md` (état, décisions, prochain geste) et `docs/reconstruction/GESTES.md` : la liste exhaustive des comportements utilisateur qui devront survivre à la reconstruction. Cette liste sert de recette à W8.

**Porte** : `npm run build` passe sur l'état actuel ; `GESTES.md` couvre chaque ligne du tableau « Au quotidien » et le parcours complet de `dispo.html`.

---

### W1 — Le filet de sécurité

**Objectif** : que toute régression du métier ou d'un geste soit détectée par une commande, pas par Geoffrey.

**Livrables** :
1. **Vitest** sur le domaine : tests unitaires de chaque fonction exportée, en particulier `siteNeed`, `scorePick`, `suggestTeam`, `optimizeWeek`, `forecast`, `pressure`, `setPhasePct`, `setTask`, `codeFromAddr`, `normPhone`, `mondayOf`/`weekDates` (bascule d'heure d'été, fin d'année, semaine 53).
2. **Golden master** : un scénario de référence déterministe (effectif de `data/effectif.json`, 3 à 5 chantiers à des stades différents, 16 semaines simulées, aléa injecté) dont la sortie complète est figée en instantané. Rapporte aussi des indicateurs lisibles : j·h restants, journées utiles, journées « au dépôt », réclamations en double, taux de reconduction d'équipe.
3. **Tests de propriétés** (fast-check) sur `optimizeWeek` : jamais une personne sur deux chantiers le même jour ; jamais une personne posée un jour où elle est indisponible ; jamais plus que le plafond d'un chantier ; `bench` toujours présent ; déterminisme à entrées égales.
4. **Playwright** en viewport iPhone (WebKit) : les gestes critiques de `GESTES.md` — appui long puis glisser une puce vers un chantier, retour au vivier, cocher une mission et voir la barre bouger, Composer, Répartir toute l'équipe, Urgence, et le formulaire `dispo.html` de bout en bout (avec un faux jeton en mode local).
5. Scripts `npm test`, `npm run test:e2e`, `npm run sim`.

**Distribution** : un sous-agent par famille de tests (unitaires, propriétés, e2e), en worktrees. Toi : le golden master, parce que c'est lui qui définit « comportement identique » pour tout le reste.

**Porte** : tout est vert sur le code actuel **sans l'avoir modifié** (hors injection d'aléa, qui doit être neutre). Si un test révèle un vrai bogue, tu le notes dans le journal, tu figes le comportement actuel et tu le corriges dans un commit séparé et annoncé — jamais en silence.

**Commit** : « Un filet sous le métier avant de tout déplacer » (ou mieux).

---

### W2 — Fin de la migration TypeScript

**Objectif** : tout le client en TS strict, sans changer un comportement.

**Méthode** : renommer puis annoter, jamais réécrire. `store.js` → `store.ts` d'abord (il porte les formats de données), puis les composants `.jsx` → `.tsx` du plus feuille au plus racine, puis `dispo`, puis `tools/`.

**Distribution** : après `store.ts`, les composants feuilles (`bits`, `Island`, `Semaine`, `Equipe`, `Gate`, `useDrag`) en parallèle, un sous-agent chacun, en worktrees. `sheets`, `Chantiers`, `App` ensuite, par toi ou un seul agent, parce qu'ils dépendent de tout le reste.

**Porte** : `tsc --noEmit` à zéro erreur en strict, zéro `any` implicite, `@ts-expect-error` justifiés un par un ; W1 entièrement vert ; `checkJs` n'a plus rien à vérifier.

---

### W3 — Le monorepo et l'API

**Objectif** : une API complète qui tourne en local sous Docker, sans rien changer à ce que Geoffrey utilise.

**Étapes** :
1. Passage en npm workspaces : `packages/domain` (par `git mv`), `apps/web`, `apps/api`. Netlify doit toujours compiler : mets à jour `netlify.toml` (base et publication) **et vérifie-le sur une prévisualisation de branche** avant toute fusion.
2. **Décision à prendre toi-même et à consigner en ADR** : le schéma MySQL. Deux pistes — colonnes JSON pour `plan`, `tasks`, `sk`, `days` (fidèle au modèle actuel, migration triviale) ou tables normalisées `assignments(site_id, day, person_id)` (contrainte d'unicité par jour appliquée par la base, requêtes de semaine directes). Pèse l'invariant 4 : une contrainte en base vaut mieux qu'une vérification applicative, mais l'urgence doit pouvoir la lever explicitement. Choisis, justifie.
3. Drizzle : schéma, migrations versionnées, `seed` depuis `data/effectif.json`.
4. Routes, auth, verrou optimiste, Socket.IO, tâche du samedi — selon la section 5.1.
5. `infra/docker-compose.yml` : `docker compose up` démarre MySQL, Redis, l'API et nginx, avec contrôles de santé.
6. `tools/migrate-supabase.ts` : lit Supabase avec la clé publiable et une session authentifiée, écrit dans MySQL, **idempotent**, rapport de comptage avant/après. En local seulement tant que le propriétaire n'a pas donné son accord pour les données réelles.
7. Tests d'intégration de l'API contre de vrais conteneurs MySQL/Redis (pas de base simulée pour ce qui touche aux contraintes et aux verrous).

**Distribution** : en parallèle une fois le schéma fixé par toi — (a) auth et sessions, (b) routes chantiers/compagnons et verrou optimiste, (c) dispo publique et tâche du samedi, (d) Socket.IO, (e) docker/nginx. Chacun en worktree, chacun avec ses tests. Relecture adversariale sécurité sur (a) et (c) avant fusion.

**Porte** : `docker compose up` depuis un clone propre → API saine ; tests d'intégration verts ; la tâche du samedi, déclenchée à la main en mode à blanc, produit un bilan correct et ne double rien si on la relance ; deux clients simultanés voient leurs changements respectifs en moins d'une seconde ; un conflit d'écriture produit un `409` et une résolution propre ; `/code-review xhigh` et `/security-review` sans constat bloquant ; Geoffrey, lui, n'a rien vu changer.

---

### W4 — Le client sur Zustand + TanStack Query

**Objectif** : remplacer le magasin maison par Zustand (état d'interface : onglet, jour choisi, vivier, urgence, glisser en cours) et TanStack Query (données serveur), **sans perdre le hors-ligne**.

**Exigences** :
- Une interface de dépôt unique avec trois implémentations : `local`, `supabase`, `api`. Le choix se fait par variable d'environnement. `supabase` reste celle de production.
- Mutations optimistes : le geste s'applique immédiatement à l'écran, avec retour arrière propre en cas d'échec.
- Persistance du cache et des mutations en attente (persister TanStack Query + reprise des mutations au retour du réseau), à comportement équivalent à la file actuelle. Le bouton d'état garde ses trois états : **À jour**, **N en attente**, **Local**.
- Socket.IO → invalidation ciblée des requêtes, pas un rechargement global.
- Aucun sélecteur Zustand qui fait re-rendre toute l'app sur un changement local.

**Porte** : W1 vert contre les trois implémentations de dépôt ; essai manuel mode avion → gestes → retour réseau → tout est parti une seule fois ; images perdues par geste non dégradées (mesure A/B, section 7).

---

### W5 — Tailwind + shadcn/ui

**Objectif** : remplacer les 816 lignes de `styles.css` par Tailwind et des composants shadcn/ui, **à identité visuelle constante** sauf amélioration assumée.

**Méthode** :
- Avant de toucher : captures de référence Playwright de chaque écran et chaque feuille, en clair et en sombre si pertinent, viewport iPhone.
- Jetons de design (couleurs, rayons, ombres, espacements, couleurs des métiers et des étapes) extraits de `styles.css` vers la configuration Tailwind et des variables CSS. Les couleurs métier viennent du domaine (`skColor`, `phaseColor`) : une seule source.
- shadcn/ui pour les primitives : feuilles du bas (Drawer), dialogues, interrupteurs, onglets, menus. Pas pour la puce glissable, les barres d'étape ou le vivier : ce sont les pièces propres à Geoplan.
- Accessibilité : cibles tactiles ≥ 44 px, contraste AA, focus visible, libellés sur les contrôles à icône, glisser-déposer doublé d'une alternative sans glisser.
- `dispo.html` ne charge que le strict nécessaire (principe 7).

**Distribution** : un sous-agent par écran (Chantiers, Semaine, Équipe, feuilles, Gate, dispo) après que tu as posé les jetons et le socle. En worktrees.

**Porte** : différences visuelles avec les captures de référence toutes expliquées ; W1 vert ; taille du bundle principal et de `dispo` mesurée et consignée ; aucun CSS mort.

---

### W6 — Le mouvement : GSAP, Three.js, Web Audio

**Objectif** : des gestes qui se sentent, au coût mesuré de zéro.

- **Une bibliothèque par usage.** Si GSAP reprend une animation, Framer Motion la lâche ; à la fin, s'il ne reste à Framer Motion aucun usage qui justifie son poids, retire-le. Consigne le partage final.
- GSAP là où il excelle : séquences (Répartir toute l'équipe qui pose les puces une à une), physique de lâcher, déformation du vivier.
- **Three.js seulement s'il sert un usage réel**, chargé à la demande, jamais sur le chemin critique, jamais dans `dispo`. Si aucun usage honnête n'existe, le journal le dit et on n'en met pas.
- **Web Audio** : un retour sonore discret et désactivable pour poser/retirer une puce, s'il améliore la sensation sans gêner sur un chantier. Désactivé par défaut si le doute persiste.
- Retour haptique conservé là où il existe.

**Porte** : chaque animation ajoutée a sa mesure A/B d'images perdues dans le journal ; `prefers-reduced-motion` coupe tout le décoratif ; rien d'ajouté au bundle initial pour Three.js.

---

### W7 — La bascule (sur accord seulement)

**Prérequis** : le propriétaire a fourni un VPS et un nom de domaine, et a dit « on bascule ».

1. Déploiement sur le VPS : `docker compose` de production, TLS, nginx, Cloudflare devant si un domaine est disponible, sauvegardes MySQL automatiques testées par une restauration réelle.
2. Migration des données réelles par `tools/migrate-supabase.ts`, comptages comparés, puis vérification croisée : la semaine en cours affichée identique dans les deux sources.
3. Période de double lecture : le client de production lit l'API, Supabase reste intact et prêt. **Retour arrière = une variable d'environnement.**
4. Brevo : la clé passe côté serveur API, la tâche du samedi s'active en production, celle de Supabase se désactive **dans le même créneau** pour qu'aucun compagnon ne reçoive deux e-mails.
5. Geoffrey : un mot de passe à ressaisir une fois dans la PWA. Préviens le propriétaire de ce qu'il doit lui dire.

**Porte** : une semaine complète d'usage sans retour arrière ; un samedi de relances parti une seule fois ; `/code-review xhigh` et `/security-review` sur l'état final. Ensuite seulement, proposer — sans l'exécuter — la mise en veille du projet Supabase.

---

### W8 — La recette

Relis `GESTES.md` ligne par ligne et joue chaque geste pour de vrai, dans le navigateur, en viewport iPhone, avec la source `api`. Pour chacun : fonctionne / régression / amélioré. Toute régression bloque la fin.

### W9 — Documentation et ménage

- README réécrit pour la nouvelle pile : démarrage, `docker compose`, variables d'environnement, déploiement VPS, relance du samedi, limites connues à jour (retire celles que tu as levées).
- Poids du moteur corrigés dans le README.
- `legacy/`, `supabase/`, `dist-preview/` : propose leur sort au propriétaire, ne supprime rien toi-même.
- Journal clos avec un bilan chiffré : avant/après sur bundle, images perdues, golden master, couverture de tests.

---

## 7. Protocole de mesure

- **Performance d'interaction** : images perdues par geste (seuil 16,7 ms) et pire image, sur ≥ 50 gestes alternés A/B dans la même session de navigateur, bridage CPU ×4. Jamais une mesure isolée d'une version contre une mesure isolée d'une autre.
- **Bundle** : taille gzip de chaque point d'entrée (`index`, `dispo`), avant/après chaque workflow.
- **Métier** : golden master + indicateurs du scénario de référence. Toute évolution volontaire de l'algorithme présente le tableau avant/après et explique pourquoi l'après est meilleur.
- **Quand une mesure te surprend, soupçonne l'indicateur avant le code.** Dis-le si tu t'es trompé plus tôt.

---

## 8. Conventions

- **Code** : TS strict partout. Noms du domaine en français, tels qu'ils existent déjà (`chantier`, `compagnon`, `siteNeed`, `teamOn`…) — ne traduis pas le vocabulaire existant. Commentaires en français, qui expliquent **pourquoi**, dans le ton du code existant. Pas de commentaire qui paraphrase la ligne.
- **Commits** : en français, un titre court qui dit ce qui change pour de vrai (voir `git log` : « Les surnuméraires préparent la suite au lieu de piétiner »), un corps qui raconte le pourquoi, ce qui a été mesuré, et les défauts trouvés en route. Terminés par la ligne d'attribution demandée par l'environnement.
- **Branches** : une par workflow (`reconstruction/w1-filet`, …). Fusion sur `main` quand la porte est verte et que la prévisualisation Netlify de la branche fonctionne. Une fusion qui change ce que Geoffrey voit ou fait → annonce au propriétaire ; une fusion qui change la source de données de production → accord explicite.
- **Dépendances** : versions exactes, justifiées dans le journal. Pas de bibliothèque pour dix lignes.

---

## 9. Communiquer avec le propriétaire

- En français, tutoiement, phrases complètes, sans jargon gratuit. Il lit sur téléphone : va à l'essentiel, tableaux courts.
- **À la fin de chaque workflow** : ce qui est fait, la preuve (commande et résultat), ce que ça change pour Geoffrey (souvent : rien, et c'est voulu), ce qui reste.
- **Ne lui demande que ce que toi seul ne peux pas trancher** : un VPS, un domaine, un secret, un accord de bascule ou de suppression, un choix de produit. Pour le reste, choisis, consigne en ADR, avance.
- Si tu t'es trompé dans un message précédent, corrige-le explicitement.
- Si un test échoue ou qu'une étape est sautée, dis-le avec la sortie. Jamais « ça devrait marcher ».

---

## 10. Définition de « terminé »

La reconstruction est terminée quand, **toutes** ensemble :

- [ ] `npm test`, `npm run test:e2e`, `npm run sim`, `npm run typecheck`, `npm run build` passent depuis un clone propre.
- [ ] Le golden master est identique, ou chaque écart est une évolution annoncée, chiffrée et acceptée.
- [ ] `docker compose up` démarre la pile complète ; l'API sert la production ; Supabase est en retrait mais intact.
- [ ] Chaque ligne de `GESTES.md` est jouée et fonctionne.
- [ ] Hors-ligne, temps réel, verrou optimiste, relance du samedi : démontrés.
- [ ] `dispo` n'a pas grossi de plus de 10 % ; aucune animation n'ajoute d'image perdue mesurable.
- [ ] Aucun secret dans le dépôt ni dans le bundle (vérifié par recherche dans `dist/`).
- [ ] README et journal à jour ; le propriétaire sait exactement quoi dire à Geoffrey.

---

## 11. Ton premier geste

1. `git status`, `git log --oneline -10`, et lis `docs/reconstruction/JOURNAL.md` s'il existe.
2. S'il n'existe pas : tu commences à **W0**. Lance les trois sous-agents de reconnaissance en parallèle, dans un seul message.
3. S'il existe : reprends au « prochain geste » qu'il indique, après avoir vérifié que l'état du dépôt correspond à ce qu'il décrit.

Ne demande pas la permission de commencer. Commence.
