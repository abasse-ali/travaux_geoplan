# Geoplan

Affectation des compagnons aux chantiers, au doigt, depuis un téléphone.
Douze étapes par chantier découpées en missions, cinq corps de métier notés
de 1 à 5, affectation jour par jour sur sept jours, composition d'équipe
assistée, et relance automatique des disponibilités chaque samedi.

React + Vite + Framer Motion. Les données vivent dans **votre** base
Supabase, ou dans le navigateur tant qu'aucune base n'est configurée.

---

## Démarrer

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # produit dist/
```

L'application fonctionne sans rien configurer : les données restent alors
sur l'appareil, et un bandeau ambre le rappelle. Pour partir de votre
effectif plutôt que d'un écran vide : bouton d'état en haut à droite →
**Restaurer** → `data/effectif.json`.

---

## Mise en service

### 1. La base

1. Créez un projet sur [supabase.com](https://supabase.com), région européenne.
2. **SQL Editor → New query** : collez [`supabase/schema.sql`](supabase/schema.sql), exécutez.
3. Même chose avec [`supabase/seed.sql`](supabase/seed.sql) — vos 13 compagnons et 3 chantiers.

### 2. Les clés

**Project Settings → API**, puis dans [`src/config.js`](src/config.js) :

```js
export const SUPABASE_URL = "https://xxxxxxxxxxxxxxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_...";
```

| Clé | Où elle va |
| --- | --- |
| `sb_publishable_…` | **Ici.** Publique par construction, faite pour vivre dans une page web. |
| `sb_secret_…` | Nulle part dans ce projet. Elle contourne toutes les règles d'accès. |

L'application refuse de démarrer en mode synchronisé si elle détecte une
clé `sb_secret_`, et le dit dans la console.

### 3. Qui se connecte

L'application est faite pour **une personne** : le chef d'équipe qui
répartit les chantiers. Les compagnons, eux, n'ont pas de compte — ils
reçoivent un lien nominatif et n'ouvrent que leur propre formulaire.

Dans *Authentication → Sign In / Providers → Email*, **désactivez
« Confirm email »** : la création du compte ouvre alors la session
immédiatement, sans aucun message à attendre.

Faites-lui ensuite créer son compte **avant** de fermer les inscriptions à
l'étape 5, sinon il restera dehors. Pour l'inviter après coup :
*Authentication → Users → Invite user*.

### 4. Les adresses de retour  ⚠️

**Authentication → URL Configuration** :

- **Site URL** : `https://geonew.netlify.app`
- **Redirect URLs** : `https://geonew.netlify.app/**`

### 5. Fermer la porte  ⚠️

Dès que votre équipe s'est connectée une première fois :
**Authentication → Sign In / Providers → Email** → décochez
**Allow new users to sign up**. Sinon n'importe qui connaissant l'adresse
peut se créer un compte et voir vos chantiers.

### 6. Déployer

Le dépôt contient [`netlify.toml`](netlify.toml) : Netlify compile
lui-même, il n'y a plus de dossier à déposer à la main.

- **Netlify** — connectez le dépôt, ou `npx netlify deploy --prod`
- **Vercel** — `npx vercel --prod`
- **Autre hébergeur** — `npm run build` puis envoyez `dist/`

> **Le site doit être public.** Si Netlify affiche une page « Login
> Redirect », la protection visiteurs est active : *Site configuration →
> Access & security → Visitor access → Public*. Sinon vos compagnons
> tomberont sur un mur de connexion Netlify avant d'atteindre le
> formulaire de disponibilité.

### 7. Sur l'iPhone

Ouvrez l'adresse dans **Safari**, puis **Partager → Sur l'écran d'accueil**.

---

## La relance automatique du samedi

Chaque samedi matin, un e-mail nominatif part vers chaque compagnon avec un
lien vers son formulaire. Ceux qui ont déjà répondu ne sont pas relancés.
Aucune intervention.

### Pourquoi un e-mail et pas un SMS

Aucune page web ne peut envoyer un SMS — il n'existe pas d'API pour cela,
sur aucun téléphone. Un envoi automatique suppose donc un serveur et un
fournisseur. L'e-mail est gratuit (300/jour chez Brevo, 3 000/mois chez
Resend) ; le SMS coûterait 2 à 3 € par mois pour votre équipe. Le SMS reste
possible à la main depuis **Équipe → Demander les dispos**.

