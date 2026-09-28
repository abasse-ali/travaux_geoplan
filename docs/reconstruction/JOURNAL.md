# Journal de la reconstruction

Mémoire entre sessions. À relire en entier avec `prompt.md` avant de reprendre.
Le **prochain geste** est toujours en tête. Les entrées de workflow sont en bas, la plus récente en dernier.

---

## Prochain geste

W8 est faite, porte verte (2026-09-28) : la recette de GESTES.md a été jouée sur la pile Docker qui partira sur le VPS, dans Chromium. Voir l'entrée W8 et [`RECETTE.md`](RECETTE.md). Rien n'est fusionné sur `main`.

La suite attend le propriétaire :
1. **Quel dépôt fait foi** (question 9). Sans réponse, les commits restent sur la branche `claude/happy-feynman-rpp9pt` de `travaux_geoplan`.
2. **W7, la bascule** (question 11) : un VPS, un domaine, et « on bascule ».
3. **U4 et U14** (question 12) : deux défauts gardés tels quels, à trancher.
4. Sur sa machine, sans rien toucher à la production : le filet dans WebKit et les captures (les portes de W6 et de W8 n'ont tourné que dans Chromium) ; la recette dans WebKit (`npm run recette -w @geoplan/web`, préparation dans RECETTE.md) ; puis, sur l'iPhone de Geoffrey, la liste « Ce qui reste à jouer sur un iPhone » de RECETTE.md.

Sans attendre : W9 peut commencer (le README de la nouvelle pile, le sort proposé de `legacy/`, `supabase/`, `dist-preview/`) ; son bilan chiffré se fera après la bascule.

Pistes : « semaine » coûte encore une vingtaine d'images au rendu des fiches, pas au mouvement ; le `will-change` de la puce, sans effet mesurable, à retirer avec un contrôle des captures ; le rendu des onglets de Radix à chaque jour choisi (+0,2 image, W5) ; deux toasts à la fois se superposent exactement (comme à la référence).

## État

| Workflow | Branche | État |
|---|---|---|
| W0 Reconnaissance | `reconstruction/w0-reconnaissance` | fait |
| W1 Filet | `reconstruction/w1-filet` | fait, porte verte |
| W2 TypeScript | `reconstruction/w2-typescript` | fait, porte verte |
| W3 Monorepo et API | `reconstruction/w3-api` | fait, porte verte |
| W4 État client | `reconstruction/w4-client` | fait, porte verte (reste l'essai en mode avion sur l'iPhone) |
| W5 Interface | `reconstruction/w5-ui` | fait, porte verte |
| W6 Mouvement | `reconstruction/w6-mouvement`, puis `claude/happy-feynman-rpp9pt` (`travaux_geoplan`) | fait, porte verte (filet joué dans Chromium ; WebKit et captures à rejouer) |
| W7 Bascule | — | attend le propriétaire (question 11) |
| W8 Recette | `claude/happy-feynman-rpp9pt` (`travaux_geoplan`) | fait, porte verte (dans Chromium ; WebKit et l'iPhone : `RECETTE.md`) |
| W9 Documentation et ménage | — | à faire |

**Rien n'est fusionné sur `main`.** Voir « Questions au propriétaire », point 1.

---

## Questions au propriétaire

Ce que je ne peux pas trancher seul. Le reste est décidé dans les ADR.

1. **La production est `https://geoplans.netlify.app`** (donnée par le propriétaire le 2026-09-26 ; le README citait à tort `geonew`). Vérifié : elle sert exactement le paquet construit depuis `main` (`364c67a`), et son service worker porte le défaut P1. Les déploiements de branche ne sont pas activés : la branche `reconstruction/w1-filet`, poussée sur GitHub, n'a produit aucune prévisualisation en six minutes. À la place, W1 et W3 ont été construites depuis un clone propre sous Node 22, comme Netlify : elles passent. **Pour fusionner, il faut soit ton feu vert sur la foi de ces constructions, soit une prévisualisation** : ouvrir une pull request depuis la branche poussée (Netlify crée alors une « Deploy Preview »), ou activer *Site configuration → Build & deploy → Branches and deploy contexts → Branch deploys : All*.
2. **Six défauts visibles sont corrigés sur la branche W1**, prêts à partir en production dès que tu donnes le feu vert : P1 (le lien du samedi ouvrait l'application), U13 (une puce posée n'apparaissait pas sur la fiche), U1 (brief du mauvais jour), U2 (barre qui ne suit pas le doigt), U15 (toasts décentrés), D1 (noms sans raison dans « Répartir »). Ce que Geoffrey et les compagnons verront changer est décrit dans chaque commit.
   Les branches s'enchaînent : W2 part de W1, W3 de W2. W2 ne change rien de visible (paquet identique, à part le magasin). W3 ne change rien de visible non plus, mais elle déplace l'application dans `apps/web` : `netlify.toml` publie désormais `apps/web/dist`. La construction depuis un clone propre, sous Node 22 comme Netlify, passe. L'API de W3 n'est branchée nulle part : la production continue de lire Supabase jusqu'à la bascule (W7).
3. **La fonction Edge est-elle vraiment appelée chaque samedi ?** Deux raisons d'en douter (constats P2 et P3). Un coup d'œil à `net._http_response` dans Supabase le dirait.
4. **Trois évolutions de l'algorithme d'affectation à trancher** (D2, D3, D12). Ce ne sont pas des pannes : le moteur fait des choix discutables. Je peux chiffrer chacune avec le golden master (avant/après) ; je n'y touche pas sans ton accord.
5. **W5 change ce que Geoffrey voit**, un peu, et exprès : des couleurs de texte un cran plus foncées (contraste AA, en clair comme en sombre), l'orange des boutons aussi, les quantièmes du week-end en gris, un compagnon posé un jour d'absence signalé aussi par un trait en tirets (pas seulement la couleur), et « Auj. » qui paraît avant la flèche au lieu de prendre sa place (U19 : deux appuis rapides ramenaient à aujourd'hui). Chaque image changée est expliquée dans son commit (`c176075`, `613ce83`, `eaf22ef`) ; le reste est identique au pixel. Deux autres défauts de production sont corrigés, qui ne se voient pas au doigt : une puce s'ouvre au clavier (U20), chaque champ a un nom (U21). La fluidité de W4 est gardée, à 0,2 image près au changement de jour. Rien de cela n'est en production : il part avec la fusion, quand tu la décides (point 1).
6. **Les grappes serrées.** 44 × 44 px au doigt partout où c'est possible sans changer le dessin. Dans sept grappes, les voisines sont trop proches : les puces (33 px), les cases de la grille Semaine, le titre (28 px) et la barre (24 px) d'une étape, les volets empilés, les cinq niveaux d'une compétence (31 px), « Ses jours dispo » et « Aucun », la tête du vivier ; et, sur un écran de 320 px de large seulement, les sept jours de la bande et du sélecteur. Elles tiennent le minimum WCAG (24 px), pas la recommandation d'Apple (44). Les agrandir changerait le dessin (zones et grille plus hautes) : c'est à toi de trancher ; je peux chiffrer la place perdue écran par écran.
7. **Un budget pour `index.html` ?** Le principe 7 fixe celui de la page compagnon (au plus +10 %) ; rien pour l'application. W5 l'a fait passer de 137 à 147 ko (+7,5 %, surtout les onglets et l'interrupteur de Radix, pour l'accessibilité), en gardant les feuilles à part ; W6 l'a ramené à 112,5 ko, sous les 120,3 ko d'avant la reconstruction (Framer Motion retiré). Si tu veux un plafond, je le fais tenir par `npm run measure`.
8. **GSAP n'est pas dans W6**, alors que la pile cible le nomme. Essayé là où la mission l'attendait (la déformation du vivier), il perd 1,86 image par geste là où le navigateur seul (Web Animations) en perd 0,44 ; et son horloge (`Date.now`) est figée par le filet de tests. Le mouvement passe par le CSS et Web Animations, sans bibliothèque (ADR-006) : Framer Motion part aussi, et les deux pages s'allègent de 37 ko. Si tu tiens à GSAP pour une raison que je ne vois pas (des séquences à venir bien plus riches, par exemple), il se remet en un module : dis-le-moi.
9. **Quel dépôt fait foi ?** W6 a été fini dans `abasse-ali/travaux_geoplan`, une copie de ta copie de travail en un seul commit : l'historique de W0 à W6 (un commit par correction, chacun annoncé) n'y est pas. Il est dans `abasse-ali/geoplan`, et, pour les branches jamais poussées (W2 à W6 au moins), seulement sur ta machine, où la copie de travail de W6 avait encore des changements non enregistrés. Netlify publie la `main` de `geoplan`. Deux voies : (a) tu enregistres et pousses `reconstruction/w6-mouvement` (avec ses changements en cours) sur `geoplan`, et je reporte dessus les commits de la porte, un par un ; (b) `travaux_geoplan` devient la référence, et l'historique d'avant reste dans `geoplan`. Je recommande (a) : l'historique est la preuve de chaque correction.
10. **`apps/web/dist/` est versionné dans `travaux_geoplan`**, sans doute par la copie : c'est une construction, déjà périmée (d'avant le lâcher et la vague). Je propose de le retirer et de l'ignorer ; le sort de `dist/` et `dist-preview/` reste à trancher en W9. Je n'y touche pas sans ton accord.
11. **W7, la bascule, attend trois choses de toi** : un VPS (Hetzner ou Scaleway, voir `infra/deploy/README.md`), un nom de domaine, et le mot « on bascule ». Rien d'autre ne bloque : l'API, l'infrastructure et le client pour l'API sont prêts et testés en local, et la recette (W8) est passée sur la pile qui partira sur le VPS.
12. **Deux défauts gardés tels quels depuis W1, que la recette a retrouvés, à trancher.** U4 (C5) : un simple appui sur la barre d'une étape la met à 100 % (ou à 0) ; un geste que rien n'annonce, qui peut cocher une étape entière d'un doigt qui passe. Je propose de le retirer (l'appui ne ferait plus rien ; le glisser, le clavier et les missions restent), sauf si Geoffrey s'en sert. U14 (J4) : sur la page du compagnon, au-delà de 300 caractères, l'écran de confirmation montre le mot entier alors que la base n'en garde que 300 ; je propose de limiter la saisie à 300 caractères, pour que ce qui s'affiche soit ce qui est reçu. Deux changements visibles : j'attends ton accord.

---

## Mesures de référence (commit `364c67a`)

### Poids des pages (gzip -9)

Ce que le navigateur télécharge à l'ouverture de chaque page : le point d'entrée et tout ce qu'il importe statiquement.

| Page | Scripts | CSS | Total |
|---|---|---|---|
| `index.html` | 112,8 ko (+ 58,9 ko de supabase-js chargés à la demande en mode connecté) | 7,5 ko | 120,3 ko, 179,2 ko connecté |
| `dispo.html` | 151,4 ko | 7,5 ko | **158,9 ko** |

`dispo.html` charge aujourd'hui React, React DOM, Framer Motion, tout le domaine et supabase-js, plus la feuille de style complète de l'application. Le principe 7 (« pas plus de 10 % de plus ») se mesure contre **158,9 ko**. Il y a beaucoup de marge à la baisse : c'est une amélioration à proposer en W5.

Mesure refaite par `npm run measure` à partir de W1.

---

## Constats

Tout ce qui ressemble à un défaut, trouvé en lisant ou en testant. **Rien n'est corrigé en silence** : un constat est soit figé tel quel par le filet (W1), soit corrigé dans un commit séparé et annoncé.

Sévérité : **haute** = Geoffrey ou un compagnon est gêné, **moyenne** = donnée fausse ou perdue dans un cas plausible, **basse** = confort ou code mort.

### Production et infrastructure

| Réf. | Constat | Sév. | Vérifié | Suite |
|---|---|---|---|---|
| P1 | Le service worker sert `index.html` à toute navigation hors `/api`. `/dispo.html?t=…` ne correspond pas à l'entrée précachée `dispo.html` à cause du paramètre `t`. Un compagnon qui a déjà ouvert un lien une fois (ce qui installe le service worker) reçoit l'écran de connexion de l'application la semaine suivante. | haute | oui, dans `dist/sw.js` | **corrigé** `32f5d86` |
| P2 | La fonction Edge est déployée sans `--no-verify-jwt` et sans `supabase/config.toml`, et ni le cron ni le `curl` n'envoient d'en-tête `Authorization`. La passerelle Supabase la rejette probablement. | haute | non (pas d'accès) | question 3 |
| P3 | `cron.sql` : l'URL modèle n'a pas de `https://`. Le planning `0 7 * * 6` est en UTC : 9 h à Paris l'été, **8 h l'hiver**. | moyenne | oui, dans le fichier | corrigé par construction en W3 (tâche en Europe/Paris) |
| P4 | La relance n'est pas idempotente pour ceux qui n'ont pas répondu : deux appels, deux e-mails. Le README affirme le contraire. | moyenne | oui, dans le code | **corrigé** dans l'API (W3) : `sent_at` + verrou Redis ; Supabase garde le défaut jusqu'à la bascule |
| P5 | Dépendances : `vite` 6.0.7 et son `esbuild` ont deux avis de sécurité, sur le serveur de développement seulement. | basse | `npm audit` | montée de Vite en W3/W4, avec le monorepo |
| P6 | La pile Docker ne servait pas l'application : nginx servait la page d'attente posée en W3, que W4 devait remplacer. `docker compose up` démarrait une API sans application, jamais servie derrière ce nginx ni sous sa politique de sécurité. | haute (pour W7) | pile montée en local, W8 | **corrigé** `c4985e6` |
| P7 | Sous la politique de sécurité de nginx (`style-src 'self'`), trois feuilles de style créées par le script étaient refusées (vaul, et Radix) : la feuille du bas perdait son `touch-action`, et ne se fermait plus d'un glisser sur l'iPhone. | moyenne | pile montée en local, W8 ; e2e (P7, projet pwa) | **corrigé** `3b4187b` (empreintes, pas `'unsafe-inline'`) |
| P8 | L'API arrêtée, nginx attendait 60 s qu'une connexion s'établisse (le réseau de Docker gardait l'ancienne adresse) : la page du compagnon restait une minute sur « Chargement… » avant « Connexion impossible », l'application sur « … ». | moyenne | recette W8 (J8), mesuré (504 en 60,0 s) | **corrigé** `9d73e54` (5 s ; 504 en 5,0 s) |

### Domaine (`src/domain.ts`)

| Réf. | Constat | Sév. | Vérifié | Suite |
|---|---|---|---|---|
| D1 | Après la passe d'échanges d'`optimizeWeek`, les raisons ne suivent pas les personnes échangées. Sur l'effectif de départ, 4 compagnons posés n'ont aucune raison affichée et 4 raisons désignent une affectation disparue. | moyenne | oui, par script | **corrigé** `3cd62a6` |
| D2 | Le bonus « débloque » de `scorePick` se déclenche sur `req` (tout le chantier) et non sur `soon` (étapes proches), contrairement à ce que dit le commentaire. Quentin reçoit « débloque menuiserie 5 » sur un chantier en démolition. | moyenne | oui, test de propriétés | évolution d'algorithme : décision du propriétaire, avant/après chiffré |
| D3 | L'objectif de la passe d'échanges ignore la continuité (`wasYesterday`) : un échange peut casser une équipe reconduite. | basse | lecture | à peser avec D2 |
| D4 | `pressure` divise un écart en millisecondes sans arrondir : sa valeur dépend du fuseau et du passage à l'heure d'hiver. | basse | oui, par exécution | figé : le golden master se calcule en Europe/Paris |
| D5 | `addMonths` déborde : un chantier commencé un 31 finit un mois trop tard (31 janvier + 1 mois = 3 mars). | basse | oui | figé |
| D6 | `setPhasePct(NaN)` écrit NaN ; `setTask` avec un indice hors bornes crée un tableau troué. | basse | oui | figé dans le domaine ; **refusé par l'API** (W3, 400) |
| D7 | `codeFromAddr("12 Audibert — apt 49")` donne `12AU49`, alors que le code réel est `12AB49`. Proposition modifiable, sans conséquence. | basse | oui | figé |
| D8 | Cibles de `optimizeWeek` : `loadLeft > 0.5` ; ailleurs, un chantier est fini à `< 0.5`. À exactement 0,5 il est à la fois fini et à pourvoir. | basse | lecture | figé |
| D9 | Code mort : `phaseTrades`, `dispoOf`, `fmtPhone` ; `permisSoon` calculé, jamais lu ; `bench` jamais lu par l'interface. | basse | lecture | ménage en W9 |
| D10 | Une date impossible passe la normalisation : `normSite({start:"2026-13-45"})` la garde, `span` rend `NaN-NaN-NaN`, et `optimizeWeek` ne pourvoit **jamais** ce chantier, sans rien dire. `"2026-02-30"` glisse au 2 mars. Même trou pour `normAvail().week` et les clés du plan. | moyenne | test unitaire | figé dans le domaine ; **refusé par l'API** (W3, 400) |
| D11 | Un chantier qui ouvre un mercredi reçoit du monde dès le lundi de sa semaine d'ouverture : le filtre des cibles compare des lundis. | basse | test unitaire | figé |
| D12 | « chantier en retard » s'affiche dès le premier jour d'un chantier neuf de deux mois : `pressure` vaut 1,38 (référence : un binôme à plein temps), alors que `neededHeadcount` le juge tenable à 3. | basse | test unitaire | à peser avec D2 (évolution d'algorithme) |
| D13 | `normEmail` tronque à 120 caractères **après** validation : une adresse trop longue ressort sans `@`. | basse | test unitaire | figé |
| D14 | `normPhone` accepte des numéros impossibles (« 06 12 34 56 78 12 » → `+061234567812`). | basse | test unitaire | figé |
| D15 | `codeFromAddr("Henri Desbals apt 7")` → `7HD7` : sans numéro de voie, le numéro d'appartement est pris deux fois. | basse | test unitaire | figé |
| D16 | `normAvail` ne contrôle pas `answeredAt` (un nombre passe). | basse | test unitaire | figé |
| D17 | `uid` peut rendre moins de 6 caractères aléatoires (`Math.random()` à 0,5 → `p_i`). | négligeable | test unitaire | W4 : identifiants par `crypto.randomUUID` |

D2 est **confirmé** par un test de propriétés (un peintre niveau 3 « débloque peinture 3 » sur un chantier en démolition). D3 est reproduit sur l'effectif de départ : Geoffrey et Erwan, reconduits le mardi, sont intervertis par la passe d'échanges.

### Persistance (`src/store.js`)

| Réf. | Constat | Sév. | Vérifié | Suite |
|---|---|---|---|---|
| S1 | **Écriture perdue pendant un envoi.** La ligne est figée avant l'`await`, puis le chemin est retiré de la file après. Une modification faite pendant la requête n'est jamais envoyée, et l'écho temps réel de l'ancienne version l'écrase. Cas typique : taper une note sur un réseau lent. | moyenne | oui, `store.js:336-370` | **corrigé** W4 (file de gestes) |
| S2 | Aucun verrou d'envoi : deux `flush()` peuvent tourner ensemble et arriver dans le désordre. | moyenne | lecture | **corrigé** W4 |
| S3 | Un seul minuteur pour le réessai du chargement (8 s) et celui des envois (6 s) : l'un annule l'autre. Le statut peut dire « À jour » sans que le serveur ait été relu ni le temps réel abonné. | moyenne | lecture | **corrigé** W4 |
| S4 | Dernier arrivé gagne sur la ligne entière : tout le plan d'un chantier est renvoyé à chaque geste. Deux appareils qui touchent le même chantier, même à des jours différents, s'écrasent. | moyenne | lecture, connu du README | serveur fait en W3 (opérations, verrou optimiste, fusion à trois voies) ; client en W4 |
| S5 | Pas de relecture après une coupure du temps réel. | basse | lecture | **corrigé** W4 (relecture à la reprise du temps réel) |
| S6 | Quota `localStorage` dépassé avalé en silence : la file hors ligne peut disparaître au rechargement. | basse | lecture | **corrigé** W4 |
| S7 | Cache ni lié au compte ni au projet : après une déconnexion puis la connexion d'un autre compte, la file locale est poussée chez lui. | basse | lecture | **corrigé** W4 |
| S8 | Une fiche refusée durablement bloque toute la file (arrêt au premier échec). | basse | lecture | **corrigé** W4 |
| S9 | Mode local : la file ne se vide jamais, la feuille Données annonce « N en attente d'envoi » et un bouton inutile. | basse | lecture | **corrigé** W4 |
| S10 | Lancement hors ligne avec un jeton expiré : risque d'écran de connexion au lieu du cache. | moyenne | non (probable) | **corrigé** W4 (pire que prévu avec Supabase : une demi-minute d'écran vide) |
| S11 | Code mort : `sendCode`, `verifyCode`, `extraireJeton`, `touchPerson`. | basse | lecture | **corrigé** W4 (retiré avec l'ancien magasin) |
| S12 | Un identifiant contenant `/` (possible par import) fait supprimer une autre ligne sur le serveur, et la sienne ne part jamais : la file découpe le chemin `table/id` au premier `/`. | moyenne | relecture W2, prouvé | **corrigé** W4 |

### Interface

| Réf. | Constat | Sév. | Vérifié | Suite |
|---|---|---|---|---|
| U13 | **Une fiche chantier ne se redessine pas après une écriture.** La mémorisation de `SiteCard` compare `a.site._rev` à `b.site._rev`, mais `a.site` et `b.site` sont le même objet, modifié sur place : les deux valeurs sont toujours égales. Un compagnon glissé sur un chantier est enregistré, mais n'apparaît sur la fiche qu'au prochain changement de jour ou d'ouverture. Introduit par `447621d` (7 septembre), donc en production. | haute | oui, `Chantiers.jsx:256-260`, et en e2e | **corrigé** `c70988a` |
| U14 | Page compagnon : au-delà de 300 caractères, la base reçoit le mot tronqué mais l'écran de confirmation affiche le mot entier. | basse | e2e | figé |
| U15 | Les toasts ne sont pas centrés : Framer Motion écrit son propre `transform` et écrase le `translateX(-50%)` du CSS. Sur iPhone 15, le toast part du milieu, bute sur le bord droit (196 px, quatre lignes) et recouvre le vivier pendant 2,8 s. | moyenne | e2e, capture | **corrigé** `97ec4d1` |
| U1 | **« Partager le brief » envoie le jour du lancement**, pas le jour affiché. `act` est mémorisé une fois ; `brief` garde la fonction du premier rendu. | haute | oui, `App.jsx:134-298` | **corrigé** `1920637` |
| U2 | La barre d'une étape ne suit pas le doigt : le cinquième argument (`setGlisse`) est perdu en route. | moyenne | oui, `Chantiers.jsx:87` et `:238` | **corrigé** `a780d07` |
| U3 | En mode connecté, la pastille du jour choisi n'est jamais dessinée (mesurée avant que la bande existe) : le libellé du jour devient presque invisible. | moyenne | non (probable) | **corrigé** W4 |
| U4 | Un simple appui sur une barre la met à 100 % (ou à 0). Geste non documenté. | basse | lecture | à discuter |
| U5 | Cartes chantier figées : renommer un compagnon ou recevoir une réponse ne met pas à jour les puces tant que le chantier ne change pas. | basse | lecture | **corrigé** W4 |
| U6 | `pointercancel` traité comme un relâchement : un glisser interrompu par le système dépose la puce. | basse | lecture, puis e2e (B4) | **corrigé** W6 |
| U7 | Import sans confirmation, destructeur côté serveur. | moyenne | lecture | **corrigé** W4 (confirmation) |
| U8 | Toasts injectés en HTML avec des noms non échappés. | moyenne | lecture | **corrigé** (gabarit `html`) |
| U9 | « Mot de passe oublié » ne fait jamais choisir un nouveau mot de passe. | moyenne | lecture | **réglé** : W3 côté serveur (ADR-002), l'écran a disparu en W4 |
| U10 | `prefers-reduced-motion` ne coupe que le CSS, pas les ressorts Framer Motion. | basse | lecture, puis e2e (K3 : 34 positions pour un toast) | **corrigé** W5 (`MotionConfig reducedMotion="user"`) |
| U11 | Ouvrir « Demander les dispos » crée les demandes en base et marque tout le monde « relancé » sans rien envoyer. | basse | lecture | **corrigé** W4 (liens créés à la demande) |
| U12 | README périmé : poids du moteur, `domain.js`, « connexion par code ». | basse | lecture | W9 |
| U16 | **Écran blanc** si un chantier ou un compagnon est supprimé sur un autre appareil pendant que sa fiche (« Modifier le chantier », « Composition », fiche compagnon) est ouverte ici : la feuille lit un objet disparu, et aucune barrière d'erreur React ne rattrape. | moyenne | relecture W2, prouvé en e2e (avant et après W2) | **corrigé** W4 |
| U17 | **Écran blanc au lancement** si `localStorage["geoplan.ui.v3"]` vaut `null` ; un onglet inconnu n'affiche aucun écran. L'état retenu n'est pas validé. | basse | relecture W2, prouvé | **corrigé** W4 |
| U18 | « Demander les dispos » : un compagnon supprimé pendant la préparation des liens fait planter la feuille. | basse | relecture W2 | **corrigé** W4 |
| V1 | En clair, l'îlot du vivier portait l'ombre faite pour le fond noir : la règle sombre visait `:root:not([data-theme="light"]) .island` sans *media query*, et rien ne pose `data-theme`. | basse | capture | **corrigé** `04102c6` |
| V2 | Un « – » seul sur sa ligne au-dessus de chaque mission d'une étape dépliée : le tiret de la liste ne tenait pas sur la ligne du libellé. | basse | capture | **corrigé** W5 (tiret retiré ; la case à cocher sert de puce) |
| V3 | Une puce soulevée pendant un glisser ne s'estompait pas : Framer Motion écrit l'opacité en ligne, qui l'emportait sur `.chip.lifted`. Même cause, l'estompe des fiches chantier inactives n'a jamais été visible. | basse | e2e | **corrigé** W5 (l'estompe des fiches inactives est retirée : elle aurait fait tomber leur texte sous le seuil AA) |
| V5 | Introduit par W6 (`b9899e6`) : une entrée se rejouait au deuxième rendu de la coque. Le libellé de la semaine glissait sans que la semaine change, l'écran refaisait son fondu peu après l'ouverture : leur classe d'entrée dépendait d'une référence relue à chaque rendu. Le libellé qui glissait couvrait 2 px de la flèche « Semaine précédente ». | basse | e2e (L2, une fois sur deux ; puis K6) | **corrigé** W6 (décidée à la naissance de l'élément) |
| V4 | Le fondu de sortie des onglets gardait l'ancien écran monté, sous la même clé, par-dessus le nouveau et encore actif sous le doigt ; revenu sur Chantiers, l'écran reprenait parfois le jour d'avant alors que la bande des jours en montrait un autre. | moyenne | e2e (A6, 1 fois sur 16) | **corrigé** `adf4612` (l'ancien onglet part d'un coup ; le nouveau entre toujours en fondu) |
| U19 | « Auj. » paraît à la place exacte de la flèche « Semaine suivante », qui glisse à gauche : deux appuis rapides pour regarder deux semaines plus loin ramènent à aujourd'hui. En production. | basse | relecture W5, e2e (A2) | **corrigé** `eaf22ef` (« Auj. » paraît avant la flèche ; les flèches ne bougent plus) |
| U20 | Une puce ne s'ouvre qu'au pointeur : au clavier, sa fiche (« Poser sur… », l'alternative au glisser) est hors d'atteinte. En production. | basse | relecture W5, e2e (L3) | **corrigé** `6b93b80` |
| U21 | Les champs des feuilles n'ont pour nom que leur texte d'exemple, qui disparaît à la première frappe ; « Début » n'en a aucun : le libellé n'est relié à rien. En production. | basse | relecture W5, e2e (L1) | **corrigé** `6b93b80` |
| U22 | Un toast prend le doigt. 2,8 s durant après chaque dépôt, il couvre le milieu du vivier ouvert : une puce lâchée là ne revient pas au vivier (le dépôt ne vise plus rien, sans un mot), une puce du vivier dessous ne se prend pas. En production. | moyenne | mesure W6 (un glisser sur quatre sans effet), e2e (B3) | **corrigé** W6 |
| V6 | Suite de V5, sources api et supabase : sans rien sur l'appareil (première connexion), la coque dessine d'abord l'attente ; le libellé de la semaine et « Auj. » naissaient au rendu suivant, après le « premier rendu », et entraient en glissant sans que rien n'arrive, en couvrant 2 px de la flèche « Semaine précédente ». | basse | e2e (K6 et trois L2, sources api et supabase, Chromium) | **corrigé** `02c7320` |
| U23 | Un glisser sur la barre d'une étape interrompu par le système (pointercancel) n'enregistrait rien, comme voulu depuis U6, mais la barre gardait l'aperçu du glisser (50 % affichés, 75 % enregistrés) jusqu'à ce que l'étape se replie. Préexistant : en production, la valeur était écrite en mémoire sans être envoyée. | basse | e2e (C4, Chromium ; test ajouté) | **corrigé** `5119290` |
| U24 | À la souris (Chromium : bureau, Android), un geste vertical parti de la barre d'une étape sélectionnait le texte des missions ; le glisser suivant emportait la sélection (un glisser-déposer du navigateur, qui interrompt le geste) au lieu de régler l'étape. | basse | e2e (C4, Chromium) | **corrigé** `05ce2a8` |
| U25 | Le champ de fichier de la feuille « Données » : 42 px de haut dans Chromium (44 au doigt attendus ; WebKit le dessine plus haut). | basse | e2e (L2, Chromium) | **corrigé** `b053840` |
| U26 | Un volet (étapes, missions, note, jours de « Répartir ») était une zone de défilement (overflow: hidden) : le focus, ou scrollIntoView, qui y entrait pendant qu'il s'ouvre le faisait défiler sur lui-même, puis le contenu redescendait image après image. Sous Playwright, le titre visé descendait entre l'appui et le relâché : rien ne se dépliait (C5, C6 contre l'API, 3 fois sur 40). | basse | e2e (C1 ajouté ; scénario rejoué 40 fois) | **corrigé** `cd88fcd` (overflow: clip) |
| U27 | **Un second doigt pendant un glisser** : posé sur une autre puce, il reprenait le glisser (Giorgi posé à la place de Nixon, qui restait estompé) ; levé n'importe où, il lâchait la puce sur la zone survolée. Le glisser ne lisait pas `pointerId`. Depuis la première version, et dans la barre d'une étape. | moyenne | relecture adversariale W6, e2e (B4) | **corrigé** `04810bc` |
| U28 | Au clavier ou avec VoiceOver, replier ou rouvrir le vivier faisait tomber le focus sur la page (le visage qui l'avait quitte le DOM 220 ms plus tard). | basse | relecture adversariale W6, e2e (L3) | **corrigé** `d2cfddb` |
| V7 | À la fin d'un repli, un volet repassait une image à pleine hauteur (226 à 894 px), environ une fois sur quatre : sans `fill`, l'animation rendait la hauteur « auto » le temps que React le retire. Introduit par W6. | basse | relecture adversariale W6, e2e (C2) | **corrigé** `25e1eff` |
| V8 | Introduit par ma correction d'U26 : `overflow: clip` ne contient pas les marges du contenu ; la ligne d'une étape sautait de 8 px au début d'un dépli et à la fin d'un repli, et faisait 2 px de moins au repos. | basse | relecture adversariale W6, e2e (C2) | **corrigé** `25e1eff` (`display: flow-root`) |
| V9 | La vague de « Répartir » débordait : pendant la seconde suivante, tout nom qui naissait entrait en vague — la semaine suivante, la grille rouverte (177 noms pour 35). Introduit par W6. | basse | relecture adversariale W6, e2e (E2) | **corrigé** `b8ac329` |
| V10 | Des entrées jouaient au premier affichage, contre l'ADR-006 : les puces du vivier à chaque lancement et à chaque ouverture, les noms de la grille à l'ouverture de l'onglet, l'écran de connexion. Hérité de W5 (le vivier, la grille), gardé par W6. | basse | relecture adversariale W6, e2e (K6) | **corrigé** `b8ac329` |
| V11 | Un second onglet touché pendant que le trait glisse : le trait sautait à l'onglet d'avant (260 px en une image), puis revenait. Introduit par W6. | basse | relecture adversariale W6, e2e (A4) | **corrigé** `e3b66a0` |
| V12 | Revenu par « Auj. » d'une semaine plus loin, le libellé entrait par la droite, comme si l'on avançait. | basse | relecture adversariale W6, e2e (A3) | **corrigé** `e3b66a0` |
| V13 | Au lancement connecté, la marque d'attente s'éteignait puis se rallumait (deux attentes à la suite). Préexistant. | basse | relecture adversariale W6, e2e (K6, sources connectées) | **corrigé** `b8ac329` |
| V14 | En développement seulement (StrictMode), un volet monté ouvert s'animait de sa hauteur à sa hauteur ; le témoin de K3 pouvait s'en contenter. | négligeable | relecture adversariale W6, e2e (E1, témoin K3) | **corrigé** `25e1eff` |
| U29 | Lancée sans réseau (ou le serveur injoignable), rien à envoyer : le bouton d'état disait « 0 en attente », en orange. Déjà dans l'ancienne version. | basse | recette W8 (H5), e2e (H1, sources api et supabase) | **corrigé** `02df60c` (« Hors ligne ») |

---

## Décisions

Les ADR sont dans `docs/reconstruction/decisions/`.

| N° | Décision | Workflow |
|---|---|---|
| ADR-001 | Schéma MySQL : une ligne par affectation ; la règle « un homme, un chantier, par jour » tenue par un index unique, que seule une urgence explicite lève | W3 |
| ADR-002 | Authentification : e-mail et mot de passe (argon2id), session de 180 jours glissants dans Redis, comptes créés sur le serveur, aucun lien ni code reçu | W3 |
| ADR-003 | Écritures : des opérations pour les affectations (fusion à trois voies pour l'équipe et le plan), verrou optimiste pour les fiches, idempotence, temps réel ciblé | W3 (serveur), W4 (client) |
| ADR-004 | Client : une interface `Depot`, trois sources, une file de gestes persistée par compte, TanStack Query pour l'instantané, Zustand pour l'interface | W4 |
| ADR-005 | Interface : Tailwind v4 sur des jetons à une seule source, primitives shadcn/ui (Drawer, Switch, Tabs), garde-fous CSS, accessibilité mesurée (contrastes AA, cibles de 44 px, 24 dans les grappes serrées) | W5 |
| ADR-006 | Mouvement : le CSS et Web Animations, sans bibliothèque ; Framer Motion retiré, GSAP essayé puis écarté (mesuré) ; le mouvement réduit coupe tout le décoratif ; son des gestes éteint par défaut ; pas de Three.js | W6 |

---

## Entrées

### W0 — Reconnaissance (2026-09-25)

**Fait.**
- Trois reconnaissances en parallèle : domaine, persistance et Supabase, interface.
- Deux affirmations de chaque rapport revérifiées dans le code ou par exécution :
  - domaine : les raisons désynchronisées après échange (D1, reproduit par script) ; le fuseau (Node sous Windows **respecte** un fuseau IANA fixé dans le processus ; c'est Git Bash qui ne transmet pas `TZ` : l'affirmation du rapport était fausse sur ce point) ;
  - persistance : le service worker (P1, lu dans `dist/sw.js`) ; l'écriture perdue pendant un envoi (S1, lu dans `store.js`) ;
  - interface : le brief figé (U1) ; la barre qui ne suit pas le doigt (U2).
- `GESTES.md` : la recette de W8. Chaque ligne du tableau « Au quotidien » y figure (A1, B1, B6, B3, C2, C3, C4, B15, B12, D1, A4, E1, F4, H1), plus le parcours complet de `dispo.html` (J1 à J11).

**Mesuré.** `npm run build` passe sur `364c67a` (tsc à zéro erreur, vite en 4 s). Poids ci-dessus.

**Outils.** Node 24.12, npm 11.6, TypeScript 7.0.2, Docker 29.6 (le démon ne tournait pas), Playwright absent, `gh` non connecté.

**Prochain geste.** W1.

### W1 — Le filet de sécurité (2026-09-25)

**Fait.** Branche `reconstruction/w1-filet`, 13 commits au-dessus de `main`.

| Filet | Contenu | Durée |
|---|---|---|
| Golden master | 16 semaines simulées (effectif réel, 5 chantiers à des stades différents, aléa à graine fixe, Europe/Paris) ; sortie complète figée | < 1 s |
| Unitaires (Vitest) | 279 tests, 100 % des lignes et 97,9 % des branches de `domain.ts` | ~7 s |
| Propriétés (fast-check) | 42 propriétés, dont les 10 invariants d'`optimizeWeek`, calendrier sous 3 fuseaux | ~8 s |
| Bout en bout (Playwright, WebKit, iPhone 15) | 101 tests, dont 3 qui figent encore un défaut connu | ~3 min |

Scripts : `npm test`, `npm run test:e2e`, `npm run sim`, `npm run measure`, `npm run typecheck`.

**Porte.** Tout vert sur le code d'origine avant tout correctif (`454089f` : aucun fichier de l'application modifié). Puis tout vert après les six correctifs (`de9b4a1` : 326 tests Vitest, 101 tests de bout en bout, typecheck, build).

**Relecture adversariale.** Un agent distinct a injecté 30 régressions plausibles. 23 étaient attrapées ; 7 survivaient, dont la plus grave (un glisser devenu impossible). Chacune a reçu son test, et les huit (plus le plancher, tenu par le seul golden master) ont été rejouées : toutes font échouer la suite.

**Défauts corrigés, un commit chacun, annoncés** : P1, U13, U1, U2, U15, D1. Pour D1, le golden master prouve que seules les raisons changent : 364 raisons comparées, 68 changées (34 orphelines supprimées, 34 manquantes ajoutées), tout le reste identique à l'octet.

**Mesuré.**

| | Avant (`364c67a`) | Après W1 |
|---|---|---|
| `index.html` | 120,6 ko | 120,7 ko |
| `dispo.html` | 159,3 ko | 159,4 ko |
| Indicateurs du scénario | posées 330, utiles 299, dépôt 368, reconduction 66,3 %, 101,3 j·h restants | identiques, raisons orphelines 34 → 0 |

(`npm run measure` : gzip -9 de ce que chaque page charge à l'ouverture. La mesure du journal W0, faite à la main, donnait 158,9 ko pour `dispo.html` ; l'outil fait foi.)

**Écarts au plan, et pourquoi.**
- Les trois agents de tests ont été interrompus par la limite d'usage de l'API, puis repris avec leur contexte. Aucun travail perdu.
- Le test de P1 ne pouvait rien prouver tel qu'écrit : une page contrôlée par un service worker échappe à l'interception de Playwright, et l'appel partait vers un domaine factice en `supabase.co`. Le serveur de test sert désormais un faux Supabase local, et le test échoue si une requête sort.
- Le filet est instable quand deux suites Playwright tournent en même temps sur cette machine (délais dépassés). Seul, il est stable : 3 passages consécutifs verts.

**Restent ouverts** : D2, D3, D12 (décisions d'algorithme, question 4) ; S1 à S11 (W4) ; U3 à U12 hors ceux corrigés ; U14 ; P2 à P5.

**Prochain geste.** W2.

### W2 — Fin de la migration TypeScript (2026-09-26)

**Fait.** Branche `reconstruction/w2-typescript`, 17 commits au-dessus de W1. Tout le client est en TypeScript strict : magasin, configuration, point d'entrée, douze composants, page compagnon, outils, configurations Vite et Playwright. `allowJs` est retiré : il n'y a plus une ligne de JavaScript à vérifier. Zéro `any`, zéro `@ts-expect-error`, zéro `@ts-ignore`.

**La méthode, et sa preuve.** « Renommer puis annoter, jamais réécrire. » Chaque écran converti a été construit et comparé octet par octet au paquet d'avant sa conversion : **identique** pour les douze composants, la page compagnon, les outils et les configurations, service worker et pages HTML compris. Les `!` et `as` ajoutés s'effacent à la compilation : ils ne peuvent rien changer à l'exécution. Seul le magasin (`store.ts`) a un peu changé de code : un upsert par table, des gardes « client absent », des branches par table au lieu d'un accès par clé.

**Porte.** `tsc` à zéro erreur (application, tests, outils) ; 326 tests Vitest ; 101 gestes de bout en bout ; construction.

| | Après W1 | Après W2 |
|---|---|---|
| `index.html` | 120,7 ko | 120,8 ko (+0,48 ko brut, le magasin) |
| `dispo.html` | 159,4 ko | 159,4 ko, identique à l'octet |

**Relecture adversariale.** Aucune régression prouvée. Le relecteur a chargé l'ancien et le nouveau magasin côte à côte, face à un faux Supabase, et joué 3 000 opérations aléatoires sur 20 graines (écritures, suppressions, temps réel, envois en échec, fusion, import, cache, connexion) : état identique après chacune. Écarts prouvés, tous bénins : un chemin de file corrompu (`constructor/x`) ne bloque plus toute la file ; en développement seulement, le double `init()` de StrictMode rattache l'écouteur de session autrement ; le bandeau du mode local cite `config.ts`. Défauts **préexistants** mis au jour : U16, U17, U18, S12 (ci-dessus).

**Lacune du filet, à combler en W4.** Aucun test ne passe par une session connectée : `start`, `merge`, `flush` et le temps réel ne sont couverts que par le test jetable de la relecture. W4 doit ajouter des gestes de bout en bout contre la source `api`.

**Écart au plan.** Le plan prévoyait un agent par composant « feuille ». Je les ai convertis moi-même : six fichiers de 94 à 164 lignes, pour lesquels la preuve octet par octet rend la relecture triviale, alors que six démarrages à froid auraient coûté cher et que la limite d'usage de l'API avait déjà interrompu W1.

**Instabilité.** Sous forte charge (deux suites Playwright en même temps), F3 et G4 ont échoué une fois (un élément supprimé encore affiché après 5 s). Non reproduit en 24 passages isolés ni sur la suite complète seule.

**Prochain geste.** W3.

### W3 — Monorepo et API (2026-09-26)

**Fait.** Branche `reconstruction/w3-api`, 25 commits au-dessus de W2, pas encore poussée.
- **Monorepo** : `packages/domain`, `apps/web`, `apps/api`, déplacés avec `git mv`. Le domaine gagne `operations.ts` : chaque geste écrit une fois, sans mutation, pour l'affichage immédiat du client (W4) et pour les tests qui confrontent l'API.
- **API** : Node 24, Express, MySQL 8.4 par Drizzle, Redis 7.4, Socket.IO, dans Docker derrière nginx. Tout ce que fait l'application passe par elle : comptes, fiches, affectations, lien compagnon, demandes de dispos, relance du samedi (9 h, heure de Paris), migration depuis Supabase.
- **Infrastructure** : `infra/` (compose, nginx, surcouche TLS, sauvegarde et restauration vérifiée), guide de déploiement pour le propriétaire.
- Trois ADR : schéma, authentification, synchronisation.

**Porte.**

| Critère | Résultat |
|---|---|
| `docker compose up` depuis un clone propre | API saine, nginx devant |
| Tests d'intégration (vrais MySQL et Redis, testcontainers) | 216 tests API ; avec le domaine, 547 verts et 3 échecs attendus |
| La règle « un homme, un chantier, par jour » | tenue par la base et prouvée sous concurrence : 50 poses simultanées dans la suite, 375 opérations concurrentes tirées au hasard par la relecture, aucun doublon hors urgence |
| API et domaine | mêmes plans et même avancement, geste après geste, vues à jour et périmées comprises |
| Relance du samedi | à blanc deux fois : « déjà faite » la seconde ; réelle, contre un faux Brevo : un e-mail par compagnon, jamais deux |
| Temps réel entre deux clients, à travers nginx | ≈ 25 ms |
| Conflit de version | 409 avec la fiche actuelle, rejeu du geste accepté |
| `/code-review xhigh` | 15 constats, tous corrigés (`3e113c5`) |
| `/security-review` | aucune vulnérabilité de haute confiance |
| Relecture adversariale | 13 constats prouvés, tous corrigés ; voir ci-dessous |
| Paquet de l'application | inchangé : 120,8 ko et 159,4 ko, comme après W2 |

**Relecture adversariale.** Un agent distinct a essayé de casser l'API, preuves à l'appui. Ce qui a tenu : la règle du jour sous 375 opérations concurrentes, le masquage des jetons dans un vrai nginx, l'idempotence d'un compte ou d'une route à l'autre, l'impossibilité d'énumérer les comptes.

Ce qui a cédé, corrigé un commit par thème, chaque correction avec son test, et chaque test vérifié en retirant la correction :

| Constat | Correction |
|---|---|
| « Remplacer l'équipe » et « Appliquer ce plan » effaçaient en silence ce qu'un autre appareil avait posé (haute) | ils portent `avant` ; le serveur n'applique que l'écart (fusion à trois voies, écrite dans le domaine) |
| Un compte supprimé en SQL gardait ses sessions 180 jours | une session ne vaut que si son compte existe ; `compte supprimer` |
| Redis plein : la réponse gardée par l'idempotence partait au journal, téléphone compris | le journal retire, pour tout appelant, les données qu'une erreur transporte |
| Un réimport ne supprimait rien : un compagnon parti restait relancé | migration en miroir, rapport à blanc d'abord |
| Lien expiré réutilisé : le compagnon recevait un lien mort | l'échéance est repoussée, même jeton |
| Réimport sans `version + 1` | une fiche changée avance d'une version |
| Jeton Supabase perdu si l'API avait créé la demande | le jeton de Supabase l'emporte, sauf lien de l'API déjà diffusé |
| Identifiants que l'API refuse, importés quand même | nommés au rapport, écriture refusée |
| L'amorçage vidait les plans de la base en service | il refuse une base non vide |
| « Urgence fantôme » après un doublon défait | l'affectation restante redevient normale |
| nginx joignable sans Cloudflare, adresse client falsifiable, port 80 en clair | nginx calcule l'adresse ; port 80 sur 127.0.0.1 ; vérifié sur une vraie pile |
| Clé de limitation en clair (le mot de passe tapé dans le champ adresse) ; IPv6 adresse par adresse | empreinte SHA-256 ; un /64 compte pour un |
| Révocation perdue entre la vérification et l'entrée dans la salle | la socket relit sa session une fois entrée |

Les trois soupçons (retrait avec chantier nul, 404 gardé sept jours, lecture de Supabase tronquée) sont réglés. Sur neuf risques non prouvés, sept sont réglés. Deux restent assumés :
- un envoi Brevo qui dépasse 15 s mais part quand même est compté en échec, et peut repartir à la relance suivante ;
- cinq échecs par quart d'heure bloquent aussi Geoffrey. C'est le compromis de l'ADR-002, à garder en tête le jour de la bascule.

**Écarts au plan, et pourquoi.**
- `drizzle-orm` figure aussi dans les dépendances de développement de la racine : sans cela, npm l'installait sous `apps/api`, où `drizzle-kit` ne le trouvait pas.
- Deux agents ont été interrompus par la limite d'usage, puis repris avec leur contexte. Aucun travail perdu.
- Un report de commit a laissé des marqueurs de conflit dans `modules.ts` ; corrigé aussitôt par `--amend`, avant tout envoi. Depuis, je cherche ces marqueurs avant chaque commit.

**Prochain geste.** W4.


### W4 — Le client : un dépôt, trois sources, TanStack Query et Zustand (2026-09-26)

**Fait.** Branche `reconstruction/w4-client`, partie de W3. L'ancien magasin (`store.ts`) est remplacé par ce que décide l'ADR-004 :
- une interface `Depot` et trois sources, `local`, `supabase` (la production jusqu'à la bascule) et `api`, choisies par `VITE_GEOPLAN_SOURCE` ;
- TanStack Query tient l'instantané du serveur ; une file ordonnée (Zustand) tient les gestes pas encore confirmés, chacun avec sa clé d'idempotence, persistée par source et par compte ;
- l'écran affiche l'instantané avec les gestes en file rejoués par le domaine, calculé hors de React et stabilisé : l'écran n'est prévenu que si ce qu'il montre change ;
- l'état d'interface est un magasin Zustand ; la coque ne lit que ce qu'elle affiche, toasts, feuilles et bouton d'état s'abonnent chacun au leur ;
- la page compagnon suit la même source, et ne charge plus supabase-js d'emblée ;
- l'API gagne `PUT /api/donnees` (restaurer une sauvegarde).

**Porte.**

| Critère | Résultat |
|---|---|
| W1 contre la source locale | 102 passés, 4 sautés |
| W1 contre Supabase (faux Supabase en mémoire, e2e/supabase/faux.ts) | 84 passés, 6 sautés |
| W1 contre l'API (vraie API, MySQL et Redis en conteneurs) | 92 passés, 6 sautés |
| Mode avion → gestes → retour du réseau → tout part une fois | automatisé contre l'API (S1 : un geste hors ligne attend, dit « 1 en attente », part au retour, une seule ligne en base) ; **l'essai sur l'iPhone reste à faire** |
| Images perdues par geste, non dégradées | tenu (tableau ci-dessous) |
| Relecture adversariale | 10 constats prouvés, tous corrigés ; voir ci-dessous |
| Tests unitaires | 36 pour le client (file des gestes, source api), 331 du domaine, API complète |

**Images perdues par geste** (npm run images-perdues : 100 gestes par version, alternés A/B dans la même session, Chromium bridé ×4 ; A = avant W4, B = W4) :

| Geste | A | B | Pire image p50, A → B |
|---|---|---|---|
| Changer de jour | 3,80 | 3,23 | 67 → 67 ms |
| Changer d'onglet | 18,44 | 18,54 | 200 → 200 ms |
| Cocher une mission | 1,31 | 1,34 | 33 → 33 ms |

Contrôle A contre A sur « cocher » : 0,65 contre 0,74 — l'ordre du bruit.

**Ce que la mesure a appris, et une erreur à dire.** Les premières mesures donnaient W4 perdant en « cocher » et en « jour ». Trois corrections de code en sont sorties, justes et gardées : la vue calculée hors de React et stabilisée (un geste confirmé ne redessine plus rien), les abonnements étroits de la coque, et l'envoi qui attend que le geste soit peint. Mais l'écart sur « jour » venait de **l'indicateur** : l'outil figeait la date avec `page.clock`, dont l'horloge remplace aussi requestAnimationFrame et les minuteries. Profiler les deux versions ensemble a montré l'écart dans le code de cette horloge. Sans elle, « jour » est meilleur dans W4. Les deux versions tournent aussi désormais dans des processus séparés (deux sites), et un contrôle A/A accompagne chaque mesure.

**Poids** (npm run measure, gzip -9, à l'ouverture ; l'outil suit maintenant les imports en profondeur sous un morceau chargé à la demande) :

| Page | Avant W4 | W4 | À la demande |
|---|---|---|---|
| `index.html` | 120,8 ko | 137,1 ko (construction supabase) · 136,5 ko (construction api) | source supabase 60,0 ko · source api 15,7 ko |
| `dispo.html` | 159,4 ko | 100,9 ko · 100,4 ko | supabase-js 57,9 ko, construction supabase seulement |

L'application prend 16 ko (TanStack Query, Zustand, la file) ; la page compagnon en perd 58 (principe 7 largement tenu). Chaque construction ne contient plus que sa source.

**Défauts corrigés** : S1, S2, S3, S5, S6, S7, S8, S9, S10 (pire que prévu avec Supabase : une demi-minute d'écran vide avant l'écran de connexion), S12 ; U3, U5, U7, U8, U9 (source api), U11, U16, U17, U18 ; D17. S4 reste le comportement de la source supabase, par choix (ADR-003). Passage sans perte : les modifications que l'ancienne version n'avait pas envoyées sont reprises dans la nouvelle file au premier lancement.

**Relecture adversariale.** Un agent distinct a essayé de casser W4, chaque constat prouvé par un test jetable qui échoue. Ce qui a tenu : la fusion des frappes d'une note ; `stabiliser` (3 000 tirages) ; aucun HTML injecté par un nom ; aucun secret dans les paquets ; un 401 au milieu de la file ; la règle du jour ; `remplacerTout` contre les deux serveurs ; un rechargement pendant un envoi ; une fiche supprimée pendant qu'elle est ouverte ; S10.

Ce qui a cédé est corrigé, chaque correction avec son test, et chaque test vérifié en retirant la correction :

| Constat | Correction |
|---|---|
| **Deux relectures qui se chevauchent effaçaient un geste confirmé** : disparu de l'écran, puis de la base avec Supabase au geste suivant sur le chantier (haute) | une liste des confirmations par lecture ; plus de champ commun remis à zéro |
| Une synchronisation arrêtée (déconnexion) continuait d'envoyer, jusqu'à pousser les gestes de Geoffrey sous la session d'un autre compte | arrêtée, plus rien ne part ni ne se relance ; un envoi en vol se termine, rien après lui |
| Deux onglets du même compte : chacun réécrivait sa file entière, le dernier effaçait les gestes de l'autre | la file stockée fait foi, relue avant chaque changement ; l'événement `storage` prévient l'autre onglet ; un seul onglet envoie à la fois (Web Locks) |
| Une fiche renvoyait tous ses champs : rejouée après un 409, elle écrasait ce qu'un autre appareil venait de changer (contraire à l'ADR-003) | seuls les champs changés depuis l'ouverture partent ; S4, contre la vraie API |
| Un 409 « existe déjà » bloquait la file pour toujours (création faite, réponse perdue, clé oubliée du serveur) | c'est un succès ; tout autre 409 imprévu est un refus |
| La coque suivait ce qui est déplié : déplier une note redessinait toute l'application (invariant 7) | chaque carte de chantier lit son propre état ; vérifié à la lecture, pas de test permanent |
| Fermée dans les 250 ms d'une confirmation, l'application rouvrait hors ligne sans le geste | l'instantané est écrit avant que la file ne lâche le geste |
| Reprise de l'ancienne file, stockage plein : les marques étaient effacées avant l'écriture de la nouvelle file | effacées après, et seulement si l'écriture a réussi |
| « Se déconnecter » hors ligne laissait la session valable (source api) | refusé, avec un message |
| Chaque construction précachait les trois sources : la construction api téléchargeait supabase-js (225 ko) | Rollup retire les sources non choisies |

Trois soupçons, réglés aussi : l'envoi resté en plan si l'application passe en arrière-plan entre le geste et l'image suivante (minuteur de secours) ; un plan de la semaine refusé en entier parce qu'un de ses chantiers a disparu ailleurs (le reste s'applique, comme le fait le domaine) ; une origine refusée (403) qui aurait jeté chaque geste (ils attendent). Assumés : la reprise d'une suppression de compagnon retire aussi son identifiant des plans, ce que l'ancienne version oubliait ; une file ne passe pas d'une source à l'autre, ce qui est à régler au moment de la bascule (W7) ; une réponse d'idempotence rejouée peut montrer un état un peu ancien jusqu'à la relecture suivante.

Une erreur à moi, rattrapée par le filet : le drapeau « arrêtée » ne se relevait pas au redémarrage. Or StrictMode arrête puis redémarre la même synchronisation en développement : plus rien ne partait. Les tests unitaires ne le voyaient pas, les tests de bout en bout l'ont vu. Un test unitaire couvre désormais ce cycle.

**Écarts au plan, et pourquoi.**
- Les mutations de TanStack Query ne servent pas de file (ADR-004 amendé) : elles ne persistent que les mutations en pause, et leur modèle optimiste défait les gestes suivants.
- Playwright tourne avec trois navigateurs au lieu de six : à six, WebKit s'arrêtait net et le serveur de test manquait de mémoire, sur W4 comme sur W3.
- L'importeur date chaque fiche créée d'une milliseconde de plus que la précédente (ordre d'une sauvegarde restaurée garanti).
- Chromium installé pour la mesure : seul lui sait brider le processeur.
- A1 a échoué une fois contre l'API, la machine chargée par ailleurs : l'appui tombait sur une puce qui glissait encore à sa place. L'aide `glisser` attend désormais une puce immobile ; trois sources rejouées ensuite, vertes.

**Restent ouverts** : U4 (un appui bascule une étape à 0 ou 100 %, à discuter), U6 et U10 (W6 ; K3 documente U10), U14 ; l'essai en mode avion sur l'iPhone.

**Prochain geste.** W5.

### W5 — L'interface : Tailwind, shadcn/ui, accessibilité (2026-09-27)

**Fait.** Branche `reconstruction/w5-ui`, partie de W4. Tout le dessin est en classes Tailwind v4, sur des jetons à une seule source (`jetons.css`, clair et sombre) ; l'ancienne feuille de 820 lignes a disparu. Les règles sont dans l'ADR-005.

- **Iso-visuel d'abord.** 42 captures de référence (chaque écran et chaque feuille, clair et sombre) prises avant de toucher à rien ; la conversion n'en a changé aucune. Les changements voulus sont venus ensuite, chacun dans son commit, avec la liste des captures changées et pourquoi. Depuis la relecture, la comparaison se fait au pixel près (voir plus bas).
- **Le socle et les briques communes, par moi** : Tailwind et ses couches, les jetons, la remise à zéro, `primitives/classes.ts` (boutons, surtitre, carte, cibles au doigt), la feuille du bas sur le **Drawer** de shadcn/ui (vaul, sur le Dialog de Radix), l'interrupteur sur le **Switch** de Radix. Les feuilles sont un morceau à part, chargé au repos : l'ouverture du planning ne le paie pas.
- **Un sous-agent par écran**, chacun dans sa copie, en deux vagues de trois : la coque et la connexion (avec les **Tabs** de Radix), Chantiers, les feuilles ; puis le vivier, Semaine et Équipe, la page compagnon. Deux fois interrompus par la limite d'usage, repris avec leur contexte. Chaque fusion vérifiée par les captures et le filet.
- **L'accessibilité, mesurée** (`npm run contrastes`, `e2e/accessibilite.spec.ts`) : contrastes AA en clair et en sombre, fonds teintés compris ; 44 px au doigt (24 au moins dans les grappes serrées, nommées ; les sept jours à 320 px) ; l'information jamais portée par la seule couleur ; un vrai nom sur chaque contrôle ; le focus visible et gardé dans la feuille ; le glisser doublé, au clavier aussi ; le mouvement réduit respecté jusque dans Framer Motion.
- **Garde-fous** : `npm run verifier-css` (collisions entre classes, animations en double, CSS mort, classes fabriquées depuis des mots qui n'en sont pas ; il lit les chaînes du code) ; `tests/classes-chaudes.test.ts` (le prix d'un restyle, ci-dessous) ; les captures au pixel près ; les tests trouvent les éléments par rôle ou attribut, plus par classe.

**Porte.**

| Critère | Résultat |
|---|---|
| Différences avec les captures de référence, toutes expliquées | la conversion : aucune. L'ombre de l'îlot (V1, `04102c6`) : 5 images en clair. L'accessibilité : 40 images — 18 relevées dans `c176075`, 22 que la tolérance de Playwright cachait, relevées et expliquées une à une dans `613ce83` (avec le logo rendu à son orange : 16 images, 56 pixels chacune). La relecture : deux images nouvelles (« Auj. » à sa place). Tout le reste identique au pixel. |
| W1 contre la source locale | 122 passés, 4 sautés (20 tests de plus qu'en W4 : accessibilité L1 à L3, onze ; K3 et K4, cinq ; A2, deux ; B1 et C5) ; captures : 32 tests, 44 images, au pixel près |
| W1 contre Supabase (faux Supabase en mémoire) | 103 passés, 7 sautés |
| W1 contre l'API (vraie API, MySQL et Redis en conteneurs) | 111 passés, 7 sautés |
| Taille du paquet principal et de `dispo`, mesurée et consignée | tableau ci-dessous |
| Aucun CSS mort | `verifier-css` : aucune collision, aucune animation en double, aucune classe morte ni fabriquée par mégarde (500 classes Tailwind et 6 classes d'état dans la feuille principale, 104 dans celle de la page compagnon). Hors des classes, deux petites feuilles justifiées : `mouvement.css` (six animations nommées, le mouvement réduit), `etats.css` (six classes que le glisser pose hors de React) |
| Images perdues par geste, non dégradées | tenu après correction : onglet et cocher à égalité (cocher, trois séries : −0,02, −0,02 sur 200 gestes, +0,12) ; il reste +0,2 image au changement de jour, pire image identique (tableau ci-dessous) |
| Relecture adversariale | 17 constats prouvés, tous corrigés (ci-dessous) |
| Tests unitaires | 41 pour le client (dont le garde-fou des restyles) ; 331 du domaine (et ses 3 échecs attendus, D2, D5, D6) et 221 de l'API, que W5 ne touche pas ; types vérifiés partout |

**Poids** (npm run measure, gzip -9, à l'ouverture) :

| Page | Avant W5 | W5 | À la demande |
|---|---|---|---|
| `index.html` | 137,1 ko (construction supabase) · 136,5 ko (construction api) | 147,5 ko · 147,0 ko | feuilles 27,9 ko ; source supabase 60,4 ko · source api 15,7 ko |
| `dispo.html` | 100,9 ko · 100,4 ko | 97,3 ko · 96,6 ko | supabase-js 58,3 ko, construction supabase seulement |

L'application prend 10 ko, surtout les onglets et l'interrupteur de Radix (focus itinérant, clavier, rôles) ; les feuilles, qui en auraient pris 27 de plus, restent à part. La page compagnon en perd 3,5 : elle ne charge plus que ses propres règles (2,7 ko de CSS au lieu de toute la feuille) et deux petits modules (principe 7 largement tenu : 97 ko contre 158,9 de référence). Aucun budget n'est fixé pour `index.html` : question au propriétaire s'il en veut un.

**Images perdues par geste** (npm run images-perdues : 100 gestes par version, alternés A/B dans la même session, Chromium bridé ×4 ; A = W4, B = W5 ; l'outil vérifie désormais que chaque geste a son effet dans les deux versions) :

| Geste | Première mesure, W4 → W5 | Après correction, W4 → W5 | Fin de W5, W4 → W5 |
|---|---|---|---|
| Changer de jour | 4,17 → **6,43** | 2,61 → 2,88 | 2,93 → 3,11 |
| Changer d'onglet | 15,93 → 16,34 | 15,12 → 15,29 | 16,56 → 16,48 |
| Cocher une mission | 1,01 → **1,51** | 0,85 → 0,83 | 0,64 → 0,76 |

Contrôle A/A sur « cocher », 200 gestes : 1,18 contre 1,21. D'une session à l'autre, le niveau absolu varie du simple au double (1,18 puis 0,47 pour la même version) : seule l'alternance dans une même session compare quelque chose ; chaque colonne se lit pour elle-même.

**Ce que la mesure a appris.** La conversion avait rendu W5 moins fluide que W4, sans rien changer aux animations. L'indicateur d'abord soupçonné, puis mis hors de cause : l'outil vérifie désormais que chaque geste a son effet dans les deux versions (un clic ignoré aurait passé pour parfaitement fluide), et la règle universelle de repli que Tailwind émet pour les vieux navigateurs (`*, ::before, ::after`, une quarantaine de variables) ne s'applique pas dans Chromium. Le profil a trouvé deux causes :
- **changer de jour** restyle à chaque image la puce qui glisse à sa place et l'îlot qui change de taille (80 % des restyles, les mêmes qu'en W4), et chacun coûtait moitié plus : Tailwind écrit ses classes avec des variables (`calc(var(--spacing) * n)`), et bordure, ombre, flou, graisse, transition composent des propriétés déclarées (`@property --tw-*`), que le navigateur résout à chaque restyle. Les valeurs du thème sont figées ; les pièces redessinées à chaque image écrivent ces propriétés directement, au même dessin (ADR-005, « Le prix d'un restyle »). Calcul des styles par changement de jour : 161 → 126 ms (W4 : 122) ;
- **cocher une mission** redessine la coque (ses compteurs), et avec elle ses dix onglets : de simples boutons en W4, des onglets Radix en W5. La bande des jours et la barre des onglets sont mémorisées. Script par geste : 62 → 54 ms (W4 : 52).

Il reste, sur « changer de jour », +0,2 image (trois séries : +0,19, +0,27, +0,18) pour une pire image identique : les sept onglets de Radix (focus itinérant, Slot) que la bande redessine à chaque jour choisi. C'est le prix des onglets accessibles ; W6, qui reprend les animations, part de cette mesure.

Une hypothèse fausse, à dire : j'ai d'abord accusé les zones invisibles de 44 px de l'étape d'accessibilité (un `::after` par puce). W5 juste avant cette étape coûtait déjà autant : la conversion était seule en cause.

**Relecture adversariale.** Un agent distinct a essayé de casser W5 (interrompu une fois par la limite d'usage, repris). 17 constats prouvés, tous corrigés ; chaque correction a son test, vérifié en retirant la correction.

| Constat | Correction |
|---|---|
| **La zone de toucher de la barre d'une étape couvrait l'espace, mort en W4, avant la première mission** : un appui en visant la mission basculait l'étape à 100 %, ou la remettait à 0 en décochant tout (haute) | le simple appui ne bascule que dans la barre dessinée ; dans sa zone, on peut la glisser |
| Au clavier, le focus sortait de la feuille ouverte vers la page cachée ; Entrée y changeait la semaine | le focus va à la feuille elle-même à l'ouverture (pas à un champ : pas de clavier sur l'iPhone) |
| Une puce ne s'ouvrait qu'au pointeur : « Poser sur… », l'alternative au glisser, hors d'atteinte au clavier (U20, déjà en W4) | une puce activée sans pointeur ouvre sa fiche |
| Les captures gardaient la tolérance de Playwright : un vrai changement de teinte passait ; l'étape d'accessibilité avait changé 40 images, pas 18 | comparaison au pixel près ; les 38 images d'écart expliquées une à une |
| Des couples de contraste affichés échouaient (le « +N » de la semaine : 4,2:1 ; le titre d'une zone survolée en urgence : 4,4) ; l'outil ne voyait que des fonds unis | l'outil mesure les fonds teintés ; « +N » à l'encre des initiales, rose de la zone à 11 % |
| Les champs n'avaient pour nom que leur texte d'exemple ; « Début » aucun (U21, déjà en W4) | le libellé nomme la saisie, ou le groupe ; L1 passe dans chaque feuille |
| Si le morceau des feuilles ne se chargeait pas (après un déploiement, hors ligne), tout le planning cédait la place à l'écran d'erreur | chargé au repos ; une barrière à lui dit de recharger, le planning reste |
| La garde de 260 ms (le doigt qui relève une puce) ne gardait plus rien : Radix écrit `pointer-events` en ligne | en style, comme en W4 |
| Le sous-titre d'une feuille n'était jamais annoncé | description rétablie |
| Du CSS mort que le garde-fou ne voyait pas : variantes de puce (mortes depuis W4), règles fabriquées depuis des commentaires et des mots-clés, alias de thème | le garde-fou lit les chaînes du code ; retirés, ou exclus avec leur raison |
| Le garde-fou des restyles laissait passer `border-[1.5px]`, `border-dashed`… ; ne voyait aucune barre d'étape ; ignorait le fantôme et le toast | complété ; fantôme et toast en propriétés directes |
| À 320 px, les zones des sept jours mordaient sur le jour voisin | zones de rangée ; L2 tourne aussi à 320 px |
| Les onglets fermés désignaient un panneau absent | `aria-controls` retiré |
| Le logo avait pris l'orange foncé des boutons, pas celui de l'icône d'écran d'accueil | jeton `--marque`, l'orange de W4 |
| Fermer une feuille en la glissant n'était testé nulle part ; L3 ne vérifiait pas qu'un anneau de focus se voit (dix rognés, « Ouvrir le vivier » entièrement) | test K4 ; anneau intérieur là où il était rogné, mesuré par L3 |
| L'ADR citait un journal pas encore écrit ; deux commentaires périmés (Framer Motion et le mouvement réduit) | journal, commentaires et GESTES.md à jour |
| « Auj. » prenait la place de la flèche : deux appuis rapides ramenaient à aujourd'hui (U19, déjà en W4 ; cause probable du seul échec intermittent d'A2) | « Auj. » paraît avant la flèche ; les flèches ne bougent plus |

Ce qui a tenu : le métier (rien de changé dans le domaine, les données, l'API, ni dans les gestes hors la bascule de la barre) ; W1 ; la conversion au pixel (les jetons de W4 remis dans W5 : identique, aux changements annoncés près) ; les états pendant un glisser, relus dans le navigateur ; le toucher et le clavier des onglets ; aucun état périmé dans les barres mémorisées ; aucun vol d'appui entre commandes, à 393 et à 320 px ; les toasts audibles sous une feuille modale ; la page compagnon (97 ko, ni vaul ni Radix) ; aucun secret dans les paquets ; aucune classe Tailwind ignorée en silence ; aucune animation nouvelle, hors celle de vaul qui remplace l'ancienne feuille.

Soupçons laissés ouverts, et où ils seront vérifiés : les chemins de vaul propres à iOS (blocage du défilement, feuille qui se replace quand le clavier monte) ne tournent pas sous Windows — à essayer sur l'iPhone (W8) ; un double appui de VoiceOver sur une puce passe désormais par le même chemin que le clavier, à confirmer sur l'iPhone ; le glisser, les toasts, le vivier qui s'ouvre et la feuille qui monte n'ont pas encore leur mesure d'images perdues (W6 ajoute ces gestes à l'outil).

Une erreur à moi, rattrapée par le filet de la porte : ma correction d'U21 faisait d'un libellé le nom d'un groupe dès qu'il annonçait plusieurs contrôles. Le sélecteur de jours d'une fiche, déjà un groupe, se retrouvait dans un second au nom presque identique ; B6 comptait neuf boutons au lieu de sept, sur les trois sources. Un groupe seulement pour plusieurs saisies (`02eb1e7`).

**Défauts trouvés et corrigés** : V1 (l'îlot portait en clair l'ombre faite pour le fond noir), V2 (un « – » seul sur sa ligne au-dessus de chaque mission), V3 (une puce soulevée d'un chantier ne s'estompait pas : l'opacité en ligne de Framer l'emportait), V4 (le fondu de sortie des onglets gardait l'ancien écran monté, et touchable, par-dessus le nouveau), U10 (les ressorts de Framer Motion ignoraient le mouvement réduit), U19, U20, U21 (en production, trouvés par la relecture).

**Écarts au plan, et pourquoi.**
- Pas de tailwind-merge ni de cva : une variante se demande à la fonction qui dessine (`bouton({ teinte, taille })`) ; elle ne s'obtient pas en ajoutant une classe contraire, dont l'ordre déciderait. Moins de poids, et aucun conflit caché.
- Le fondu de sortie des onglets est retiré (V4) : une animation en moins, parce qu'elle causait un défaut ; le fondu d'entrée reste.
- 44 px au doigt partout où c'est possible sans changer le dessin ; dans les grappes serrées, 24 px au moins (WCAG 2.5.8). Les agrandir est une décision de dessin : question au propriétaire.
- Quelques pièces écrites hors des classes ordinaires de Tailwind (la puce, l'îlot, le remplissage des barres, le fantôme, le toast), pour le prix d'un restyle, mesuré.
- Des mesures d'abord fausses, corrigées avant d'en tirer quoi que ce soit : un test marqué « doit échouer » (K3) échouait pour une autre raison que la sienne ; le relevé des cibles au doigt mesurait sous l'îlot, sous la barre d'onglets, et pendant la montée d'une feuille (sous WebKit, sa position ne bouge pas d'une image à l'autre pendant l'animation CSS) ; l'outil des images perdues cliquait des onglets qui choisissent à l'appui ; les captures toléraient un écart de teinte ; B5 mesurait l'avertissement depuis le premier toast, qui attend le rendu du lâcher (2 789 ms pour 2 900 sur une machine chargée) : il mesure depuis le lâcher (`1fd1002`), et échoue toujours si l'avertissement part aussitôt (vérifié : 60 ms).
- Trois échecs intermittents pendant W5, chacun expliqué : A2, une fois sur un filet complet, dont la relecture a trouvé la cause probable (U19, corrigée) ; B5, une fois sous charge, un indicateur faux (ci-dessus) ; C1 et C2, sur un passage contre l'API pendant lequel la machine s'est mise en veille (1,2 h pour C1, puis la liste repliée de C2 restée à l'écran). Ce passage relancé en entier : vert ; C1 et C2 rejoués ensuite dix fois chacun contre l'API : 20 sur 20.

**Restent ouverts** : U4 (un appui bascule une étape à 0 ou 100 %, à discuter), U6 (un glisser interrompu par le système dépose la puce), U14 ; les grappes serrées à 24 px ; l'essai en mode avion sur l'iPhone (W4).

**Prochain geste.** W6.

### W6 — Le mouvement (2026-09-28)

Branche `reconstruction/w6-mouvement`, partie de W5. Les règles sont dans l'ADR-006.

**L'inventaire, au départ.** Vingt-cinq mouvements, par trois mécanismes : Framer Motion (JS, image par image), le CSS (le compositeur), vaul (CSS).

| Mouvement | Où | En W5 | Geste mesuré |
|---|---|---|---|
| Pastille du jour choisi | coque | Framer, ressort sur x | jour |
| Trait sous l'onglet | coque | Framer, `layoutId` (remesure toute la mise en page) | onglet |
| Libellé de la semaine | coque | Framer, entrée et sortie croisées | semaine |
| « Auj. » | coque | Framer, entrée et sortie à l'échelle | semaine, jour |
| Fondu d'un onglet | coque | Framer, opacité | onglet |
| Attente au démarrage, point d'envoi | coque | CSS | — |
| Fiche de chantier | Chantiers | Framer, entrée et sortie (après le premier affichage) | — |
| Puce posée | Chantiers | Framer, `layout`, entrée et sortie | jour, glisser |
| Indice d'une zone vide | Chantiers | Framer, fondu | jour |
| Missions d'une étape | Chantiers | Framer, hauteur `auto` | déplier |
| Coche d'une mission | Chantiers | **Framer et CSS, en double** | cocher |
| Barre d'étape | Chantiers | CSS (largeur, hauteur, `barGrow`) | cocher |
| Volets (« Les 12 étapes », note, jours de « Répartir ») | briques | Framer, hauteur `auto` ; chevron en CSS | — |
| Îlot du vivier | vivier | Framer, `layout` (sa forme), fondu des deux visages ; rayon en CSS | vivier |
| Puce du vivier | vivier | **Framer (`layout`, entrée, sortie) et CSS (`chipIn`), en double** | jour, glisser |
| Toast | briques | **Framer (entrée, sortie) et CSS (`fade`), en double** | glisser |
| Ligne de l'équipe | Équipe | Framer, `layout` et fondu | onglet |
| Initiales de la grille | Semaine | **Framer et CSS (`chipIn`), en double** | répartir |
| « Composer » : rangées en cascade, barres de couverture | feuilles | Framer | — |
| Connexion : changement de mode, message | connexion | Framer | — |
| Page compagnon : appui, coche, message | dispo | Framer | — |
| Feuille du bas | vaul | CSS | feuille |
| Fantôme sous le doigt | glisser | styles en ligne à chaque mouvement | glisser |
| Survol d'une zone, de l'îlot | glisser | CSS (fond, bord) | glisser |
| Appui (puce, onglets, boutons) | partout | CSS `:active` | tous |

Et une transition CSS sur `transform` de la puce (pour l'appui), que chaque écriture de `layout` relançait (piste laissée par W5).

Soupçon réfuté, à dire : j'ai cru qu'une animation sans fin (le point d'envoi) clignoterait sous le mouvement réduit, ramenée à 0,01 ms et répétée sans fin. Non : WebKit compte le temps des animations en millisecondes entières, chaque image tombe sur la même phase, le point reste fixe (opacité 1) ; Chromium le fige aussi (0,94). Le test écrit pour le prouver ne pouvait pas échouer : retiré.

**L'outil de mesure, d'abord.** Six gestes de plus (`272aa8a`) : glisser, vivier, semaine, feuille, déplier, répartir. Contrôle A/A (W5 contre W5, 50 gestes par version) :

| Geste | A | A | Écart |
|---|---|---|---|
| glisser | 10,28 | 10,42 | 0,14 |
| vivier | 3,16 | 3,54 | 0,38 |
| semaine | 31,34 | 32,84 | 1,50 |
| feuille | 7,02 | 7,26 | 0,24 |
| déplier | 12,28 | 12,32 | 0,04 |
| répartir | 20,46 | 21,82 | 1,36 |

Sa vérification d'effet a aussitôt trouvé U22 (un glisser sur quatre restait sans effet) : le toast prenait le doigt, en production aussi. Corrigé (`f625adb`).

**La coque sans Framer Motion.** La pastille du jour : une transition CSS. Le trait sous l'onglet : il vit dans l'onglet actif, et glisse depuis l'ancien par une translation que joue le compositeur (Web Animations) ; plus de `layoutId`, qui faisait remesurer toute la mise en page. Le libellé de la semaine, « Auj. », le fondu d'un onglet : des animations CSS. Au repos, rien ne change (captures identiques au pixel) ; les sorties du libellé et d'« Auj. » ne sont plus jouées (ADR-006, « Sorties »).

| Geste | W5 | W6 | Écart |
|---|---|---|---|
| jour | 5,34 | 4,46 | −0,88 |
| onglet | 20,74 | 19,56 | −1,18 |
| semaine | 31,98 | 33,92 | +1,94 |
| semaine, 100 gestes | 29,21 | 30,44 | +1,23 |
| semaine, 100 gestes, deux animations nommées | 28,67 | 30,15 | +1,48 |

« Jour » et « onglet » gagnent, comme attendu : plus de ressort en script sous la pastille, plus de remesure de toute la page sous le trait. « Semaine » perd un peu, trois fois de suite (+1,2 à +1,9 image), à la limite du bruit (A/A : 1,5) ; la cause n'est pas trouvée. Soupçonnée d'abord : la variable dans les images clés du libellé (`var(--sens)`), qu'un compositeur pourrait refuser. Remplacée par deux animations nommées : l'écart reste. Le changement de semaine coûte trente images, presque toutes au rendu des fiches, dont les puces quittent Framer à l'étape suivante : on le remesure après, et on le profile s'il tient.

**Chantiers sans Framer Motion.** Une puce posée entre en CSS (`chipIn`), quand elle arrive après le premier affichage de sa fiche (un jour choisi, un dépôt) ; elle ne glisse plus à sa place à chaque rendu (`layout`) et ne s'efface plus en partant. Une fiche ouverte pendant qu'on regarde entre en CSS (`carte-in`). Les missions d'une étape et les volets se déplient et se replient par un composant à nous (`Repli`) : le navigateur joue la hauteur (Web Animations), plus de script à chaque image. La coche n'est plus animée qu'une fois (CSS). Au repos, rien ne change (captures identiques au pixel) ; filet local : 123 passés, 4 sautés.

| Geste | Coque | Chantiers | Écart |
|---|---|---|---|
| jour | 8,24 | 7,00 | −1,24 |
| onglet | 19,32 | 18,70 | −0,62 |
| cocher | 0,44 | 0,40 | −0,04 |
| déplier | 8,38 | 4,22 | **−4,16** |
| glisser | 6,00 | 4,50 | −1,50 |
| semaine, 100 gestes | 26,29 | 21,07 | **−5,22** |

(Même session, alternés ; d'une session à l'autre, le niveau absolu varie du simple au double, comme en W5 : « jour » valait 4,46 pour la coque une heure plus tôt.) Le changement de semaine regagne largement ce que la coque lui avait coûté.

**Le vivier, et GSAP essayé.** La mission voulait GSAP pour la déformation du vivier. Deux versions de la forme de l'îlot, même durée (400 ms), même courbe : GSAP Flip (chargé au repos, 36,6 ko gzip hors du paquet principal), et le même principe en Web Animations (`ui/mouvement/forme.ts`) :

| Geste | GSAP Flip | Web Animations |
|---|---|---|
| vivier | 1,86 | **0,44** |

GSAP calcule chaque image en script, comme Framer ; le navigateur, non. Et son horloge est `Date.now`, que le filet fige : dans les tests, toute animation GSAP resterait à sa première image. Il n'est donc pas retenu (ADR-006, question 8). L'îlot passe à Web Animations, ses puces au CSS seul (elles portaient Framer et `chipIn` en double) ; il ne réinterpole plus sa taille quand son contenu change (un jour choisi, une puce qui part) :

| Geste | Chantiers | Vivier |
|---|---|---|
| vivier | 2,22 | 0,14 |
| jour | 2,78 | 0,74 |
| glisser | 5,56 | 2,94 |

**Le reste de l'application sans Framer Motion.** Le toast entre et s'éteint en CSS (`toast-in`, `toast-out`) : il passe « en sortie » à 2,8 s et part 180 ms plus tard (Framer et `fade` l'animaient en double). Une ligne de l'équipe ajoutée pendant qu'on regarde entre en fondu ; la liste qui se retrie change d'un coup. Les initiales de la grille Semaine gardent leur seule animation CSS (`chipIn`). « Composer » : les rangées en cascade (`rangee-in`, 40 ms de décalage, sans décalage sous le mouvement réduit), les barres de couverture qui poussent depuis la gauche (le compositeur) puis suivent l'équipe par leur largeur. La connexion : chaque mode entre (`carte-in`), le message aussi (`message-in`). Le test K3 du toast guettait les écritures de style en ligne de Framer : en CSS il n'y en a plus, il serait passé sans rien prouver. Il relève maintenant la forme du toast image après image (une seule sous le mouvement réduit), avec son témoin (K5 : plusieurs).

| Geste | Vivier | Cette étape | Écart |
|---|---|---|---|
| glisser | 5,20 | 3,68 | −1,52 |
| onglet | 16,18 | 7,28 | **−8,90** |
| répartir | 24,86 | 11,64 | **−13,22** |

Les initiales de la grille Semaine étaient une centaine de composants Framer, chacun avec son ressort en script : ouvrir l'onglet Semaine et appliquer un plan coûtent maintenant moitié moins.

Deux indicateurs faux, dans mes propres tests, avant de les croire : relever la forme d'un toast image après image ne dit rien sous WebKit (`getComputedStyle` rend la même valeur pendant 120 ms d'une animation CSS que joue le compositeur) — le test lit la durée calculée, comme les autres tests K3 ; et sonder depuis le test l'extinction d'un toast (180 ms) la manquait — elle est suivie dans la page, image après image. Et un échec groupé, non expliqué : au premier passage de cette étape, trois tests de « Répartir » (E1, E1, E2) ont échoué ensemble (la feuille ne paraissait pas, un jour ne devenait jamais cliquable) ; au second passage, et 25 fois de suite sous charge, ils passent. Erreur de méthode : j'avais relancé le fichier avant de mettre la trace à l'abri. À surveiller à la porte.

**Framer Motion retiré.** La page compagnon passe au CSS : l'appui (`:active`), la coche (une transition sur l'état du bouton), le message d'échec (`message-in`). `MotionConfig` et `ui/ressorts.ts` partent, la dépendance aussi (trois paquets). La règle du mouvement réduit et l'entrée d'un message vivent dans `mouvement-commun.css`, la seule feuille de mouvement que la page compagnon importe. Poids (`npm run measure`, construction supabase, gzip -9, à l'ouverture) :

| Page | W5 | W6 | Écart |
|---|---|---|---|
| `index.html` | 147,5 ko | 110,9 ko | −36,6 ko |
| `dispo.html` | 97,3 ko | 59,7 ko | −37,6 ko |

L'application pèse moins qu'avant la reconstruction (120,3 ko) ; la page compagnon, 38 % de sa référence du principe 7 (158,9 ko). Elle ne se mesure pas en images perdues : en source locale, elle n'a rien à montrer (« Application non configurée ») ; ses trois mouvements, passés du script au CSS, sont gardés par ses tests et ses captures. Le README cite encore Framer Motion : il est à réécrire en W9.

Une erreur à moi, rattrapée par le filet : en passant la coque au CSS, j'ai fait dépendre la classe d'entrée du libellé de la semaine, d'« Auj. » et du panneau d'une référence relue à chaque rendu (`premierRendu`). Au deuxième rendu de la coque, la classe s'ajoutait à des éléments déjà là, et leur animation se jouait sans raison (constat V5). Partout ailleurs, l'entrée était déjà décidée à la naissance de l'élément (`useEntree`) ; pas là. L2 l'a vue, une fois sur deux : le libellé qui glissait couvrait 2 px de la flèche voisine. K6 note chaque animation qui démarre depuis le chargement : sans la correction, deux entrées démarrent alors que rien n'arrive ; avec, aucune. L2 : 6 sur 6.

**U6, puis le lâcher.** Un glisser interrompu par le système ne pose plus rien (`f1e469f`). Puis le premier mouvement ajouté : au lâcher, le fantôme ne disparaît plus d'un coup. Il va se poser là où la puce paraît (sa zone, le vivier), invisible le temps du vol (`.chip.atterrit`) : c'est lui qui devient elle. Lâchée hors de toute cible, ou geste interrompu, il revient à la puce soulevée, qui reprend sa couleur à son retour : on voit que rien n'a été posé. 240 ms, joué par le compositeur (`ui/mouvement/atterrissage.ts`) ; sous le mouvement réduit, rien ne vole.

| Geste | Sans vol | Avec vol |
|---|---|---|
| glisser | 2,40 | 2,26 |

Dans le bruit (A/A : 0,14) : le vol ne se paie pas. Tests : B1 (il vole, la puce d'arrivée paraît à son arrivée), B4 (il revient), K3 (rien ne vole) ; chacun échoue quand on retire ce qu'il garde.

**Le vivier qui se déforme.** Une puce posée qu'on glisse au-dessus du vivier le gonfle un peu depuis son coin (il vient au-devant d'elle) ; elle repart, ou y tombe, il reprend sa forme. Web Animations sur `transform`, repris à l'envers s'il est interrompu (`ui/mouvement/vivier.ts`). Une première version l'écrasait au lâcher, comme s'il avalait la puce ; mesurée, elle se payait, et c'est l'écrasement qui coûtait, pas le gonflement :

| Geste | Sans déformation | Gonfler, puis avaler | Gonfler seulement |
|---|---|---|---|
| glisser | 3,08 / 2,50 | 3,70 | 2,46 |

(Deux séries, chacune contre la version sans déformation de sa propre session.) L'écrasement tombait sur le rendu du dépôt : +0,62 image par glisser en moyenne, sur la moitié des gestes de l'outil qui le déclenchent, soit environ une image et quart chacun. Retiré ; le fantôme qui vient s'y poser dit déjà que le vivier a pris la puce. Le gonflement ne coûte rien de mesurable. Tests : B3 (il se gonfle sous la puce, puis reprend sa forme), K3 (rien) ; chacun échoue quand on retire ce qu'il garde.

**La séquence de « Répartir ».** Juste après « Appliquer ce plan », les noms qui arrivent dans la grille Semaine s'y posent un à un, en vague : jour après jour (70 ms), puis rangée après rangée (30 ms), une fois la feuille presque descendue (250 ms). Des animations CSS à délai (`pose-in`, « backwards » : chaque nom attend son tour dans son état de départ), décidé à la naissance du nom. Sous le mouvement réduit, pas de vague.

| Geste | Sans vague | Avec vague |
|---|---|---|
| répartir, 50 gestes | 9,44 | 10,84 |
| répartir, 100 gestes | 9,65 | 10,23 |

Elle se paie un peu : entre une demi-image et une image et demie par « Appliquer ce plan » (A/A : 1,36 sur ce geste, rechargé à chaque fois), la pire image médiane de 117 à 133 ms. Gardée : c'est la séquence que la mission demande, un geste d'une fois par semaine, et ce même geste a gagné treize images en quittant Framer. Tests : E2 (sur une même rangée, plus tard dans la semaine, plus tard dans la vague), K3 (pas de vague) ; chacun échoue quand on retire ce qu'il garde.

**Le son des gestes (Web Audio).** Une note brève, synthétisée (aucun fichier à charger) : une quinte qui monte quand on pose un compagnon (glisser, ou un jour coché dans sa fiche), une tierce qui descend quand on le retire (`ui/son.ts`). **Éteint par défaut** : un chantier est bruyant ou silencieux selon le jour, et Geoffrey décidera. Il s'allume dans la feuille « Données », « Sur cet appareil » (l'allumer fait entendre la note, et c'est cet appui qui autorise le son sur l'iPhone) ; retenu d'un lancement à l'autre. Là où Safari connaît la session audio, elle est « ambient » : la note se mêle à la musique du chantier au lieu de la couper, et se tait avec le bouton de silence. Le retour haptique reste (`navigator.vibrate`, au soulèvement d'une puce ; Safari ne l'avait pas : à vérifier sur l'iPhone, W8). Éteint, le son ne coûte rien (rien n'est créé) ; allumé, une note est une poignée de nœuds audio, hors du rendu. Test K7 : un espion remplace le moteur audio et note chaque note ; il échoue si le son ignore le réglage, ou si le réglage n'est pas retenu.

**Three.js : aucun usage honnête, donc rien.** Geoplan montre des équipes posées sur des jours et des chantiers réduits à un code, une adresse et douze étapes : aucune de ces données n'a de profondeur, et rien de ce que Geoffrey fait au doigt n'y gagnerait. Une vue 3D d'un chantier, un vivier en volume, des puces qui tombent en relief seraient des décors, qui coûteraient plus de 150 ko et des images perdues à chaque geste. La mission le demandait dans ce cas : le dire, et ne rien mettre. Rien n'est ajouté au paquet, initial ou à la demande.

Et une erreur à moi, dite : après U22, `verifier-css` m'a répondu ✓ sur la construction de la veille (il lit `apps/web/dist`, que je n'avais pas reconstruit). Le résultat n'aurait pas changé, mais la vérification n'avait pas eu lieu. L'outil refuse désormais une construction plus ancienne que les sources.

**La porte (2026-09-28, reprise dans une autre session).** La session précédente s'est arrêtée à la limite d'usage de la semaine, au milieu de cette entrée. Reprise sur une autre machine, à partir du dépôt `abasse-ali/travaux_geoplan` : une copie de la copie de travail de W6, en un seul commit (« first commit »), sans l'historique. Les empreintes citées plus haut sont celles du dépôt d'origine ; celles de la porte, ci-dessous, sont sur la branche `claude/happy-feynman-rpp9pt` de `travaux_geoplan` (question 9). L'état copié a d'abord été vérifié : types, 372 tests du domaine et du client (et les 3 échecs attendus), 221 de l'API, construction.

La machine n'est pas celle de W0 à W6 :

| | W0 à W6 | La porte |
|---|---|---|
| Système | Windows | Linux, 4 cœurs, 16 Go |
| Node | 24 | 22.22 (celui de Netlify) |
| Navigateur du filet | WebKit, format iPhone 15 | Chromium 141 préinstallé, même format (écran, toucher, agent) ; pas de WebKit ici |
| Docker | Docker Desktop | démon lancé dans la session ; Docker Hub refusait (429) : MySQL 8.4, Redis 7.4 et Ryuk tirés du miroir de Google (`mirror.gcr.io`), mêmes images officielles |

Le filet se joue désormais aussi dans Chromium, par deux variables (`GEOPLAN_E2E_NAVIGATEUR=chromium`, `GEOPLAN_E2E_CHROMIUM` pour un Chromium déjà installé ; `630a59a`) ; WebKit reste le défaut. Les captures de référence (WebKit, Windows) ne se comparent pas sous Linux : pas jouées ici.

**Ce que Chromium et les deux autres sources ont trouvé.** Joué une première fois tel quel : source locale, 2 échecs ; supabase, 6 ; api, 6. Cinq constats, un commit chacun :
- **V6** (K6 et trois L2, sources supabase et api) : la coque dessine d'abord l'attente quand l'appareil n'a rien ; le libellé de la semaine et « Auj. » naissaient au rendu suivant, après le « premier rendu », et entraient en glissant. V5 n'était corrigé qu'à moitié : la source locale lit ses données avant le premier rendu, et c'est la seule que le filet avait rejouée. Le premier rendu est désormais le premier qui montre quelque chose (`02c7320`).
- **U23** (C4) : un glisser sur la barre interrompu par le système laissait l'aperçu à l'écran (50 % affichés, 75 enregistrés). Préexistant. L'annulation efface l'aperçu (`5119290`).
- **U24** (C4, Chromium seulement) : à la souris, un geste vertical parti de la barre sélectionnait le texte des missions, et le glisser suivant emportait la sélection au lieu de régler l'étape. La barre n'offre plus de sélection (`05ce2a8`).
- **U25** (L2, Chromium seulement) : le champ de fichier de la feuille Données, 42 px de haut. 44 au moins, sans effet dans WebKit (`b053840`).
- **U26** (C5, C6 contre l'API, 3 fois sur 40) : un volet était une zone de défilement (`overflow: hidden`) ; ce qu'on y faisait paraître pendant qu'il s'ouvre le faisait défiler sur lui-même, puis le contenu redescendait sous le doigt. Trouvé en notant les événements (appui sur « Sols & plinthes », relâché sur « Jointeur », au même point). `overflow: clip` (`cd88fcd`) ; le scénario rejoué 40 fois : 3 échecs avant, 0 après.

Et deux commentaires qui donnaient encore Framer Motion pour raison, au présent (`d82b18f`, paquets identiques à l'octet).

**Le mouvement réduit, vérifié d'ensemble** (`9894773`). Un test note tout ce qui bouge pendant un tour de chaque geste qui bougeait — jour, semaine, « Auj. », onglets, vivier replié puis rouvert, étapes, mission, poser, retirer, « Composer », « Répartir » — : toute animation ou transition CSS de plus de 1 ms ou à délai, toute animation de script. Sous le mouvement réduit : rien. Témoin, le même tour sans : les quatorze mécanismes attendus (huit animations CSS nommées, la transition de la pastille, cinq animations de script ; le message du commit en annonce neuf CSS : c'est huit), dont un volet qui part de 0 (durci après la relecture). Sans la garde de `forme.ts`, il échoue (deux « script 400 ms @ #vivier »).

**Relecture adversariale.** Un agent distinct, dans sa propre copie, a essayé de casser W6 et les corrections ci-dessus : dix constats prouvés, chacun par un test qui échouait. Je les ai rejoués sur le code d'avant (quinze preuves qui échouent), puis corrigés ; chaque correction a son test permanent, vérifié en retirant la correction.

| Constat | Correction |
|---|---|
| **Un second doigt** pendant un glisser le reprenait ou le lâchait : une affectation fausse (U27, moyenne ; depuis la première version) | le glisser et la barre suivent le doigt qui les a commencés ; un doigt principal qui se pose sur un glisser dont la fin s'est perdue l'abandonne (`04810bc`) |
| Un volet repassait une image à pleine hauteur à la fin d'un repli (V7, W6) | l'animation de repli garde sa fin jusqu'au départ du volet (`25e1eff`) |
| **Ma correction d'U26 faisait sauter de 8 px** la ligne d'une étape, et la raccourcissait de 2 px au repos (V8) | `display: flow-root` contient les marges, comme `hidden` ; j'avais écrit « aucun changement de dessin » : c'était faux (`25e1eff`) |
| En développement, un volet monté ouvert s'animait, et le témoin de K3 s'en contentait (V14) | l'effet se fie à l'état déjà joué ; le témoin exige un volet qui part de 0 (`25e1eff`) |
| Des entrées jouaient au premier affichage : le vivier au lancement et à l'ouverture, la grille Semaine, l'écran de connexion (V10) ; K6 ne regardait que la coque | décidées à la naissance, comme les puces des chantiers ; K6 regarde toutes les entrées, avec ses témoins (`b8ac329`) |
| La vague de « Répartir » débordait sur la semaine suivante et sur la grille rouverte (V9, W6) | elle ne pose que les noms que le plan fait arriver, sur sa semaine ; la grille qui s'en va l'efface (`b8ac329`) |
| La marque d'attente se rallumait au lancement connecté (V13) | la seconde attente reprend l'apparition là où la première l'a laissée (`b8ac329`) |
| Le trait sous l'onglet sautait à l'onglet d'avant quand on en touchait un autre en chemin (V11, W6) | le nouveau glissement part d'où l'ancien en était (`e3b66a0`) |
| « Auj. » faisait entrer le libellé dans le mauvais sens (V12) | « Auj. » donne son sens (`e3b66a0`) |
| Au clavier, replier ou rouvrir le vivier faisait tomber le focus sur la page (U28) | le focus passe au contrôle qui défait le geste (`d2cfddb`) |

Ce qui a tenu : le mouvement réduit, jusque dans la page compagnon et la connexion ; le vol du fantôme (changement de jour, d'onglet ou second glisser en plein vol, dépôt dans sa propre zone, copie en urgence : rien de collé) ; le vivier qui se gonfle (interrompu, replié en vol, allers-retours) ; le son (aucun contexte audio avant un geste, aucune note pour un dépôt sans effet ni pour la synchronisation) ; V6 sur les trois sources ; aucun écouteur qui fuit après les gestes de barre ou de puce ; les cibles au doigt et l'anneau du focus, `clip` compris ; `dispo.html` à 59,7 ko.

Soupçons non prouvés, à essayer sur l'iPhone en W8 : le son après un relancement (le contexte audio naît dans le `pointerup` d'un toucher, que WebKit compte peut-être comme un geste, peut-être pas) ; l'application passée en arrière-plan en plein glisser, si Safari n'envoie pas `pointercancel` (la correction d'U27 l'abandonne au toucher suivant) ; le taux de V7 sous WebKit. Et deux, antérieurs à W6, non mesurés : `barGrow` et `tickIn` se rejoueraient si une fiche change de place dans la liste ; le fond d'une feuille qui se ferme prendrait encore le doigt pendant 500 ms (vaul, W5).

**La puce et son `will-change: transform`** (piste laissée par W6 : utile à Framer, plus maintenant). Mesuré sur une machine au calme, dans les deux sens (le retrait en A, puis en B), avec un contrôle A/A, 50 gestes par version :

| Geste | Avec | Sans | A/A (écart) |
|---|---|---|---|
| jour | 0,32 · 0,44 | 0,32 · 0,46 | 0,08 |
| glisser | 0,80 · 0,86 | 0,80 · 0,86 | 0,18 |
| semaine | 1,78 · 1,50 | 1,52 · 2,18 | 0,22 |
| vivier | 0,06 · 0,18 | 0,26 · 0,06 | 0,04 |

(Chaque case : la série où la version était en A, puis celle où elle était en B.) Aucune différence qui dépasse le bruit, ni ne tienne quand on inverse l'ordre ; la seule série « sans » qui perde (semaine, 2,18) tient à une image de 567 ms. Une première mesure, faite pendant que la relecture chargeait la machine, donnait « jour » à 1,36 contre 0,70 : l'indicateur, pas le code. **Gardé** : sans effet mesurable, le retirer pourrait changer le rendu du texte des puces dans les captures WebKit, que je ne peux pas comparer ici. À retirer avec un contrôle des captures, si l'on veut alléger les calques.

Pour mesurer ici, l'outil (`npm run images-perdues`) lit `GEOPLAN_E2E_CHROMIUM`, et il lui faut le « headless shell » de Chromium : le Chromium complet, sans écran, met en veille l'onglet qui n'est pas au premier plan, et une version ne dessinait plus rien (0 image perdue d'un côté, 383 par glisser de l'autre).

| Critère | Résultat |
|---|---|
| `prefers-reduced-motion` coupe tout le décoratif | le tour : rien ne bouge, sur les trois sources ; les tests K3 de chaque mouvement ; la relecture n'a rien trouvé qui bouge encore |
| Chaque animation ajoutée a sa mesure A/B | le lâcher, le vivier qui se gonfle, la vague (plus haut) ; le son n'anime rien ; la porte n'ajoute aucune animation, en retire plusieurs (V6, V10, V13) et en répare d'autres sans changer leur coût |
| W1 vert | bout en bout, dans Chromium, chaque source jouée seule : locale 156 passés, 4 sautés ; supabase 136 passés, 8 sautés ; api 144 passés, 8 sautés (au départ de la porte : 134, 111 et 119 passés, avec 2, 6 et 6 échecs ; 20 tests ajoutés depuis, dont un qui ne tourne qu'en source locale). Unitaires : domaine et client 372, et les 3 échecs attendus (D2, D5, D6) ; API contre de vrais MySQL et Redis : 221. Types, construction, `verifier-css` |
| Relecture adversariale | dix constats prouvés, tous corrigés, chacun avec son test (ci-dessus) |
| Rien pour Three.js | rien, ni au démarrage ni à la demande |
| Poids | `index.html` 113,2 ko (112,4 avant la porte ; +0,8 ko, les corrections), `dispo.html` 59,7 ko, inchangé (38 % de sa référence) |

**Écarts au plan, et pourquoi.**
- Le filet a tourné dans Chromium, pas dans WebKit : à rejouer sur la machine du propriétaire, avec les captures (`npm run test:e2e`, `npm run test:captures`). J'attends zéro image changée : au repos, la porte ne change pas le dessin (un volet rogne par `clip` mais contient ses marges comme avec `hidden`, le champ de fichier dépasse déjà 44 px dans WebKit, les entrées retirées ne jouaient qu'en chemin, et les captures attendent la fin des animations).
- Mes propres erreurs, dites : U26 annoncé « sans changement de dessin » alors qu'il en changeait un (V8, rattrapé par la relecture) ; un test de V9 qui ne pouvait pas échouer (la grille rouverte trop tard, hors de la fenêtre de la vague), réécrit pour agir dans la fenêtre, et qui exige de l'être ; le test du trait (V11) mesurait le plus grand écart d'une image à l'autre, que la charge faisait dépasser à son témoin : il mesure la continuité au toucher (`f03a3f7`) ; une première mesure du `will-change` faite sur une machine chargée ; et une vérification lancée pendant le filet complet, dans le même dossier de résultats : Playwright l'a vidé en démarrant, et sept tests de la source supabase ont perdu leurs traces (ENOENT) — rejouée seule ensuite (tableau ci-dessus). Deux suites Playwright ne tournent jamais ensemble dans la même copie.

### W8 — La recette (2026-09-28)

Commencée sans attendre W7 : la recette se joue sur la pile de production montée en local, pas sur la production. Rien n'a changé pour Geoffrey ni pour les compagnons : rien n'est fusionné, et la production lit toujours Supabase.

**La pile, d'abord.** Pour jouer « avec la source `api` », j'ai monté `infra/docker-compose.yml` tel qu'il partira sur le VPS. Deux défauts de la pile elle-même, avant tout geste :
- **P6** : nginx servait une page d'attente, pas l'application. W3 l'avait posée le temps que le client parle à l'API ; W4 devait la remplacer, et ne l'a pas fait. L'image nginx construit maintenant l'application pour l'API et la sert (`c4985e6`).
- **P7** : servie sous la politique de sécurité de nginx, l'application voyait refuser trois feuilles de style qu'elle crée par le script (vaul, Radix) ; la feuille du bas perdait son `touch-action` et ne se fermait plus d'un glisser. Admises par leur empreinte, pas par `'unsafe-inline'` ; le filet sert désormais la construction sous la même politique, lue dans `securite.conf` (`3b4187b`).

**La recette.** Un parcours de bout en bout, dans Chromium au format iPhone 15, avec la vraie horloge : chaque ligne de GESTES.md a son geste, son contrôle et sa capture. Six appareils : le téléphone de Geoffrey, un second appareil connecté, le téléphone d'un compagnon, un en mode sombre, un en mouvement réduit (et son témoin), un ordinateur à la souris. Le détail, ligne par ligne : [`RECETTE.md`](RECETTE.md).

| | |
|---|---|
| Lignes jouées | 74 sur 76 : E3 exige des chantiers tous livrés, H6 une construction sans serveur (tenues par le filet) |
| Régressions | une, trouvée et corrigée : P8 |
| Améliorées (un défaut de la référence, vu corrigé ; ou un ajout) | 13 : A2, E2, H1, H4, H5, I4, J5, J10, J11, K3, K5, K7, K8 |
| Fonctionnent | 61, dont J8 après P8 |
| ⚠ inchangés | C5 (U4, à discuter), J4 (U14, figé) |
| Politique de sécurité, console | aucune violation, aucune erreur, sur les six appareils |

Deux constats, un commit chacun :
- **P8** (J8) : l'API arrêtée, la page du compagnon restait une minute sur « Chargement… ». nginx attendait 60 s qu'une connexion à l'API s'établisse, et le réseau de Docker gardait l'ancienne adresse de l'API. Mesuré : 504 en 60,0 s ; après, en 5,0 s ; « Connexion impossible » en 5,4 s (`9d73e54`). Le test relit la configuration ; la recette rejoue le geste.
- **U29** (H5) : lancée sans réseau, rien à envoyer, le bouton d'état disait « 0 en attente », en orange. Déjà dans l'ancienne version. Il dit « Hors ligne » ; « N en attente » dès qu'une modification attend (`02df60c`). Le test relance l'application le serveur injoignable, sur les sources api et supabase : « 0 en attente » sur les deux sans la correction.

En chemin : le limiteur de connexion a tenu sur la vraie pile (« Trop de tentatives. Réessayez dans 12 min. » : la recette se connecte huit fois par passage, la limite est de dix par quart d'heure) ; deux toasts à la fois se superposent exactement, comme à la référence ; un chantier en retard reste « à pourvoir » après sa fin prévue (« Répartir » y pose encore 45 journées en semaine 50) : voulu, c'est pourquoi E3 n'a pas pu se jouer ici.

**L'outil.** La recette est versionnée (`apps/web/recette/`, `npm run recette -w @geoplan/web`) : elle se rejoue dans WebKit sur la machine du propriétaire, et avant la bascule. Elle arrête l'API, coupe le réseau, remplace les données : elle refuse toute adresse qui n'est pas locale. Elle part d'une base gardée (`recette/base.sh garder`, puis `remettre` à chaque passage) et vérifie qu'elle en part. Elle calcule ses dates : elle se joue du lundi au jeudi (à partir du vendredi, une demande de dispos vise la semaine suivante).

**La porte.**

| Critère | Résultat |
|---|---|
| Chaque ligne de GESTES.md jouée pour de vrai, en viewport iPhone, source api | 74 sur 76, dans Chromium ; E3 et H6 n'existent pas sur cette pile (tenues par le filet) |
| Toute régression bloque la fin | une trouvée, P8, corrigée ; U29, préexistant, corrigé aussi |
| W1 vert | types ; 595 tests unitaires (dont 223 de l'API) et les 3 échecs attendus ; bout en bout, dans Chromium, chaque source jouée seule : locale 157 passés, 5 sautés ; supabase 137 passés, 8 sautés ; api 145 passés, 8 sautés |
| Relecture adversariale | en cours |
| Poids (ce que nginx sert) | `index.html` 112,6 ko, `dispo.html` 59,1 ko |

**Écarts au plan, et pourquoi.**
- W8 avant W7 : la mission les ordonne dans l'autre sens, mais W7 attend le propriétaire, et W8 ne dépendait que de la pile. Après la bascule, la recette ne se rejoue pas sur la production (elle en change les données, elle arrête l'API) : un contrôle qui ne change rien la remplacera (se connecter, lire la semaine, un geste aussitôt défait).
- La recette a tourné dans Chromium, pas dans WebKit, et pas sur un iPhone : ce qui ne se voit que là est listé à la fin de RECETTE.md, et la recette se rejoue dans WebKit sur la machine du propriétaire.
