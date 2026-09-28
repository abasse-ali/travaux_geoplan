# ADR-003 — Écritures concurrentes, temps réel, hors ligne

**Statut** : accepté (W3 côté serveur, W4 côté client) · **Date** : 2026-09-25

## Contexte

Aujourd'hui (constats S1 à S8) :

- le client renvoie la **ligne entière** d'un chantier à chaque geste, et le dernier arrivé gagne ;
- une modification faite pendant un envoi peut ne jamais partir ;
- après une coupure du temps réel, rien n'est relu.

Le principe 6 exige que l'écran s'affiche depuis le cache et que les écritures en attente repartent seules. Le bouton d'état garde ses trois états : **À jour**, **N en attente**, **Local**.

## Décision

### Deux sortes d'écriture

1. **Les affectations sont des opérations** (ADR-001) : « pose P sur S le jour J », « retire P du jour J », « remplace l'équipe de S le jour J », « applique ce plan de semaine ». Chacune porte le drapeau `urgence`. Le serveur les exécute dans une transaction et la contrainte `un_homme_un_jour` tranche entre deux appareils. Pas de numéro de version : rejouer une opération sur une donnée plus fraîche a toujours un sens.

   « Remplace l'équipe » et « applique ce plan » disent pourtant un état. Envoyés tels quels par un appareil en retard, ils effaceraient ce qu'un autre a posé entre-temps (relecture adversariale de W3). Ils portent donc **`avant`**, l'équipe que l'appareil voyait au moment du geste. Le serveur n'applique que l'écart entre `avant` et l'équipe voulue : c'est une **fusion à trois voies**, écrite une fois dans le domaine (`fusionnerEquipe`).
   - Un ajout ou un retrait fait ailleurs entre-temps tient.
   - Rejouer le même geste ne change plus rien.
   - Sans geste concurrent, le résultat est exactement celui d'avant.

   Pour un plan, la fusion se calcule sur l'état d'avant le geste. Les étapes d'un même plan ne se prennent donc pas l'une l'autre pour des gestes concurrents.
2. **Les fiches** (chantier : code, adresse, dates, note, avancement, coches ; compagnon : nom, contacts, jours, niveaux) s'écrivent avec **verrou optimiste**. Chaque ligne porte `version` ; le client envoie la version qu'il a lue ; si elle a bougé, le serveur répond **409** avec la ligne actuelle. Le client **rejoue sa mutation** sur cette ligne fraîche (cocher la mission 2 de l'étape 5 reste « cocher la mission 2 de l'étape 5 ») et renvoie. Un conflit ne perd donc jamais le geste ; il ne se voit que si les deux gestes portent sur le même champ, et alors le dernier geste gagne, en connaissance de cause.

Les écritures de fiche sont des **correctifs par champ** (`PATCH`), jamais la ligne entière : deux appareils qui modifient la note et les coches du même chantier ne se gênent pas après rejeu.

### Temps réel

- Socket.IO, authentifié par le même cookie de session. Adaptateur Redis, pour qu'un second processus API reçoive aussi les événements.
- Après chaque transaction validée, le serveur diffuse un événement **ciblé** : `{ quoi: "site" | "person" | "assignments" | "avail", id, version?, jours? }`.
- Le client **invalide la requête TanStack Query correspondante**, pas tout le cache. Les événements émis par l'appareil lui-même sont reconnus (identifiant de mutation) et ignorés.
- À chaque reconnexion du socket, le client invalide tout : c'est ce qui manquait (constat S5).

### Hors ligne

- Le cache TanStack Query est persisté (IndexedDB, repli `localStorage`) : l'écran s'affiche avant toute réponse du réseau.
- Les mutations en attente sont persistées elles aussi, et **reprises au retour du réseau** (écouteurs `online` et `visibilitychange`, plus un réessai périodique à 6 s comme aujourd'hui). Chaque mutation porte un identifiant unique ; le serveur mémorise les identifiants déjà appliqués pendant 7 jours (Redis) et **n'applique jamais deux fois** la même.
- Une mutation n'est retirée de la file qu'après la réponse du serveur ; un geste fait pendant l'envoi crée une nouvelle mutation, il ne se confond pas avec la précédente. C'est ce qui règle S1.
- Une mutation refusée pour une raison définitive (fiche supprimée ailleurs, donnée invalide) sort de la file et le dit par un toast ; elle ne bloque plus les suivantes (constat S8).
- Le cache est rangé sous l'identifiant du compte connecté : une déconnexion puis la connexion d'un autre compte ne pousse rien chez lui (constat S7).

### Une seule interface de dépôt côté client

`Depot` expose les lectures et les opérations métier. Trois implémentations — `local`, `supabase`, `api` — choisies par `VITE_GEOPLAN_SOURCE`. Tant que la production lit Supabase, l'implémentation `supabase` reproduit le comportement actuel (ligne entière, dernier arrivé gagne) : **le verrou optimiste n'existe qu'avec l'API**. La bascule (W7) est un changement de variable.

## Conséquences

- Le domaine ne change pas : les opérations s'appuient sur `setTeamOn`, `setTask`, `setPhasePct` des deux côtés.
- La forme de `Site.plan` reste celle d'aujourd'hui dans le client.
- Le rejeu sur 409 suppose que chaque mutation soit décrite comme une intention (« coche », « pose ») et non comme un état. C'est la contrainte principale qu'impose W4 à l'interface.