### Installation

1. **Déployer la fonction**

   ```sh
   npx supabase login
   npx supabase link --project-ref rllprlaffmujwunwsqox
   npx supabase functions deploy rappel-dispos
   ```

2. **Renseigner les secrets** — Supabase → *Edge Functions → rappel-dispos → Secrets* :

   | Secret | Valeur |
   | --- | --- |
   | `APP_URL` | `https://geonew.netlify.app` |
   | `BREVO_API_KEY` | la clé **API** de Brevo (pas la clé SMTP) |
   | `MAIL_FROM` | l'adresse expéditrice validée chez Brevo |
   | `MAIL_FROM_NAME` | le prénom du chef d'équipe — c'est lui qui signe |
   | `MAIL_REPLY_TO` | son adresse, pour que les réponses lui arrivent |
   | `CRON_SECRET` | un mot de passe de votre choix |

   Brevo délivre **deux** clés distinctes, à ne pas confondre : la clé
   **SMTP** va dans Supabase → *Authentication → SMTP Settings* pour les
   mails de connexion ; la clé **API** va ici, pour les rappels.

   Brevo demande seulement de valider une adresse d'expéditeur ; Resend
   exige un domaine vérifié. Pour commencer sans domaine, prenez Brevo.

3. **Programmer le rendez-vous** — collez [`supabase/cron.sql`](supabase/cron.sql)
   dans le SQL Editor après y avoir remplacé les trois valeurs entre chevrons.

4. **Essayer sans attendre samedi** :

   ```sh
   curl -X POST https://rllprlaffmujwunwsqox.supabase.co/functions/v1/rappel-dispos \
        -H "x-cron-key: VOTRE_CRON_SECRET"
   ```

   La fonction répond par un bilan : envois, personnes ayant déjà répondu,
   erreurs détaillées. Elle est idempotente — la relancer n'envoie rien en
   double et ne change aucun jeton déjà distribué.

---

## Au quotidien

| Geste | Effet |
| --- | --- |
| Bande des jours | Choisit le jour affiché — tout s'affecte à CE jour |
| Appui long sur une puce, puis glisser | Pose un compagnon sur un chantier |
| Appui sur une puce posée | Réglage jour par jour sur ce chantier |
| Glisser une puce vers le vivier | Le retire de ce jour |
| Titre d'une étape | Déplie ses missions — une seule étape ouverte à la fois |
| Case à cocher d'une mission | Fait avancer la barre : 3 missions sur 4 = 75 % |
| Glisser sur la barre | Même chose, par crans : à 0 tout se décoche |
| Pastille du vivier | Le déplie à la hauteur de son contenu — ou reçoit une puce |
| Interrupteur **Urgence** | Autorise un compagnon sur deux chantiers le même jour |
| **Composer** | Propose une équipe pour un chantier, et explique chaque choix |
| Onglet **Semaine** | Grille chantiers × 7 jours |
| **Répartir toute l'équipe** | Affecte tout le monde, tous chantiers en concurrence |
| **Partager le brief** | Le texte du jour, prêt à coller dans un message |

Le bouton d'état, en haut à droite, dit toujours où en sont les données :
**À jour**, **N en attente** (hors ligne, réessais toutes les 6 s), ou **Local**.

### La connexion se fait par mot de passe

On se connecte **une fois**. La session est conservée sur l'appareil et
rafraîchie automatiquement : l'écran de connexion ne réapparaît qu'après une
déconnexion explicite.

C'est aussi la seule forme qui ne dépend d'aucun e-mail. Un lien de connexion
ouvert dans Mail crée la session dans Safari — or sur iPhone, une application
posée sur l'écran d'accueil possède **son propre stockage, séparé de Safari**,
et n'en saurait rien. Un mot de passe traverse cette frontière, et le trousseau
iOS le retient.

Pour que la création de compte n'envoie aucun message, désactivez
**Confirm email** dans *Authentication → Sign In / Providers → Email*.

---

## Comment ça marche

### La mission est l'unité de travail

Chaque mission porte son corps de métier, le **niveau minimum** qu'elle
exige et sa charge :

