# ADR-004 — Le client : un dépôt, trois sources, TanStack Query et Zustand

**Statut** : accepté (W4 l'implémente) · **Date** : 2026-09-26

## Contexte

Aujourd'hui, `apps/web/src/store.ts` est à la fois le cache, la file hors ligne, le client Supabase et la source de vérité de l'interface. Les écrans reçoivent ce magasin en props et le lisent directement (`store.person(id)`, `store.availableOn(pid, jour)`). Les actions d'`App` modifient les objets **sur place** puis appellent `touchSite`.

W4 doit :

- brancher le client sur l'API sans casser Supabase, qui reste la production jusqu'à W7 ;
- garder le hors-ligne (cache instantané, écritures qui repartent seules) et le bouton d'état à trois états ;
- adopter Zustand (état d'interface) et TanStack Query (données) ;
- garder W1 vert contre les trois sources.

## Décision

### Une interface `Depot`, trois implémentations

```ts
interface Depot {
  source: "local" | "supabase" | "api";
  compte(): Promise<Compte | null>;                 // qui est connecté ; null : écran de connexion
  connecter(email, motDePasse): Promise<Compte>;
  deconnecter(): Promise<void>;
  charger(): Promise<Instantane>;                   // { donnees: { people, sites, avail }, versions }
  envoyer(op, cle, confirme): Promise<(i: Instantane) => Instantane>;
  demanderDispos(ids, semaine): Promise<LienDispo[]>;
  ecouter(surChangement): () => void;
}
```

- `Operation` est une **intention** (ADR-003), celle du domaine (`packages/domain/src/operations.ts`) : `poser`, `retirer`, `equipe`, `plan`, `cocher`, `regler`, `modifierChantier`, `creerChantier`, `supprimerChantier`, `modifierCompagnon`, `creerCompagnon`, `supprimerCompagnon`, `remplacerTout` (restauration). « Remplacer l'équipe » et « appliquer ce plan » portent `avant`, l'équipe vue au moment du geste.
- `envoyer` reçoit l'instantané **confirmé** (l'état du serveur tel qu'on le connaît) et rend ce que la réponse change à cet instantané.
- **`local`** : les données vivent dans `localStorage` (clé `geoplan.cache.v1`, format inchangé), les opérations s'y appliquent avec les fonctions du domaine. Remplace le mode local actuel.
- **`supabase`** : le comportement de production d'aujourd'hui. L'opération est appliquée à l'instantané confirmé par le domaine, puis chaque **ligne entière** touchée part par `upsert` : dernier arrivé gagne, comme aujourd'hui (constat S4). Le temps réel Supabase déclenche une relecture.
- **`api`** : les routes de W3. Chaque opération part avec son `Idempotency-Key`. Un 409 de version renvoie la fiche actuelle ; l'opération y est rejouée, sous la même clé. Socket.IO déclenche les relectures.

Le choix se fait par `VITE_GEOPLAN_SOURCE` à la construction. Défaut : `supabase` si des clés Supabase sont configurées (la production aujourd'hui : rien ne change pour Geoffrey tant que W7 n'a pas eu lieu), `local` sinon. **La bascule, et le retour arrière, tiennent en cette variable.**

### Les données : TanStack Query pour l'instantané, une file pour les gestes

- **L'instantané** est une requête TanStack Query, `["donnees", source, compte]` : lecture, relecture au retour du réseau et de l'application au premier plan, invalidation sur les annonces temps réel et à chaque reconnexion (constat S5).
- **Les gestes** passent par une **file ordonnée** (un magasin Zustand), persistée par compte. Un seul envoi à la fois, dans l'ordre des gestes. Chaque geste garde sa clé d'idempotence d'un lancement à l'autre.
- **Ce que l'écran affiche** : l'instantané, sur lequel les gestes encore en file sont rejoués par les fonctions du domaine. Un geste se voit donc aussitôt, survit à un rechargement, et une relecture du serveur ne l'efface jamais.

Pourquoi pas les mutations de TanStack Query, prévues d'abord. Elles ne persistent que les mutations *en pause* : un geste en vol quand l'application est fermée ne repart jamais. Et leur modèle optimiste (appliquer, puis défaire en cas d'échec) défait aussi les gestes suivants quand plusieurs attendent. La file, elle, fait moins d'une centaine de lignes, et chacune de ses règles a son test.

- **Hors ligne** : l'instantané et la file sont persistés dans `localStorage`, sous une clé propre à la source et au compte (constat S7). Une écriture impossible (quota plein) est signalée, pas avalée (constat S6). Au lancement, l'écran s'affiche depuis cette copie avant toute réponse du réseau. La file repart au retour du réseau, au retour au premier plan, et toutes les 6 s tant qu'un envoi échoue.
- Un geste refusé pour une raison définitive (fiche supprimée ailleurs, donnée invalide) sort de la file et le dit par un toast ; il ne bloque plus les suivants (constat S8). Un 401 ramène à l'écran de connexion sans rien perdre de la file.
- Le bouton d'état lit la file : **Local** (source locale), **N en attente** (gestes qui n'ont pas pu partir), **…** pendant un envoi, **À jour** sinon.
- Une écriture faite pendant qu'une autre part est **un nouveau geste** : elle ne peut plus être avalée (constat S1). Un seul envoi à la fois (S2), un minuteur par usage (S3).

Ajouté après la relecture adversariale de W4 :

- **Plusieurs onglets du même compte** partagent une file : la file stockée fait foi, relue avant chaque changement, et l'événement `storage` prévient les autres onglets. Un seul onglet envoie à la fois (Web Locks, là où le navigateur les connaît).
- **Une lecture** rejoue les confirmations arrivées depuis *son* départ : chaque lecture a sa liste, car une lecture annulée par TanStack court toujours.
- **Une fiche** n'envoie que les champs changés depuis son ouverture : rejouée sur une version plus récente après un 409, elle n'écrase pas ce qu'un autre appareil y a changé (ADR-003).
- **Une synchronisation arrêtée** (déconnexion, autre compte) n'envoie plus rien.

### L'état d'interface : Zustand

Onglet, semaine, jour, vivier, urgence, chantier / étape / note ouverts, feuille ouverte, toasts. Chaque composant lit ce qu'il affiche par un **sélecteur étroit** (`useUi(s => s.jour)`), jamais l'objet entier. `tab`, `poolState` et `urgence` restent persistés dans `geoplan.ui.v3`, **validés à la relecture** (constat U17).

### Les écrans changent peu

Les écrans reçoivent aujourd'hui `store` et `act`. Ils reçoivent désormais une **vue** en lecture seule construite depuis les données affichées, avec les mêmes méthodes (`person`, `site`, `availOf`, `daysOf`, `availableOn`, `people`, `sites`), et des actions de même signature (`Actions`, `apps/web/src/ui/types.ts`), dont l'implémentation ajoute des gestes à la file au lieu de modifier des objets. La mémorisation des fiches chantier s'appuie sur l'identité des objets, qui change désormais à chaque écriture : plus de `_rev`.

### Ce que W4 corrige au passage

S1, S2, S3, S5, S6, S7, S8, S9, S10 (hors ligne, un compte inconnu du réseau reste le dernier compte connu : pas d'écran de connexion), S12, U5, U7 (confirmation avant restauration), U8 (toasts sans HTML injecté), U11, U16, U17, U18. S4 reste le comportement de la source `supabase`, par choix : la production ne change pas avant la bascule.

### La page compagnon

`dispo.html` reste minuscule : ni TanStack Query, ni Zustand. Elle lit la même variable de source et appelle soit les fonctions Supabase actuelles, soit `GET/POST /api/dispo/:jeton`, par `fetch`. supabase-js n'y est plus chargé qu'à la demande, et seulement pour la source `supabase`.

## Conséquences

- W1 doit tourner contre les trois sources : `local` (tel quel), `api` (l'API de W3 lancée pour les tests contre MySQL et Redis en conteneurs), `supabase` (un faux Supabase servi par le serveur de test, comme pour le test du service worker).
- L'API gagne `PUT /api/donnees` : « Remplacer les données » (restauration d'une sauvegarde), dans une transaction, par l'importeur en miroir. Les demandes de dispos n'y sont pas touchées.
- La mesure A/B des images perdues par geste compare la version d'avant W4 à celle d'après, dans la même session de navigateur.
- supabase-js reste chargé à la demande, seulement quand la source est `supabase`.
