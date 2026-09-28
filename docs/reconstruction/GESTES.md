# Les gestes qui doivent survivre à la reconstruction

Recette de W8. Chaque ligne est un comportement observable aujourd'hui (commit `364c67a`).
La reconstruction doit le conserver, ou l'améliorer de façon annoncée.

- **Réf.** : identifiant stable, cité par les tests et par le journal.
- **Test** : `e2e` = couvert par Playwright (`e2e/`), `unit` = par Vitest, `manuel` = à jouer à la main en W8.
- ⚠ signale un comportement actuel **défectueux**, consigné dans le journal. La recette vérifie qu'il est corrigé ou, à défaut, qu'il n'a pas empiré.

Les libellés entre guillemets sont les textes exacts de l'interface : ils servent de sélecteurs.

> **Constat U13, corrigé en W1.** Jusqu'au 25 septembre 2026, une écriture sur une fiche chantier (poser, retirer, cocher, régler la barre, reprendre l'équipe, affecter, noter) était enregistrée mais ne s'affichait qu'au changement de jour suivant. Les tests vérifient maintenant que l'écran suit le geste, et relisent aussi l'état après un changement de jour.

---

## A. Se repérer dans le temps

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| A1 | Toucher un jour de la bande des jours (`.daybar [role=tab]`) | Ce jour devient le jour affiché. Tout ce qui s'affecte ensuite s'affecte à CE jour. La pastille glisse sous le jour choisi. | e2e |
| A2 | « Semaine précédente » / « Semaine suivante » | La semaine change de ±7 jours, le jour de la semaine est conservé. Le libellé « Sem. N · plage » passe à l'orange hors de la semaine courante. Les flèches ne bougent jamais : deux appuis rapides avancent de deux semaines (en W4, « Auj. » prenait la place de la flèche et le second appui ramenait à aujourd'hui ; corrigé en W5). | e2e |
| A3 | « Auj. » | N'apparaît que hors du jour courant, entre le libellé et la flèche « Semaine suivante ». Ramène à la semaine et au jour d'aujourd'hui. | e2e |
| A4 | Onglets « Chantiers », « Semaine », « Équipe » | Change d'écran, remonte en haut. L'onglet est retenu d'un lancement à l'autre (`geoplan.ui.v3`). La semaine et le jour, eux, repartent d'aujourd'hui. | e2e |
| A5 | Toucher une case ou un en-tête de jour dans l'onglet Semaine | Bascule sur l'onglet Chantiers, à ce jour-là. | e2e |