| Mission | Métier | Niveau | Charge |
| --- | --- | --- | --- |
| Tableau électrique | Électricité | 4 | 3 j·h |
| Joints de placo | Plâtrerie | 4 | 5 j·h |
| Pose du parquet | Menuiserie | 4 | 6 j·h |
| Pose cuisine | Menuiserie | 5 | 7 j·h |
| Amenée matérielle | main-d'œuvre | 1 | 1 j·h, permis |

La charge d'une étape est la somme de ses missions, et le poids de chaque
métier s'en déduit. 114 j·h au total pour un T2/T3, modulés par le volume
du chantier. Cocher une mission la retire du besoin.

### Ce que le moteur pèse

**Le seuil avant la moyenne.** Amener l'équipe au niveau qu'une mission
exige débloque du travail ; un demi-niveau sur un métier déjà couvert n'en
débloque aucun.

**Ce qui tombe bientôt.** L'étape en cours pèse 1, la suivante 0,65, puis
0,48. Les seuils ne sont réclamés que sur l'étape en cours et les deux
suivantes.

**La couverture, pas le cumul.** Une équipe vaut, pour un métier, le niveau
de son meilleur spécialiste.

**L'encadrement.** Un novice seul est pénalisé de plus de moitié ; à côté
de quelqu'un d'expérimenté, il retrouve toute sa valeur.

**La continuité.** Reprendre l'équipe de la veille vaut un quart de bonus.

**Les rendements décroissants.** Le cinquième homme sur un T2 gêne plus
qu'il n'aide.

### Deux portées

**Composer** ne raisonne que sur un chantier. **Répartir toute l'équipe sur
la semaine** met tous les chantiers en concurrence sur les mêmes personnes,
jour par jour : glouton sur le gain marginal, puis une passe d'échanges deux
à deux. Ce n'est pas l'optimum mathématique — le problème est NP-difficile —
mais sur trois chantiers et treize compagnons, le mode isolé réclame neuf
fois la même personne pour deux chantiers là où le répartiteur n'en réclame
aucune, en reconduisant 88 % des équipes d'un jour sur l'autre.

### L'unité d'affectation est le jour

Un chantier porte un plan journalier indexé par date réelle :

```json
{ "2026-09-01": ["p_erwan", "p_nixon"], "2026-09-05": ["p_quentin"] }
```

La règle « un homme, un chantier » s'applique **par jour**. La semaine
compte sept jours : le samedi se travaille couramment, le dimanche parfois.

---

## Les fichiers

```
index.html · dispo.html      les deux pages
src/config.js                vos clés Supabase          ← à remplir
src/domain.js                métier pur : étapes, missions, calendrier, moteur
src/store.js                 persistance : cache local, file d'attente, Supabase
src/ui/App.jsx               coque, onglets, actions
src/ui/Chantiers.jsx         fiches chantier, étapes, missions
src/ui/Semaine.jsx           grille chantiers × jours
src/ui/Equipe.jsx            effectif et disponibilités
src/ui/Island.jsx            le vivier, en îlot qui se déforme
src/ui/Gate.jsx              connexion par code
src/ui/sheets.jsx            toutes les feuilles du bas
src/ui/useDrag.js            glisser-déposer tactile
src/dispo.jsx                page de réponse du compagnon
supabase/schema.sql          tables, règles d'accès, fonctions du lien
supabase/seed.sql            effectif et chantiers de départ
supabase/cron.sql            le rendez-vous du samedi
supabase/functions/          la fonction d'envoi
tools/make-icons.cjs         régénère les icônes    (npm run icons)
tools/make-seed.cjs          régénère seed.sql      (npm run seed)
legacy/                      la version précédente, sans framework
```

`src/domain.js` n'a **pas** changé lors du passage à React : le métier ne
dépend d'aucun framework, et c'est ce qui a rendu la réécriture sûre.

---

## Limites connues

- Écriture en **dernier arrivé, dernier servi**. Sans conséquence à
  l'échelle d'une équipe, à savoir tout de même.
- Toute personne connectée peut tout lire et tout écrire. Il n'y a pas de
  rôle « lecture seule » — d'où l'importance de l'étape 4.
- Une étape à mission unique est tout ou rien : son pourcentage ne peut
  valoir que 0 ou 100.
- Le compagnon qui répond n'a pas de compte : le jeton de son lien est sa
  seule clé, et il n'ouvre qu'une ligne, la sienne, pour une semaine.
