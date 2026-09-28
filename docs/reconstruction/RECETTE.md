# Recette de W8

Chaque ligne de [`GESTES.md`](GESTES.md), jouée pour de vrai : l'application construite pour l'API, servie par nginx sous sa politique de sécurité, la vraie API, MySQL et Redis, la pile Docker de production montée en local. Pour chaque ligne : fonctionne, régression, amélioré, ou non joué (et pourquoi).

**Bilan : 74 lignes jouées sur 76, aucune régression qui reste.** La recette a trouvé deux défauts, corrigés chacun dans son commit avec son test : P8 (l'API arrêtée, la page du compagnon attendait une minute) et U29 (« 0 en attente » au lancement sans réseau). Deux lignes ne se jouent pas sur cette pile : E3 et H6 (plus bas). Ce qui ne se vérifie que sur un iPhone est à la fin.

## Conditions

| | |
|---|---|
| Date | lundi 28 septembre 2026, semaine 40, avec la vraie horloge (pas d'heure figée comme dans le filet) |
| Code | branche `claude/happy-feynman-rpp9pt`, avec P8 (`9d73e54`) et U29 (`02df60c`) |
| Pile | `infra/docker-compose.yml` : nginx 1.27 et l'application construite pour l'API (P6), l'API sous Node 24, MySQL 8.4, Redis 7.4 ; relance du samedi à blanc |
| Données | l'effectif de référence (`data/effectif.json` : 13 compagnons, 3 chantiers ouverts le 31 août), rien de posé, aucune demande ; un compte, `geoffrey@recette.test` |
| Navigateur | Chromium 141 au format iPhone 15 (393 × 659, toucher, écran ×3) : WebKit n'est pas installé dans cette session. Six appareils : le téléphone de Geoffrey, un second appareil connecté (H7), le téléphone d'un compagnon (J), un en mode sombre (K2), un en mouvement réduit (K3) et son témoin, un ordinateur à la souris (K1) |
| Outil | `apps/web/recette/` : un parcours, de bout en bout, une capture par ligne ; il se rejoue (plus bas) |

Pendant tout le parcours : **aucune violation de la politique de sécurité, aucune erreur dans la console**, sur les six appareils.

## Verdicts

La recette joue le geste principal de chaque ligne et en vérifie le résultat sur la vraie pile. Le détail de chaque ligne (chaque libellé, chaque cas limite) est tenu par le filet (`e2e/`), rejoué en entier sur les trois sources pour cette porte (voir le journal). « Amélioré » : un défaut de la version de référence (`364c67a`) que la recette a vu corrigé.

### A. Se repérer dans le temps

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| A1 | fonctionne | le mercredi touché devient le jour affiché, le résumé suit (« 30 sept. ») |
| A2 | amélioré | ±7 jours, jour gardé, libellé hors semaine marqué ; deux appuis rapides avancent de deux semaines (U19, W5) |
| A3 | fonctionne | « Auj. » ramène à la semaine 40 et disparaît |
| A4 | fonctionne | les trois écrans |
| A5 | fonctionne | l'en-tête du jeudi, dans la grille, ramène aux chantiers, au jeudi |

### B. Affecter les compagnons

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| B1 | fonctionne | appui long puis glisser : Nixon posé sur 9MD49, le toast, la puce quitte le vivier |
| B2 | fonctionne | de 9MD49 à 12AB49 : « Nixon : 9MD49 → 12AB49 » |
| B3 | fonctionne | rendu au vivier : « Nixon retiré… », il y revient |
| B4 | fonctionne | lâché hors de toute cible : rien ne change, rien ne reste soulevé |
| B5 | fonctionne | Nixon, qui a répondu qu'il ne venait pas le mardi, déplacé ce mardi-là : accepté, l'avertissement 2 897 ms plus tard, sa pastille du mardi « absent » |
| B6 | fonctionne | la fiche d'une puce posée : « Jours sur 9MD49 · sem. 40 » et ses sept jours |
| B7 | fonctionne | la fiche d'une puce du vivier, sans « Jours sur… » |
| B8 | fonctionne | « Poser sur » 9MD49 pose et ferme |
| B9 | fonctionne | « Retirer de ce jour » |
| B10 | fonctionne | les liens `tel:+33612345678`, `sms:+33612345678`, `https://wa.me/33612345678` ; les ouvrir est un geste d'iPhone |
| B11 | fonctionne | le mardi, l'équipe du lundi reconduite sur 9MD49 |
| B12 | fonctionne | en urgence, le glisser copie ; l'urgence coupée, le doublon reste |
| B13 | fonctionne | hors urgence, le glisser déplace |
| B14 | fonctionne | le mardi : ni Kia (jeudi seulement), ni ceux déjà posés ; Chaggy (mardi seulement) y est |
| B15 | fonctionne | replié en pastille « Ouvrir le vivier — N disponibles », puis rouvert |

### C. Suivre l'avancement

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| C1 | fonctionne | « Les 12 étapes » déplie l'étape en cours (Démolition) |
| C2 | fonctionne | une seule étape ouverte à la fois |
| C3 | fonctionne | trois missions sur quatre : 75 % ; une décochée : 50 % |
| C4 | fonctionne | la barre glissée à droite : 100 % ; à gauche : 0 % |
| C5 | fonctionne, ⚠ inchangé | un simple appui bascule toujours 0 / 100 % (U4, « à discuter » : question au propriétaire) |
| C6 | fonctionne | au clavier, un cran par flèche |
| C7 | fonctionne | la carte : étape en cours, prévision, douze barres |
| C8 | fonctionne | la note écrite est relue après un rechargement (I3) |

### D. Composer

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| D1 | fonctionne | « Composition · 12AB49 », « Étape 1 — Démolition », le rappel « Il reste 114 j·h… » |
| D2 | fonctionne | taille 3 : Geoffrey, Morgan, Quentin, chacun avec ses raisons |
| D3 | fonctionne | « Affecter » : « 12AB49 : N journées posées » |

### E. Répartir

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| E1 | fonctionne | « 45 journées réparties sur 3 chantiers », chaque nom avec sa raison |
| E2 | amélioré | appliqué : « 45 journées posées sur la semaine 40 », et les noms se posent en vague dans la grille (W6) |
| E3 | non joué ici | il faut que tous les chantiers soient livrés. Essayé en semaine 50, après la fin prévue des trois : « Répartir » y pose encore 45 journées, un chantier en retard reste à pourvoir tant qu'il n'est pas livré. Tenu par le filet (`repartir.spec.ts`) |
| E4 | fonctionne | la grille : chantiers × 7 jours, initiales, « +N », la ligne des libres |

### F. Chantiers

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| F1 | fonctionne | « 151 Henri Desbals apt 7 » donne le code « 151HD7 » |
| F2 | fonctionne | « 151HD7 ouvert », quatre fiches |
| F3 | fonctionne | supprimé en deux temps, « 151HD7 supprimé » |
| F4 | fonctionne | copié (Chromium n'a pas de feuille de partage) : « GEOPLAN — Lundi 28 sept. », les chantiers, les étapes, les équipes, la note |

### G. Équipe

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| G1 | fonctionne | « Nouveau compagnon » |
| G2 | fonctionne | les contrôles dans l'ordre (« Il manque le nom », un numéro invalide), puis « Recette ajouté au vivier » |
| G3 | fonctionne | les fiches de Nixon (e-mail, téléphone) et de Giorgi (e-mail) modifiées : « … enregistré » |
| G4 | fonctionne | « Supprimer Recette » puis « Confirmer la suppression » |
| G5 | fonctionne | « Demander les dispos · semaine 40 » : Nixon et Giorgi, « SMS » pour Nixon ; « Lien » copie `http://localhost:8080/dispo.html?t=…` (« Lien copié ») |
| G6 | fonctionne | la réponse de Nixon (J4) : l'application de Geoffrey, restée ouverte, affiche « Nixon a répondu pour la semaine 40 » aussitôt (ligne manuelle, jouée ici) |

### H. Données

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| H1 | amélioré | hors ligne, une mission cochée : « 1 en attente » ; le réseau revenu : « À jour ». Lancée sans réseau et rien à envoyer, le bouton dit maintenant « Hors ligne » au lieu de « 0 en attente » (U29, corrigé en W8) |
| H2 | fonctionne | « Synchronisé », le compte, « 13 compagnons · 3 chantiers » |
| H3 | fonctionne | `geoplan-2026-09-28.json` : `{app: "geoplan", v: 3}`, 13 compagnons, 3 chantiers |
| H4 | amélioré | la sauvegarde collée : un premier toucher annonce, « Confirmer : tout sera remplacé » remplace (U7, W4) ; « … restaurés » |
| H5 | amélioré | relancée hors ligne : l'écran vient de l'appareil, tout de suite, avec la dernière modification (S10, W4) ; le réseau revenu, « À jour » |
| H6 | non joué ici | la construction pour l'API n'a pas de mode local. Tenu par le filet, source locale (`donnees.spec.ts`) |
| H7 | fonctionne | deux appareils connectés : Morgan retiré puis posé sur l'un, l'autre suit sans recharger (ligne manuelle, jouée ici) |

### I. Connexion

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| I1 | fonctionne | « Geoplan », les champs nommés pour le trousseau (`username`, `current-password`), le bouton inactif sous 6 caractères |
| I2 | fonctionne | « Adresse ou mot de passe incorrect. » (le texte de la source api : pas de « créez-le », un compte se crée sur le serveur) |
| I3 | fonctionne | rechargée : toujours connectée. L'application posée sur l'écran d'accueil de l'iPhone reste à essayer |
| I4 | amélioré | ⚠ levé : ni « Créer un compte » ni « Mot de passe oublié » ; « Le responsable du serveur le crée ou le change pour vous » (U9, W3) |
| I5 | fonctionne | « Se déconnecter » ramène à l'écran de connexion |

### J. La page du compagnon

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| J1 | fonctionne | le lien de Nixon, sur un autre téléphone : « Bonjour Nixon », la semaine, sept jours |
| J2 | fonctionne | lundi et mercredi cochés |
| J3 | fonctionne | un mot |
| J4 | fonctionne, ⚠ inchangé | « C'est envoyé, merci Nixon », « …tu es noté disponible : lundi, mercredi ». Au-delà de 300 caractères, l'écran montre toujours le mot entier (379) quand la base n'en a que 300 (U14, figé) |
| J5 | amélioré | réseau coupé : « L'envoi n'a pas abouti… », et le bouton se libère (⚠ levé : il restait sur « Envoi… ») |
| J6 | fonctionne | « Lien incomplet » |
| J7 | fonctionne | « Lien expiré » |
| J8 | fonctionne après P8 | l'API arrêtée : « Connexion impossible » en 5,4 s. **Avant P8, une minute de « Chargement… »** |
| J9 | fonctionne | le lien rouvert : la réponse revient, « Mettre à jour ma réponse » |
| J10 | amélioré | le lien de Giorgi, sur le même téléphone, le service worker installé : le formulaire, pas l'application (P1, W1) |
| J11 | amélioré | ce que nginx sert : `dispo.html` 59,1 ko (158,9 ko à la référence, le plafond est à 174,8), `index.html` 112,6 ko |

### K. Transverses

| Réf. | Verdict | Ce qui a été joué, ce qu'on a vu |
|---|---|---|
| K1 | fonctionne | au format iPhone tout du long ; sur un écran de 1280 × 800 à la souris, Sydney rendu au vivier puis reposé |
| K2 | fonctionne | les écrans en sombre (captures : chantiers, feuille Données, semaine) |
| K3 | amélioré | sous le mouvement réduit, un tour de tous les gestes qui bougent : rien ne bouge. Le même tour sans : 73 mouvements (U10, W5 ; Framer Motion retiré en W6) |
| K4 | fonctionne | Échap ferme ; glissée vers le bas, la feuille se ferme, sous la vraie politique de sécurité (P7) |
| K5 | amélioré | trois toasts demandés : deux à l'écran au plus, 2,8 s chacun ; centrés (U15, W1) ; le doigt passe au travers (U22, W6) |
| K6 | fonctionne | l'autre appareil (H7), redessiné deux fois par le temps réel : aucune entrée rejouée, seulement celles de ce qui arrive (les puces de Morgan, « Personne de libre ») |
| K7 | amélioré | « Sons des gestes » (nouveau, W6) : éteint par défaut, allumé, retenu après un rechargement |
| K8 | amélioré | la relance, à blanc, lancée deux fois : deux e-mails prévus, puis « déjà faite » (P4, W3) ; aucun envoi réel |

## Ce que la recette a trouvé

| Réf. | Constat | Correction |
|---|---|---|
| P8 | L'API arrêtée, nginx attendait 60 s qu'une connexion s'établisse : la page du compagnon restait une minute sur « Chargement… », l'application sur « … ». Mesuré : 504 en 60,0 s | `9d73e54` : 5 s au plus pour se connecter à l'API ; mesuré, 504 en 5,0 s ; « Connexion impossible » en 5,4 s |
| U29 | Lancée sans réseau, rien à envoyer, le bouton d'état disait « 0 en attente », en orange. L'ancienne version disait déjà la même chose | `02df60c` : « Hors ligne » ; « N en attente » dès qu'une modification attend |

Et, en préparant la recette, deux défauts de la pile elle-même : l'application n'était pas servie du tout (P6, `c4985e6`), et la politique de sécurité refusait les styles de la feuille du bas, qui ne se fermait plus d'un glisser (P7, `3b4187b`).

Observé sans rien changer :
- **Le limiteur de connexion tient.** La recette se connecte huit fois par passage ; au deuxième passage dans le même quart d'heure, la limite (dix par quart d'heure depuis une même adresse) a répondu « Trop de tentatives. Réessayez dans 12 min. ». `recette/base.sh remettre` remet ses compteurs à zéro.
- Deux toasts à la fois se superposent exactement : le plus récent couvre l'autre. C'est le comportement de la référence (« deux au plus ») ; un toast plus large dépasse un instant derrière le suivant.

## Ce qui reste à jouer sur un iPhone

La recette a tourné dans Chromium : WebKit, le moteur de l'iPhone, n'est pas dans cette session. À jouer sur la machine du propriétaire (la recette se rejoue dans WebKit, plus bas), puis à la main sur l'iPhone de Geoffrey :

- le retour haptique au glisser (B1) ; ouvrir Téléphone, Messages et WhatsApp depuis une fiche (B10) ; copier un lien de dispo (G5) ;
- le mode avion, en vrai (H1, H5) ; l'application posée sur l'écran d'accueil, qui garde sa session d'un lancement à l'autre (I3) ;
- le son (K7) : entendu, muet avec le bouton de silence, et encore là après un relancement de l'application ;
- les soupçons laissés par la relecture de W6 : un glisser quand l'application passe en arrière-plan, et le taux de V7 sous WebKit ;
- les captures en mode sombre dans WebKit (K2).

## Rejouer la recette

Elle arrête et relance l'API, coupe le réseau, remplace les données : **elle refuse de tourner ailleurs que sur une pile locale** (`http://localhost…`). Elle se joue du lundi au jeudi (à partir du vendredi, une demande de dispos vise la semaine suivante).

Préparer la pile, une fois :

```sh
cp infra/.env.example infra/.env          # des mots de passe MySQL, APP_ORIGIN=http://localhost:8080
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml exec api node --disable-warning=ExperimentalWarning apps/api/src/cli/compte.ts creer geoffrey@recette.test
docker compose -f infra/docker-compose.yml cp data/effectif.json api:/tmp/effectif.json
docker compose -f infra/docker-compose.yml exec api node --disable-warning=ExperimentalWarning apps/api/src/cli/amorcer.ts /tmp/effectif.json
apps/web/recette/base.sh garder            # l'état de départ de chaque passage
```

Puis, à chaque passage :

```sh
apps/web/recette/base.sh remettre
RECETTE_MDP='…' npm run recette -w @geoplan/web
```

Dans WebKit par défaut ; `GEOPLAN_E2E_NAVIGATEUR=chromium` pour Chromium, comme le filet. Le bilan (`bilan.json`) et une capture par ligne sont dans `apps/web/recette/.resultats/`, jamais versionnés.