## B. Affecter les compagnons

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| B1 | Appui long (190 ms) ou glisser de plus de 8 px sur une puce du vivier, puis lâcher sur la zone d'un chantier | Le compagnon est posé sur ce chantier ce jour-là. Toast « {nom} sur **CODE** · {jour} {date} ». La puce quitte le vivier. Retour haptique là où `vibrate` existe. Au lâcher, le fantôme vient se poser sur la puce, qui paraît à son arrivée (W6). | e2e |
| B2 | Glisser une puce d'un chantier A vers un chantier B, hors urgence | Le compagnon quitte A et rejoint B ce jour-là. Toast « {nom} : **A** → **B** ». | e2e |
| B3 | Glisser une puce posée vers le vivier | Le compagnon est retiré de ce jour, sur tous les chantiers. Toast « {nom} retiré de **CODE** ». Sous la puce, le vivier se gonfle un peu depuis son coin, et reprend sa forme quand elle y tombe (W6). | e2e |
| B4 | Lâcher une puce hors de toute cible | Rien ne change. C'est la seule façon d'annuler un glisser. Un glisser interrompu par le système (appel, notification, centre de contrôle) ne pose rien non plus (U6, corrigé en W6). Le fantôme revient à la puce, qui reprend sa couleur à son retour (W6). | e2e |
| B5 | Poser quelqu'un qui s'est déclaré absent ce jour-là | Le placement est accepté. 2,9 s plus tard, toast « Attention : {nom} s'est déclaré absent ce jour-là ». Sa pastille du jour passe en fuchsia. | e2e |
| B6 | Toucher une puce posée (sans glisser), ou l'activer au clavier (Entrée, Espace ; depuis W5) | Ouvre la fiche du compagnon avec « Jours sur {CODE} · sem. N » : un sélecteur de 7 jours, « Ses jours dispo », « Aucun ». Chaque bascule pose ou retire ce jour sur ce chantier. | e2e |
| B7 | Toucher une puce du vivier | Ouvre la fiche du compagnon sans la section « Jours sur… ». | e2e |
| B8 | Fiche compagnon → « Poser sur · {jour} » → un chantier | Pose le compagnon sur ce chantier ce jour-là et ferme. Le chantier où il est déjà est marqué « ici » et désactivé. | e2e |
| B9 | Fiche compagnon → « Retirer de ce jour » | Le retire de tous les chantiers ce jour-là. | e2e |
| B10 | Fiche compagnon → « Appeler », « SMS », « WhatsApp », ou « Écrire » sans téléphone | Ouvre le lien `tel:`, `sms:`, `wa.me` ou `mailto:` correspondant. « Aucun contact enregistré… » sans coordonnées. | manuel |
| B11 | « Reprendre l'équipe de la veille » (zone vide, équipe la veille) | Repose ceux d'hier qui sont disponibles et libres aujourd'hui. Toast « {N} compagnon(s) reconduit(s) sur **CODE** » ou « Aucun n'est disponible et libre ce jour-là ». | e2e |
| B12 | Interrupteur « Urgence » (vivier déplié) | Toast « **Mode urgence** — un compagnon peut être posé sur deux chantiers le même jour ». Glisser de A vers B **copie** la puce au lieu de la déplacer ; la zone survolée passe en fuchsia. L'état est retenu d'un lancement à l'autre. Le désactiver ne retire pas les doublons existants. | e2e |
| B13 | Hors urgence, toute écriture (glisser, fiche, Composer, Répartir, « Ses jours dispo ») | Un compagnon n'est jamais sur deux chantiers le même jour : il est retiré des autres. | e2e + unit |
| B14 | Le vivier | Ne montre que les compagnons disponibles ET libres ce jour-là, avec leur nombre de jours. « Personne de libre {jour}. » s'il est vide. N'existe que sur l'onglet Chantiers. | e2e |
| B15 | Pastille du vivier replié (« Ouvrir le vivier — N disponible ») | Le déplie à la hauteur de son contenu. « Réduire le vivier » ou la poignée le replie. L'état est retenu. Replié ou déplié, il reçoit une puce qu'on lui lâche dessus. | e2e |

## C. Suivre l'avancement d'un chantier

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| C1 | Accordéon « Les 12 étapes » d'une carte | L'ouvre et déplie l'étape en cours. Un seul chantier ouvert à la fois dans l'application. Pendant qu'un volet s'ouvre, le focus qui y entre ne le fait pas défiler sur lui-même (U26, corrigé en W6). | e2e |
| C2 | Titre d'une étape | Déplie ses missions. Une seule étape ouverte à la fois. | e2e |
| C3 | Case d'une mission (`.task[aria-pressed]`) | La coche ; la barre avance au prorata : 3 missions sur 4 = 75 %. Décocher la fait reculer. | e2e + unit |
| C4 | Glisser sur la barre d'une étape (`role=slider`) | Avance par crans, un cran par mission : glisser coche les N premières missions. À 0, tout se décoche. Un geste vertical est lu comme un défilement. Les crans avancent sous le doigt pendant le geste (U2 et U13, corrigés en W1). Interrompu par le système, le geste ne règle rien et la barre revient à ce qui est enregistré (U23) ; à la souris, elle ne commence pas de sélection de texte (U24) — corrigés en W6. | e2e + unit |
| C5 | Simple appui sur la barre | Bascule l'étape entre 0 et 100 %. ⚠ Geste non documenté, source de fausse manipulation. Seulement sur la barre dessinée : dans sa zone de toucher, plus haute qu'elle (WCAG 2.5.8), un appui ne bascule rien — elle couvre l'espace qui la sépare de la première mission (W5). | e2e |
| C6 | Flèches du clavier sur la barre ; Entrée ou Espace | ±1 cran ; bascule 0/100 %. | e2e |
| C7 | La carte chantier | Montre l'étape en cours (« 01 Démolition · semaine X sur 8 »), « Chantier livré », « démarre le … » ou « période dépassée ». Prévision : « Livré », « N j·h restants · Personne cette semaine », « … j·h posés · fin {date} », « Après le {date} », « N jour(s) en conflit ». Douze barres colorées par métier dominant. | e2e |
| C8 | Accordéon « Note de chantier » | Zone de texte libre, enregistrée à chaque frappe. Un point signale une note non vide. | e2e |

