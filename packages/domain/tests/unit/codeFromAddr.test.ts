/* Le code chantier proposé à partir de l'adresse : numéro de voie,
   initiales de la rue, numéro d'appartement. Ce n'est qu'une proposition
   (le champ reste modifiable), mais Geoffrey la lit sur chaque carte :
   la reconstruction doit la reproduire à l'identique, défauts compris. */

import { describe, expect, it } from "vitest";
import { codeFromAddr } from "../../src/domain.ts";

describe("codeFromAddr", () => {
  it("reproduit la convention maison sur les chantiers réels", () => {
    expect(codeFromAddr("151 Henri Desbals apt 7")).toBe("151HD7");
    expect(codeFromAddr("9 Mont Doré — apt 49")).toBe("9MD49");
    expect(codeFromAddr("30 Jules Amilhau — apt 90")).toBe("30JA90");
    expect(codeFromAddr("8 rue Lafayette apt 12")).toBe("8LA12");
  });

  it("donne 12AU49 pour le chantier que l'équipe appelle 12AB49", () => {
    // ⚠ constat D7 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // Une rue d'un seul mot donne ses deux premières lettres : « Audibert » → AU.
    expect(codeFromAddr("12 Audibert — apt 49")).toBe("12AU49");
  });

  it("ignore les accents", () => {
    expect(codeFromAddr("3 Émile Zola appt 5")).toBe("3EZ5");
    expect(codeFromAddr("14 Allée des Érables")).toBe("14ER");
  });

  it("prend les deux premières lettres d'une rue d'un seul mot", () => {
    expect(codeFromAddr("8 Lafayette")).toBe("8LA");
  });

  it("saute les mots de voie et de liaison", () => {
    expect(codeFromAddr("10 avenue de la République")).toBe("10RE");
    expect(codeFromAddr("7 impasse du Moulin")).toBe("7MO");
    expect(codeFromAddr("5 rue de l'Église n°3")).toBe("5EG3");
    expect(codeFromAddr("4 bd des Belges")).toBe("4BE");
    // Rien que des mots de liaison : pas d'initiales du tout.
    expect(codeFromAddr("8 rue de la")).toBe("8");
  });

  it("coupe les mots aux tirets et met en capitales", () => {
    expect(codeFromAddr("2 Hôtel-Dieu")).toBe("2HD");
    expect(codeFromAddr("4 rue victor hugo")).toBe("4VH");
  });

  it("garde au plus trois initiales", () => {
    expect(codeFromAddr("12 Jean Jaures Paul Bert Z apt 1")).toBe("12JJP1");
  });

  it("reconnaît les façons courantes d'écrire l'appartement", () => {
    expect(codeFromAddr("2 Victor Hugo appartement 12")).toBe("2VH12");
    expect(codeFromAddr("2 Victor Hugo app. 3")).toBe("2VH3");
    expect(codeFromAddr("2 Victor Hugo Apt.7")).toBe("2VH7");
    expect(codeFromAddr("2 Victor Hugo APT 9")).toBe("2VH9");
    expect(codeFromAddr("2 Victor Hugo ap 4")).toBe("2VH4");
    expect(codeFromAddr("2 Victor Hugo lot 5")).toBe("2VH5");
    expect(codeFromAddr("2 Victor Hugo n°6")).toBe("2VH6");
    expect(codeFromAddr("2 Victor Hugo no 8")).toBe("2VH8");
  });

  it("se passe du numéro d'appartement", () => {
    expect(codeFromAddr("151 Henri Desbals")).toBe("151HD");
  });

  it("se passe du numéro de voie quand il n'y a pas d'appartement", () => {
    expect(codeFromAddr("Henri Desbals")).toBe("HD");
  });

  it("prend le numéro d'appartement pour un numéro de voie quand la voie n'en a pas", () => {
    // ⚠ NOUVEAU CONSTAT — sans numéro de voie, le premier nombre trouvé est
    // celui de l'appartement : il est écrit deux fois, en tête et en queue.
    // Attendu : « HD7 ». Proposition modifiable, sans conséquence au-delà
    // de l'affichage. Comportement actuel figé.
    expect(codeFromAddr("Henri Desbals apt 7")).toBe("7HD7");
  });

  it("prend « bis » pour un mot de la rue", () => {
    // Ni défaut connu ni règle écrite : « 12 bis » est fréquent, et « bis »
    // n'est pas dans la liste des mots ignorés. Figé tel quel.
    expect(codeFromAddr("12 bis rue Victor Hugo apt 3")).toBe("12BVH3");
  });

  it("rend une chaîne vide pour une adresse vide", () => {
    expect(codeFromAddr("")).toBe("");
    expect(codeFromAddr(null)).toBe("");
    expect(codeFromAddr(undefined)).toBe("");
  });

  it("ne dépasse jamais vingt caractères", () => {
    expect(codeFromAddr("123456789012345678901 Henri Desbals")).toBe("12345678901234567890");
  });
});
