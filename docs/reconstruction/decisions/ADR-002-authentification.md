# ADR-002 — Authentification et sessions de l'API

**Statut** : accepté (W3 l'implémente) · **Date** : 2026-09-25

## Contexte

- Geoffrey se connecte depuis la PWA posée sur l'écran d'accueil de son iPhone. Sur iOS, cette application a **son propre stockage, séparé de Safari** : un lien ou un code reçu par e-mail ouvre une session dans Safari, pas dans la PWA. C'est pour cela que la connexion est passée au mot de passe (commit `c471cc5`). **Aucun flux ne doit dépendre d'un lien ou d'un code reçu.**
- Il se connecte **une fois** : la session doit durer, et se prolonger toute seule à l'usage.
- L'équipe compte un ou deux comptes. Il n'y a pas d'inscription publique.
- Supabase reste en service jusqu'à la bascule (W7). Cette décision ne concerne que l'API Node.

## Décision

### Mots de passe

- Hachage **argon2id** par `@node-rs/argon2` : binaire précompilé (Linux glibc et musl, Windows), aucune compilation native dans l'image Docker.
- Paramètres : 19 Mio de mémoire, 2 passes, parallélisme 1 — le minimum recommandé par l'OWASP, environ 30 ms par vérification sur un petit VPS. La limitation de débit ci-dessous rend une force brute en ligne sans objet ; le coût du hachage ne protège que d'une fuite de la base.
- **Inscription fermée.** Un compte se crée, et un mot de passe se change, par une commande exécutée sur le serveur (`npm run compte -w @geoplan/api -- creer <email>`), qui lit le mot de passe sur l'entrée standard sans l'afficher.
- **Pas de « mot de passe oublié » par e-mail.** Le propriétaire réinitialise avec la même commande. C'est cohérent avec la règle ci-dessus, et cela règle le constat U9 (le lien de réinitialisation actuel ne fait jamais choisir de nouveau mot de passe).

### Sessions

- Identifiant de session : 32 octets aléatoires (`crypto.randomBytes`), en base64url.
- Redis stocke la session sous l'**empreinte SHA-256** de l'identifiant : une copie de Redis ne donne aucune session utilisable.
- Durée **glissante de 180 jours** : chaque requête authentifiée repousse l'échéance, au plus une fois par heure pour ne pas écrire à chaque requête.
- Cookie `geoplan_sid` : `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=15552000`.
- **Même origine** pour l'application et l'API (`https://<domaine>/` et `https://<domaine>/api/`, derrière nginx). C'est ce qui garde le cookie « premier parti » aux yeux de WebKit : un cookie posé par le serveur de la page n'est pas plafonné à 7 jours, alors qu'un cookie écrit en JavaScript, ou posé depuis une autre origine ou une autre adresse IP, peut l'être.
- Déconnexion : suppression de la clé Redis et du cookie. Une commande serveur révoque toutes les sessions d'un compte (`revoquer <email>`), ou les révoque puis supprime le compte (`supprimer <email>`).
- Une session ne vaut que si son compte existe encore : chaque requête authentifiée, et chaque connexion temps réel, le vérifie. Un compte supprimé à la main en SQL emporte donc ses sessions (relecture adversariale de W3).

### Protection des écritures

- `SameSite=Lax` empêche l'envoi du cookie sur un `POST` venu d'un autre site.
- En plus, toute requête qui modifie (`POST`, `PUT`, `PATCH`, `DELETE`) doit porter un en-tête `Origin` égal à l'origine configurée. Double barrière, sans jeton CSRF à gérer côté client.

### Limitation de débit

Un compteur à fenêtre fixe dans Redis (`INCR` + `EXPIRE`, une dizaine de lignes : pas de bibliothèque).

| Route | Limite |
|---|---|
| `POST /api/session` | 10 essais par IP et par quart d'heure ; 5 échecs par adresse e-mail et par quart d'heure |
| `GET/POST /api/dispo/:token` | 60 requêtes par IP et par minute ; 20 par jeton et par minute |

Une adresse IPv6 compte pour son préfixe /64 : un abonné en reçoit un entier, et changer d'adresse dedans ne coûte rien. Une clé ne contient jamais ce que le client a tapé : l'adresse e-mail y entre par son empreinte SHA-256, car on tape parfois son mot de passe dans ce champ (relecture adversariale de W3).

Au-delà : `429` avec `Retry-After`. L'adresse IP retenue est celle que **nginx calcule** : l'en-tête `CF-Connecting-IP` si la connexion vient d'une adresse Cloudflare (`infra/nginx/adresse-client.conf`), l'adresse de la connexion sinon. nginx **remplace** `X-Forwarded-For` par cette adresse, et Express ne fait confiance qu'à nginx (`TRUST_PROXY=1`). Avant la relecture adversariale de W3, nginx complétait l'en-tête et l'API faisait confiance à deux mandataires : un client qui joignait le VPS sans passer par Cloudflare choisissait l'adresse vue par la limitation.

### Journaux

`pino`, avec masquage explicite des champs `password`, `cookie`, `set-cookie`, `authorization`, et du jeton dans les chemins `/api/dispo/:token` (réécrit en `/api/dispo/…`). Un test vérifie qu'aucun de ces secrets n'apparaît dans les journaux d'une connexion et d'une réponse de compagnon.

## Conséquences

- Geoffrey ressaisit son mot de passe **une fois**, dans la PWA, le jour de la bascule (W7). Le trousseau iOS le propose, puisque le formulaire garde ses champs nommés (`name=email`, `name=password`, `autocomplete`).
- Pas d'e-mail de réinitialisation : si Geoffrey perd son mot de passe, le propriétaire le change sur le serveur.
- Une seule catégorie de compte : comme aujourd'hui, tout compte connecté peut tout lire et tout écrire. Des rôles se greffent plus tard sur la table `users` sans rien casser.
