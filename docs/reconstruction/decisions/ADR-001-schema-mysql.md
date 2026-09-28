# ADR-001 — Le schéma MySQL

**Statut** : accepté (W3 l'implémente) · **Date** : 2026-09-25

## Contexte

Aujourd'hui, un chantier est une ligne Supabase dont la colonne `plan` (JSON) contient tout son historique d'affectations : `{ "2026-09-01": ["p_erwan", "p_nixon"], … }`. Trois conséquences :

1. **La règle « un homme, un chantier, par jour » n'existe que dans l'interface** (`assignDay`, `applyPlan`). Rien ne l'empêche côté base : deux appareils peuvent poser la même personne sur deux chantiers le même jour.
2. **Chaque geste renvoie le plan entier** du chantier. Deux appareils qui touchent le même chantier, même à des jours différents, s'écrasent (constat S4).
3. Savoir « qui est où cette semaine » oblige à lire tous les chantiers et à parcourir leur JSON.

Le principe 4 exige que le serveur applique la règle, et que l'urgence puisse la lever **explicitement**.

## Les deux pistes

| | JSON (fidèle à l'actuel) | Affectations en table |
|---|---|---|
| Migration depuis Supabase | copie colonne à colonne | une boucle : chaque (jour, id) du plan devient une ligne |
| Règle « un homme, un jour » | vérification applicative, dans une transaction qui relit tous les chantiers | **contrainte d'unicité en base** |
| Deux appareils, même chantier, jours différents | conflit (ligne entière) | aucun conflit : ce ne sont pas les mêmes lignes |
| « Qui est où cette semaine » | lecture de tous les chantiers | `WHERE day BETWEEN ? AND ?` |
| Forme renvoyée au client | inchangée | `plan` recomposé par l'API, forme inchangée |

## Décision

**Schéma mixte.**

- Les **affectations** vivent dans une table à part, `assignments`, avec la règle portée par la base.
- Les **objets-valeurs** restent en colonnes JSON : `sk` (5 niveaux), `days` (7 booléens), `ph` (12 pourcentages), `tasks` (coches par étape). Ils se lisent et s'écrivent toujours en entier, ne sont jamais interrogés par morceaux, et leur forme est déjà validée par `normPerson` / `normSite`. Les normaliser n'apporterait rien, sinon des jointures.

### La contrainte, et comment l'urgence la lève

```sql
CREATE TABLE assignments (
  site_id    VARCHAR(40) NOT NULL,
  day        DATE        NOT NULL,
  person_id  VARCHAR(40) NOT NULL,
  urgence    BOOLEAN     NOT NULL DEFAULT FALSE,
  -- 1 : la personne occupe sa journée. NULL : affectation d'urgence.
  -- MySQL n'applique pas l'unicité entre valeurs NULL : l'urgence
  -- échappe donc à la règle, et à elle seule.
  occupe     TINYINT     NULL,
  position   SMALLINT    NOT NULL,          -- ordre des puces dans la zone
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (site_id, day, person_id),
  UNIQUE KEY un_homme_un_jour (day, person_id, occupe),
  KEY par_jour (day),
  CONSTRAINT urgence_explicite CHECK ((urgence = 1 AND occupe IS NULL) OR (urgence = 0 AND COALESCE(occupe, 0) = 1)),
  FOREIGN KEY (site_id)   REFERENCES sites(id)  ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
```

Pourquoi pas une colonne générée `IF(urgence, NULL, person_id)` : c'était la forme la plus courte, mais MySQL refuse une clé étrangère `ON DELETE CASCADE` sur une colonne dont dépend une colonne générée stockée. La contrainte `CHECK` (appliquée depuis MySQL 8.0.16) garde `occupe` et `urgence` d'accord. **Vérifié en W3 sur un vrai MySQL 8.4** (`apps/api/tests/schema.test.ts`) : double affectation normale refusée, urgence acceptée et tracée, doublon sur le même chantier refusé même en urgence, suppression en cascade. Ce test a trouvé un piège : une contrainte CHECK dont l'expression vaut NULL est tenue pour satisfaite. La première écriture, `(NOT urgence AND occupe = 1)`, laissait donc passer une affectation normale avec `occupe` à NULL, qui échappait en silence à la règle. D'où le `COALESCE`.

- Une affectation normale occupe la personne pour la journée : une seconde affectation normale, sur n'importe quel chantier, viole `un_homme_un_jour`. L'API répond **409**.
- Une affectation d'urgence porte `urgence = TRUE` : elle n'occupe pas le créneau. C'est **la trace écrite** de la dérogation, et ce qui la rend explicite. Elle peut se superposer à une affectation normale ou à une autre urgence.
- Quand l'affectation normale disparaît (retrait, déplacement, chantier supprimé), la dérogation n'a plus d'objet : la plus ancienne des affectations restantes redevient normale, dans la même transaction. Sinon l'écran signalerait une urgence qui n'existe plus, et la journée échapperait à la contrainte (relecture adversariale de W3).
- La clé primaire empêche de poser deux fois la même personne sur le même chantier le même jour.
- `ON DELETE CASCADE` reproduit ce que fait l'interface à la suppression d'un compagnon (`deletePerson` le retire de tous les plans) et d'un chantier.

### Les écritures d'affectation sont des opérations, pas des états

Le client n'envoie plus « voici tout le plan » mais « pose », « retire », « remplace l'équipe de ce jour », « applique ce plan de semaine ». Chaque opération s'exécute dans une transaction qui, hors urgence, retire d'abord la personne de ses autres chantiers ce jour-là (comportement actuel d'`assignDay`), puis insère. La contrainte garantit le résultat même si deux appareils agissent au même instant.

Les champs d'un chantier ou d'un compagnon (code, note, coches, niveaux…) s'écrivent, eux, avec **verrou optimiste** : une colonne `version`, un `409` si elle a bougé, et le client rejoue sa mutation sur la donnée fraîche (ADR à venir sur la synchronisation, W3/W4).

### Identifiants

`VARCHAR(40)`, fournis par le client. Un chantier créé hors ligne doit avoir son identifiant avant d'atteindre le serveur. Les identifiants existants (`p_erwan`, `s_9md49`, `p_x7k2m1`) sont repris tels quels.

## Conséquences

- La forme `Site.plan` que manipulent le domaine et l'interface **ne change pas** : l'API la recompose à la lecture. Le domaine reste intouché (principe 3).
- La migration Supabase → MySQL déplie chaque plan en lignes. Un plan historique qui contiendrait déjà un doublon (même personne sur deux chantiers un même jour, posé en urgence : l'urgence n'était pas mémorisée) serait refusé par la contrainte. La migration marque alors la seconde affectation `urgence = TRUE` et le signale dans son rapport — aucune donnée perdue.
- Coût : la lecture d'un chantier devient une jointure. Pour une équipe de cette taille (quelques milliers de lignes par an), sans conséquence mesurable.
- Le mode urgence de l'interface devra transmettre le drapeau à chaque opération. Aujourd'hui il n'est qu'un état d'écran.
