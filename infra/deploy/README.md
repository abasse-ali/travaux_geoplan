# Déployer Geoplan sur un VPS

Pour le propriétaire du dépôt. Environ une heure la première fois. Rien de tout cela n'est fait tant que tu n'as pas dit « on bascule » (W7).

## Ce qu'il faut avant de commencer

| Quoi | Pourquoi | Coût indicatif |
|---|---|---|
| Un VPS Linux (Debian 12 ou Ubuntu 24.04), 2 Go de mémoire, 20 Go de disque | MySQL, Redis, l'API et nginx tiennent largement | Hetzner CX22 ≈ 4 € / mois ; Scaleway DEV1-S ≈ 7 € / mois |
| Un nom de domaine | Le cookie de session exige https ; les liens des compagnons pointent dessus | ≈ 10 € / an |
| Un compte Cloudflare (gratuit) | Le domaine passe par Cloudflare : certificat, cache des fichiers, protection | 0 € |
| La clé API Brevo actuelle | La relance du samedi | déjà en place |

## 1. Le serveur

```sh
# En root, sur le VPS neuf.
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 git ufw unattended-upgrades
ufw allow OpenSSH && ufw allow 443/tcp && ufw enable
adduser --disabled-password geoplan && usermod -aG docker geoplan
```

Les mises à jour de sécurité s'installent seules (`unattended-upgrades`).

**Attention : ufw ne voit pas les ports publiés par Docker.** Docker les ouvre dans ses propres règles, avant celles d'ufw. C'est pourquoi la configuration ne publie rien d'autre que 443 vers l'extérieur :
- MySQL et Redis ne sont pas publiés du tout : seuls les conteneurs les joignent ;
- le port http n'est publié que sur `127.0.0.1` (`HTTP_BIND`), pour les vérifications faites depuis le serveur.

## 2. Le code et la configuration

```sh
su - geoplan
git clone <adresse du dépôt> geoplan && cd geoplan
cp infra/.env.example infra/.env
chmod 600 infra/.env
```

Dans `infra/.env` :

- `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` : deux valeurs longues et aléatoires, par exemple la sortie de `openssl rand -hex 24`. Pas de base64 : un « / » ou un « + » dans le mot de passe casserait l'adresse de connexion à MySQL que compose construit.
- `APP_ORIGIN=https://<ton domaine>`, sans barre finale.
- `TRUST_PROXY=1`. nginx calcule lui-même l'adresse du client, Cloudflare compris (`infra/nginx/adresse-client.conf`). Une valeur plus haute ferait croire à l'API une adresse écrite par le client.
- `MAIL_MODE=a-blanc` pour commencer. Passer à `brevo` le jour de la bascule, avec `BREVO_API_KEY`, `MAIL_FROM` (l'adresse validée chez Brevo), `MAIL_FROM_NAME` (le prénom du chef d'équipe) et `MAIL_REPLY_TO` (son adresse).
- `HTTP_PORT=80`, et `HTTP_BIND=127.0.0.1` tel quel.

## 3. Le certificat : Cloudflare devant

1. Ajoute le domaine dans Cloudflare, fais pointer un enregistrement `A` vers l'adresse IP du VPS, **nuage orange** (proxy activé).
2. *SSL/TLS → Overview* : **Full (strict)**.
3. *SSL/TLS → Origin Server → Create Certificate* : un certificat d'origine valable 15 ans. Copie le certificat dans `infra/nginx/tls/origine.pem` et la clé dans `infra/nginx/tls/origine.key` sur le serveur (jamais dans le dépôt : `infra/nginx/tls/` est ignoré par git).
4. Active le bloc TLS de nginx : copie `infra/nginx/geoplan-tls.conf.exemple` en `infra/nginx/geoplan-tls.conf`. La surcouche `infra/docker-compose.tls.yml` publie le port 443 et monte le certificat et ce bloc ; elle s'ajoute à chaque commande `docker compose` (étapes 4 et 6).
5. Dans Cloudflare, *SSL/TLS → Edge Certificates* : **Always Use HTTPS**.

nginx ne croit l'adresse client transmise par Cloudflare (`CF-Connecting-IP`) que si la connexion vient d'une adresse Cloudflare. La liste est dans `infra/nginx/adresse-client.conf` ; relis-la une fois l'an sur `cloudflare.com/ips`. Quelqu'un qui joindrait le VPS sans passer par Cloudflare ne peut donc pas choisir l'adresse que voit la limitation de débit.

Recommandé en plus : ne laisser joindre le port 443 que par Cloudflare, pour que l'adresse du VPS ne serve à rien. ufw ne le peut pas (voir l'étape 1) ; il faut le dire à Docker, dans sa chaîne `DOCKER-USER` :

```sh
# En root. La règle DROP d'abord, puis une exception par plage Cloudflare,
# insérées au-dessus d'elle. --ctorigdstport : le port avant la traduction
# de Docker. -i : seulement ce qui ARRIVE par l'interface publique ; sans
# lui, les appels de l'API vers Brevo (port 443 lui aussi) seraient bloqués.
IF=$(ip route show default | awk '{print $5; exit}')      # souvent eth0
iptables -I DOCKER-USER -i "$IF" -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j DROP
for plage in $(curl -s https://www.cloudflare.com/ips-v4); do
  iptables -I DOCKER-USER -i "$IF" -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -s "$plage" -j RETURN
done
apt install -y iptables-persistent && netfilter-persistent save
```

## 4. Démarrer

```sh
cd ~/geoplan/infra
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
curl -s http://127.0.0.1/api/health     # {"ok":true,"mysql":true,"redis":true}
```

Créer le compte de Geoffrey (le mot de passe se tape, il ne s'affiche pas) :

```sh
docker compose exec api node --disable-warning=ExperimentalWarning apps/api/src/cli/compte.ts creer <adresse de Geoffrey>
```

## 5. Les sauvegardes

Chaque nuit, un vidage complet de la base, gardé 14 jours :

```sh
crontab -e
# 30 3 * * *  /home/geoplan/geoplan/infra/deploy/sauvegarde.sh >> /home/geoplan/sauvegardes.log 2>&1
```

**Une sauvegarde qui n'a jamais été restaurée n'est qu'une hypothèse.** Une fois par mois, et avant chaque bascule :

```sh
infra/deploy/verifier-sauvegarde.sh sauvegardes/<le plus récent>.sql.gz
```

Le script restaure dans un MySQL jetable, jamais dans la base en service, et compare les comptes de chaque table.

Copie les sauvegardes hors du serveur (un seau S3, un autre VPS, ton ordinateur) : si le serveur disparaît, ses sauvegardes disparaissent avec lui. Par exemple avec `rclone copy` dans la même tâche cron.

## 6. Mettre à jour

```sh
cd ~/geoplan && git pull
cd infra && docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

Les migrations de la base s'appliquent seules au démarrage de l'API. Une migration n'est jamais modifiée une fois livrée : on en ajoute une.

## 7. Revenir en arrière

Tant que Supabase reste en service (période de double lecture, W7), revenir en arrière tient en une variable de l'application : sa source de données repasse de `api` à `supabase`, puis on reconstruit. La relance du samedi doit alors être réactivée côté Supabase **et** coupée côté API (`RAPPEL_ACTIF=false`) dans le même créneau, pour qu'aucun compagnon ne reçoive deux e-mails.
