#!/bin/sh
# ============================================================
# Prouver qu'une sauvegarde se restaure
#
#   infra/deploy/verifier-sauvegarde.sh sauvegardes/geoplan-….sql.gz
#
# Restaure le fichier dans un MySQL jetable (jamais dans la base en
# service), puis compte les lignes de chaque table et les compare à la
# base en service. Une sauvegarde qu'on n'a jamais restaurée n'est
# qu'une hypothèse.
# ============================================================
set -eu

FICHIER=${1:?usage : verifier-sauvegarde.sh <fichier.sql.gz>}
RACINE=$(cd "$(dirname "$0")/../.." && pwd)
COMPOSE="docker compose -f $RACINE/infra/docker-compose.yml --env-file $RACINE/infra/.env"
NOM=geoplan-verif-$$

docker run -d --rm --name "$NOM" -e MYSQL_ROOT_PASSWORD=verif -e MYSQL_DATABASE=geoplan mysql:8.4 >/dev/null
trap 'docker stop "$NOM" >/dev/null 2>&1 || true' EXIT
# L'image démarre d'abord un serveur provisoire sans réseau, le temps de
# s'initialiser : on attend le vrai, qui répond en TCP.
until docker exec "$NOM" mysqladmin ping -h 127.0.0.1 -uroot -pverif --silent >/dev/null 2>&1; do sleep 2; done

gzip -dc "$FICHIER" | docker exec -i "$NOM" mysql -h 127.0.0.1 -uroot -pverif geoplan

REQ="SELECT 'people', COUNT(*) FROM people UNION ALL SELECT 'sites', COUNT(*) FROM sites UNION ALL SELECT 'assignments', COUNT(*) FROM assignments UNION ALL SELECT 'avail_requests', COUNT(*) FROM avail_requests UNION ALL SELECT 'users', COUNT(*) FROM users"
RESTAUREE=$(docker exec "$NOM" mysql -h 127.0.0.1 -uroot -pverif -N geoplan -e "$REQ" 2>/dev/null)
EN_SERVICE=$($COMPOSE exec -T mysql sh -c "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N geoplan -e \"$REQ\"" 2>/dev/null)

echo "Restaurée :"; echo "$RESTAUREE"
echo "En service :"; echo "$EN_SERVICE"
if [ "$RESTAUREE" = "$EN_SERVICE" ]; then echo "OK : mêmes comptes."; else echo "ÉCART : à examiner (des écritures ont pu avoir lieu depuis la sauvegarde)." >&2; exit 2; fi