## D. Composer une équipe (un chantier)

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| D1 | « Composer » dans la zone d'un chantier | Feuille « Composition · CODE », sous-titre « Étape N — nom ». Rappel : « Il reste X j·h… il faudrait environ N compagnons… ». | e2e |
| D2 | « Poser sur » : jour affiché ou « Semaine N » (défaut) ; « Taille de l'équipe » 2 à 5 | La proposition se recalcule. Chaque nom porte jusqu'à 3 raisons (« débloque X niv. N », « X N/5 », « main-d'œuvre », « permis », « suite de la veille », « chantier en retard », « rien à sa portée ici », « encadré », « novice sans encadrement ») et « N j posable(s) ». Couverture des métiers, missions hors de portée. | e2e + unit |
| D3 | « Affecter » | Pose l'équipe sur les jours posables de la portée choisie. Toast « **CODE** : N journée(s) posée(s) ». | e2e |

## E. Répartir toute l'équipe (tous les chantiers)

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| E1 | Onglet Semaine → « Répartir toute l'équipe sur la semaine » | Feuille « Répartir la semaine » : « N journées réparties sur M chantiers », « Ce que personne ne couvre » (6 au plus), sept jours dépliables avec chaque nom et sa raison, « Non affectés : … ». Chaque nom porte sa raison, y compris après les échanges (D1, corrigé en W1). | e2e + unit |
| E2 | « Appliquer ce plan » | Remplace le plan de la semaine sur les chantiers visés, y compris en vidant des jours. Hors urgence, retire les personnes des autres chantiers. Toast « **N** journées posées sur la semaine N ». Les noms qui arrivent dans la grille Semaine s'y posent en vague, jour après jour (W6 ; d'un coup sous le mouvement réduit). | e2e |
| E3 | Aucun chantier à pourvoir | « Aucun chantier actif à pourvoir cette semaine. » | e2e |
| E4 | La grille Semaine | Chantiers × 7 jours, jusqu'à 3 initiales puis « +N », cases en fuchsia s'il y a un conflit, ligne « Libres » par jour, « Aucun chantier sur cette semaine. » sinon. | e2e |

## F. Gérer les chantiers

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| F1 | « + » (onglets Chantiers ou Semaine), ou « Ouvrir un chantier » si la liste est vide | Feuille « Nouveau chantier ». L'adresse remplit le code toute seule (« 151 Henri Desbals apt 7 » → « 151HD7 ») tant qu'on ne l'a pas modifié à la main. Début, durée 2/3/4 mois, volume Studio / T2·T3 / T4 et +. | e2e + unit |
| F2 | « Ouvrir le chantier » / « Enregistrer » | Toast « **CODE** ouvert » ou « enregistré ». Sans code : « Il manque le code chantier ». | e2e |
| F3 | « ⋮ » (« Modifier le chantier ») → « Supprimer le chantier » → « Confirmer — l'équipe sera libérée » | Suppression en deux temps. Toast « **CODE** supprimé ». | e2e |
| F4 | « Partager le brief » | Le texte du jour (chantiers, étapes, équipes) via la feuille de partage du téléphone, sinon copié : « Copié — collez-le dans votre message ». Le contenu porte sur le jour affiché (U1, corrigé en W1). | e2e |

## G. Gérer l'équipe

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| G1 | « + » (onglet Équipe), ou « Ajouter un compagnon » | Feuille « Nouveau compagnon » : nom, e-mail, téléphone, remarque, jours habituels, permis, cinq métiers notés de 1 à 5. | e2e |
| G2 | « Ajouter au vivier » / « Enregistrer » | Contrôles dans l'ordre : « Il manque le nom », « Il faut au moins un jour de présence », « Ce numéro n'a pas l'air valide », « Cette adresse e-mail n'est pas valide ». Téléphone normalisé en +33. Toast « **nom** ajouté au vivier » ou « enregistré ». | e2e + unit |
| G3 | Toucher une ligne de l'onglet Équipe | Ouvre directement la fiche d'édition. La ligne montre les chantiers de la semaine ou « Libre », les jours, « a répondu » / « relancé » / « pas d'e-mail », « permis », les niveaux. | e2e |
| G4 | « Supprimer {nom} » → « Confirmer la suppression » | Le retire de l'effectif et de tous les plans. Toast « {nom} supprimé ». | e2e |
| G5 | « Demander les dispos · semaine N » | Feuille « Demander les dispos ». Connecté : une ligne par compagnon avec e-mail, « SMS » et « Lien » (toast « Lien copié »). Hors connexion : message qui demande de se connecter. À partir du vendredi, la semaine visée est la suivante. Ouvrir la feuille ne crée rien : le lien d'un compagnon est créé quand on touche « SMS » ou « Lien », et lui seul passe « en attente » (corrigé en W4, constat U11). | e2e (trois sources) + manuel (copie du lien sur iPhone) |
| G6 | Réponse d'un compagnon reçue en direct | Toast « **nom** a répondu pour la semaine N », et ses jours de la semaine se mettent à jour. | manuel |

