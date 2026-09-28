/* ============================================================
   Amorcer une base neuve depuis un fichier d'effectif

     npm run amorcer -w @geoplan/api                 (data/effectif.json)
     npm run amorcer -w @geoplan/api -- fichier.json [--a-blanc]

   Le fichier a la forme d'une sauvegarde de l'application
   ({ people, sites }) : data/effectif.json, ou un export fait depuis
   « Données › Exporter ». Lit DATABASE_URL dans l'environnement.

   Refuse une base qui a déjà des compagnons ou des chantiers : lancé
   par erreur sur la base en service, il réécrirait les plans et les
   coches des vrais chantiers qui portent les mêmes identifiants.
   --forcer passe outre, en connaissance de cause.
   ============================================================ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ouvrirBase, migrer } from "../db/client.ts";
import type { Person, Site } from "@geoplan/domain";
import { compter, importer } from "../migration/importer.ts";

const args = process.argv.slice(2);
const aBlanc = args.includes("--a-blanc");
const forcer = args.includes("--forcer");
const chemin = args.find(a => !a.startsWith("--"))
  ?? fileURLToPath(new URL("../../../../data/effectif.json", import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL manquant."); process.exit(1); }

const brut = JSON.parse(readFileSync(resolve(chemin), "utf8")) as { people?: unknown; sites?: unknown };
if (!Array.isArray(brut.people) || !Array.isArray(brut.sites)) {
  console.error("Ce fichier n'a pas la forme d'une sauvegarde Geoplan ({ people, sites }).");
  process.exit(1);
}

const base = ouvrirBase(url);
try {
  await migrer(url);
  const deja = await compter(base.db);
  if ((deja.people || deja.sites) && !forcer) {
    console.error(`La base n'est pas vide (${deja.people} compagnon(s), ${deja.sites} chantier(s)) : amorçage refusé.`
      + "\nL'amorçage est fait pour une base neuve. --forcer pour passer outre.");
    process.exitCode = 1;
  } else {
    const rapport = await importer(base.db, { people: brut.people as Person[], sites: brut.sites as Site[], avail: [] }, { aBlanc });
    console.log(JSON.stringify(rapport, null, 2));
  }
} finally {
  await base.fermer();
}
