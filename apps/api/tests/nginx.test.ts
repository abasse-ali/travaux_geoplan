import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* nginx devant l'API (infra/nginx/emplacements.conf). La pile Docker
   n'a pas de test à elle : ce qui s'y vérifie en marche est joué par la
   recette (W8). Ici, ce qu'une relecture de la configuration suffit à
   garder. */
const lire = (f: string): string => readFileSync(new URL("../../../infra/nginx/" + f, import.meta.url), "utf8")
  .replace(/#.*$/gm, "");
const conf = lire("emplacements.conf");
const principale = lire("nginx.conf");

/* Les emplacements qui passent à l'API, avec leur contenu. */
const versLApi = [...conf.matchAll(/location\s+([^{\s]+)\s*\{([^}]*)\}/g)]
  .filter(m => /proxy_pass\s+http:\/\/api:/.test(m[2]!))
  .map(m => ({ chemin: m[1]!, corps: m[2]! }));

const secondes = (v: string): number => {
  const m = /^(\d+)(ms|s|m)?$/.exec(v);
  if (!m) throw new Error("durée illisible : " + v);
  return Number(m[1]) / (m[2] === "ms" ? 1000 : 1) * (m[2] === "m" ? 60 : 1);
};

describe("nginx devant l'API", () => {
  it("trouve les trois emplacements de l'API", () => {
    expect(versLApi.map(e => e.chemin)).toEqual(["/api/", "/api/dispo/", "/socket.io/"]);
  });

  /* Constat P8 (W8) : sans ce délai, nginx attend 60 s qu'une connexion
     à l'API s'établisse. L'API arrêtée, la page du compagnon restait
     une minute sur « Chargement… » avant de dire « Connexion
     impossible ». */
  it("renonce vite à une API qui ne répond pas", () => {
    for (const e of versLApi) {
      const d = /proxy_connect_timeout\s+(\S+);/.exec(e.corps);
      expect(d, e.chemin).not.toBeNull();
      expect(secondes(d![1]!), e.chemin).toBeLessThanOrEqual(10);
    }
  });

  /* Constat R4 (relecture de la recette, W8) : nginx servait tout sans
     compression ; dispo.html pesait 177 ko sur le fil. */
  it("compresse les pages et les fichiers de l'application", () => {
    expect(principale).toMatch(/\bgzip\s+on;/);
    const types = /gzip_types\s+([^;]+);/.exec(principale)?.[1].split(/\s+/) ?? [];
    expect(types).toEqual(expect.arrayContaining(["text/css", "application/javascript"]));
  });
});