## H. Données, synchronisation, sauvegarde

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| H1 | Bouton d'état en haut à droite | Dit toujours où en sont les données : « À jour », « N en attente », « Local », « … » pendant un envoi, et tant qu'aucune lecture du serveur n'a réussi depuis le lancement. Hors ligne, les écritures repartent seules au retour du réseau, et toutes les 6 s. | e2e (trois sources) + manuel (mode avion) |
| H2 | Bouton d'état → feuille « Données » | « Stockage local » / « Synchronisé » ; le compte, et où sont les données ; « N compagnons · M chantiers » ; « N modifications en attente d'envoi » avec « Réessayer l'envoi » ; un avertissement si le stockage du navigateur est plein ; « Se déconnecter ». | e2e (trois sources) |
| H3 | « Exporter un fichier de sauvegarde » (Équipe ou Données) | Télécharge `geoplan-AAAA-MM-JJ.json` (`{app, v:3, exportedAt, people, sites}`). Toast « Sauvegarde téléchargée ». | e2e |
| H4 | Restaurer : choisir un fichier, ou coller le JSON, puis « Remplacer les données » | Un premier toucher annonce ce qui va être remplacé ; « Confirmer : tout sera remplacé » remplace (corrigé en W4, constat U7). Toast « N compagnons et M chantiers restaurés », ou tout de suite « Sauvegarde illisible — vérifiez le fichier ». `data/effectif.json` s'importe. En mode connecté, les fiches absentes du fichier sont supprimées sur le serveur. | e2e (trois sources) |
| H5 | Lancer l'application | L'écran s'affiche depuis le cache, sans attendre le réseau, même hors ligne avec une session expirée (corrigé en W4, constat S10). Les écritures en attente d'une session précédente repartent, y compris celles de la version d'avant W4. | e2e (trois sources) + manuel |
| H6 | Sans base configurée | Bandeau « **Mode local** — les données restent sur cet appareil… ». Pas d'écran de connexion. | e2e |
| H7 | Deux appareils connectés | Une modification sur l'un apparaît sur l'autre sans recharger. | manuel |

## I. Connexion

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| I1 | Premier lancement connecté | Écran « Geoplan » : e-mail (« vous@exemple.fr »), « Mot de passe », « Se connecter ». Bouton inactif tant que l'e-mail fait 3 caractères ou moins ou le mot de passe moins de 6. Champs nommés pour le trousseau iOS. | e2e |
| I2 | Erreur de connexion | « Adresse ou mot de passe incorrect. Si vous n'avez pas encore de compte, créez-le. » | e2e |
| I3 | Lancements suivants | Aucune reconnexion : la session est conservée sur l'appareil et rafraîchie seule, y compris dans la PWA posée sur l'écran d'accueil. **Aucun flux ne dépend d'un lien ou d'un code reçu par e-mail.** | manuel |
| I4 | « Créer un compte », « Mot de passe oublié », « Revenir à la connexion » | Changent de mode. ⚠ Le lien de réinitialisation ouvre une session sans faire choisir de nouveau mot de passe. | manuel |
| I5 | « Se déconnecter » (feuille Données) | Retour à l'écran de connexion. | manuel |

## J. La page du compagnon (`dispo.html`)

Parcours complet, sans compte, depuis le lien reçu chaque samedi.

| Réf. | Geste | Résultat attendu | Test |
|---|---|---|---|
| J1 | Ouvrir `dispo.html?t=<jeton>` | « Chargement… », puis « Bonjour {nom} », « Semaine du {plage} », sept jours (« Lundi » + date). Réponse précédente pré-cochée, rien sinon. | e2e |
| J2 | Toucher un jour | Le bascule (`aria-pressed`). | e2e |
| J3 | Mot facultatif (« Un mot à ajouter ? (facultatif) ») | Tronqué à 300 caractères à l'envoi. | e2e |
| J4 | « Envoyer mes disponibilités » (ou « Mettre à jour ma réponse ») | « Envoi… », puis « C'est envoyé, merci {nom} » et « …tu es noté disponible : lundi, mardi. » ou « …indisponible toute la semaine. », plus le message transmis. ⚠ Au-delà de 300 caractères, l'écran affiche le mot entier alors que la base n'en reçoit que 300 (U14). | e2e |
| J5 | Envoi refusé ou réseau coupé | « L'envoi n'a pas abouti. Vérifiez votre réseau et réessayez. » ⚠ Si la requête lève une exception, le bouton reste bloqué sur « Envoi… ». | e2e |
| J6 | Lien sans jeton | « Lien incomplet ». | e2e |
| J7 | Jeton inconnu ou expiré | « Lien expiré ». | e2e |
| J8 | Base injoignable | « Connexion impossible ». | e2e |
| J9 | Rouvrir le lien après avoir répondu | Le formulaire revient avec la réponse, bouton « Mettre à jour ma réponse ». | e2e |
| J10 | Ouvrir un nouveau lien la semaine suivante, sur le même téléphone | Le formulaire s'affiche, même quand le service worker est installé (P1, corrigé en W1 : il servait `index.html`). | e2e |
| J11 | Poids de la page | Ne grossit pas de plus de 10 % (référence mesurée dans le journal). | mesure |

## K. Transverses

| Réf. | Comportement | Attendu | Test |
|---|---|---|---|
| K1 | Mobile portrait, pouce | Tout geste se fait d'une main sur un iPhone ; le desktop fonctionne. | e2e (viewport iPhone) |
| K2 | Mode sombre | Suit `prefers-color-scheme`. | manuel (captures W5) |
| K3 | `prefers-reduced-motion` | Coupe les animations décoratives : les animations CSS, la feuille du bas, et ce que joue le script (Web Animations : le vivier qui change de forme, le trait sous l'onglet, un volet qui se déplie). L'état final paraît d'un coup. Un tour de chaque geste qui bougeait le vérifie : plus rien ne bouge, ni animation, ni transition, ni délai (W6). (U10, corrigé en W5 ; Framer Motion retiré en W6.) | e2e |
| K4 | Feuilles du bas | Se ferment par le fond, par Échap, par « Fermer », ou glissées vers le bas (un petit glisser les laisse revenir). Au clavier, le focus reste dans la feuille, puis revient d'où il venait. Le sous-titre est annoncé. Pendant 260 ms après l'ouverture, elles ignorent le doigt. Si leur code ne se charge pas, la fiche ne s'ouvre pas et un message demande de recharger ; le planning reste. | e2e |
| K5 | Toasts | Deux au plus, 2,8 s chacun, centrés en bas de l'écran (U15, corrigé en W1). Ils ne prennent pas le doigt : ce qu'ils couvrent reste à portée, une puce lâchée sur le vivier sous un toast y retourne (U22, corrigé en W6). Ils entrent en montant et s'éteignent avant de partir. | e2e |
| K6 | Une entrée ne se rejoue pas | Une animation d'entrée (le libellé de la semaine, « Auj. », le fondu d'un onglet, une puce, une fiche) ne se joue qu'à l'arrivée de ce qu'elle présente, jamais quand l'application se redessine ; au premier affichage non plus, même quand la coque a d'abord attendu ses données (V5 et V6, corrigés en W6). | e2e |
| K7 | « Sons des gestes » (feuille « Données », sur cet appareil) | Éteint par défaut. Allumé : une note brève qui monte quand on pose un compagnon (glisser, ou un jour de sa fiche), une qui descend quand on le retire ; l'allumer la fait entendre une fois. Retenu d'un lancement à l'autre. Se tait avec le bouton de silence de l'iPhone, et se mêle à la musique au lieu de la couper (W6). | e2e |
| K8 | La relance du samedi | Chaque samedi à 9 h (Paris), un e-mail nominatif part vers chaque compagnon ayant une adresse et n'ayant pas répondu. Jamais deux fois le même jour. | manuel (W3/W7) |
