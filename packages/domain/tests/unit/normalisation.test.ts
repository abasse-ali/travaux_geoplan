/* La normalisation : tout ce qui vient d'une base partagée ou d'un
   fichier importé passe par ici. Le domaine ne fait confiance à rien et
   borne tout ; ces tests figent chaque borne, et signalent les endroits
   où le contrôle laisse passer une donnée qu'il aurait dû refuser. */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  uid, normPhone, fmtPhone, countDays, normDays, normEmail,
  normPerson, normSite, normAvail, mondayOf, todayISO, span, isActive,
  type Avail, type Site
} from "../../src/domain.ts";
import { LUN_VEN, brut } from "./fabriques.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("uid", () => {
  it("colle au préfixe six caractères en base 36 tirés de Math.random", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    // 0.123456789 s'écrit 0.4fzzzxjylrx en base 36.
    expect(uid("p_")).toBe("p_4fzzzx");
  });

  it("produit des identifiants différents d'un appel à l'autre", () => {
    const ids = new Set(Array.from({ length: 200 }, () => uid("s_")));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^s_[0-9a-z]{1,6}$/);
  });

  it("raccourcit l'identifiant quand le tirage s'écrit en peu de chiffres", () => {
    // ⚠ NOUVEAU CONSTAT — uid ne garantit pas six caractères : un tirage
    // « rond » s'écrit court en base 36, et un tirage nul (permis par la
    // norme) ne laisse que le préfixe. Probabilité négligeable, mais deux
    // fiches « p_ » s'écraseraient. Comportement actuel figé.
    const r = vi.spyOn(Math, "random");
    r.mockReturnValue(0.5);
    expect(uid("p_")).toBe("p_i");
    r.mockReturnValue(0);
    expect(uid("p_")).toBe("p_");
  });
});

describe("normPhone", () => {
  it("met un portable français au format international", () => {
    expect(normPhone("06 12 34 56 78")).toBe("+33612345678");
    expect(normPhone("06.12.34.56.78")).toBe("+33612345678");
    expect(normPhone("06-12-34-56-78")).toBe("+33612345678");
    expect(normPhone("0612345678")).toBe("+33612345678");
  });

  it("comprend le préfixe 00 et le + déjà saisi", () => {
    expect(normPhone("0033612345678")).toBe("+33612345678");
    expect(normPhone("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normPhone("+4915112345678")).toBe("+4915112345678");
  });

  it("prend neuf chiffres pour un numéro français sans son zéro", () => {
    expect(normPhone("612345678")).toBe("+33612345678");
  });

  it("accepte un nombre, comme en produit un tableur", () => {
    expect(normPhone(612345678)).toBe("+33612345678");
  });

  it("rend une chaîne vide pour une saisie vide ou sans chiffre", () => {
    expect(normPhone("")).toBe("");
    expect(normPhone(null)).toBe("");
    expect(normPhone(undefined)).toBe("");
    expect(normPhone(0)).toBe("");
    expect(normPhone("abc")).toBe("");
    expect(normPhone("+")).toBe("");
  });

  it("refuse moins de huit chiffres et plus de quinze", () => {
    expect(normPhone("1234567")).toBe("");
    expect(normPhone("12345678")).toBe("+12345678");
    expect(normPhone("+123456789012345")).toBe("+123456789012345");
    expect(normPhone("+1234567890123456")).toBe("");
  });

  it("préfixe d'un + tout autre numéro, sans le vérifier", () => {
    expect(normPhone("1234567890")).toBe("+1234567890");
    // ⚠ NOUVEAU CONSTAT — un numéro français suivi d'un poste, ou amputé
    // d'un chiffre, donne un numéro international impossible (+0…, +330…)
    // au lieu d'être refusé : le lien sms:/wa.me qui en sort est mort, sans
    // que la fiche le signale. Comportement actuel figé.
    expect(normPhone("06 12 34 56 78 12")).toBe("+061234567812");
    expect(normPhone("06 12 34 56 7")).toBe("+33061234567");
  });
});

describe("fmtPhone", () => {
  it("réécrit un numéro français à la française, par paires", () => {
    expect(fmtPhone("+33612345678")).toBe("06 12 34 56 78");
  });

  it("groupe par trois les autres numéros", () => {
    expect(fmtPhone("+4915112345678")).toBe("+491 511 234 567 8");
    expect(fmtPhone("+12345678")).toBe("+123 456 78");
    // Un +33 trop court n'est pas traité comme français.
    expect(fmtPhone("+331234")).toBe("+331 23 4");
  });

  it("rend une chaîne vide pour un numéro vide", () => {
    expect(fmtPhone("")).toBe("");
  });
});

describe("countDays et normDays", () => {
  it("countDays compte les cases cochées", () => {
    expect(countDays([true, false, true, false, false, true, false])).toBe(3);
    expect(countDays([])).toBe(0);
  });

  it("normDays complète à sept cases, les jours manquants non travaillés", () => {
    // Une saisie à cinq jours vient d'une version où le week-end n'existait pas.
    expect(normDays([true, true, true, true, true], null)).toEqual(LUN_VEN);
    expect(normDays([], null)).toEqual([false, false, false, false, false, false, false]);
  });

  it("normDays convertit en booléens et coupe au-delà de sept", () => {
    expect(normDays([1, 0, "x", null, "", 2, 3, true, true], null))
      .toEqual([true, false, true, false, false, true, true]);
  });

  it("normDays rend le repli, tel quel, quand ce n'est pas un tableau", () => {
    const repli = [true, false, false, false, false, false, false];
    expect(normDays(undefined, repli)).toBe(repli);
    expect(normDays("lun-ven", repli)).toBe(repli);
    expect(normDays({ 0: true }, null)).toBeNull();
    expect(normDays(null, null)).toBeNull();
  });
});

describe("normEmail", () => {
  it("met en minuscules et retire les espaces autour", () => {
    expect(normEmail("  Jean.Dupont@Example.COM ")).toBe("jean.dupont@example.com");
    expect(normEmail("jean@sous.domaine.fr")).toBe("jean@sous.domaine.fr");
  });

  it("refuse ce qui n'a pas la forme d'une adresse", () => {
    for (const x of ["jean@exemple", "jean@exemple.f", "jean dupont@exemple.fr",
                     "@exemple.fr", "jean@@exemple.fr", "jean@.fr", "", null, undefined, 42]) {
      expect(normEmail(x)).toBe("");
    }
  });

  it("tronque à 120 caractères APRÈS l'avoir validée", () => {
    // ⚠ NOUVEAU CONSTAT — une adresse trop longue est validée puis coupée :
    // ce qui est rangé n'est plus une adresse (le @ a disparu), et les
    // demandes de disponibilité partent dans le vide. Il faudrait la refuser.
    // Comportement actuel figé.
    const longue = "a".repeat(130) + "@ex.fr";
    expect(normEmail(longue)).toBe("a".repeat(120));
    const juste = "a".repeat(114) + "@ex.fr";              // 120 caractères pile
    expect(normEmail(juste)).toBe(juste);
  });
});

describe("normPerson", () => {
  it("fabrique une fiche complète à partir de rien", () => {
    expect(normPerson("p_x", null)).toEqual({
      id: "p_x", name: "Sans nom", phone: "", email: "",
      days: LUN_VEN, permis: false,
      sk: { elec: 1, plomb: 1, platre: 1, peint: 1, menuis: 1 }, note: ""
    });
    expect(normPerson("p_y", undefined).name).toBe("Sans nom");
  });

  it("garde l'identifiant passé en argument, pas celui de l'enregistrement", () => {
    expect(normPerson("p_a", { id: "p_b" }).id).toBe("p_a");
  });

  it("borne les niveaux entre 1 et 5 et les arrondit", () => {
    const p = normPerson("p", brut({ sk: { elec: 0, plomb: 9, platre: 2.5, peint: 2.4, menuis: -3 } }));
    expect(p.sk).toEqual({ elec: 1, plomb: 5, platre: 3, peint: 2, menuis: 1 });
  });

  it("ramène à 1 un niveau qui n'est pas un nombre fini, même la chaîne \"3\"", () => {
    const p = normPerson("p", brut({ sk: { elec: "3", plomb: NaN, platre: Infinity, peint: null } }));
    expect(p.sk).toEqual({ elec: 1, plomb: 1, platre: 1, peint: 1, menuis: 1 });
  });

  it("met du lundi au vendredi quand aucun jour n'est coché", () => {
    expect(normPerson("p", { days: [] }).days).toEqual(LUN_VEN);
    expect(normPerson("p", { days: [false, false, false, false, false, false, false] }).days).toEqual(LUN_VEN);
    expect(normPerson("p", brut({ days: "lun-ven" })).days).toEqual(LUN_VEN);
  });

  it("garde les jours cochés, week-end compris, et complète à sept", () => {
    expect(normPerson("p", { days: [false, false, false, false, false, true] }).days)
      .toEqual([false, false, false, false, false, true, false]);
  });

  it("tronque le nom à 60 caractères et la note à 300", () => {
    const p = normPerson("p", { name: "N".repeat(70), note: "x".repeat(400) });
    expect(p.name).toHaveLength(60);
    expect(p.note).toHaveLength(300);
  });

  it("normalise téléphone et e-mail, et réduit le permis à un booléen", () => {
    const p = normPerson("p", brut({ phone: "06 12 34 56 78", email: " A@B.FR ", permis: "oui" }));
    expect(p.phone).toBe("+33612345678");
    expect(p.email).toBe("a@b.fr");
    expect(p.permis).toBe(true);
    expect(normPerson("p", brut({ permis: 0 })).permis).toBe(false);
  });

  it("ne garde que les champs connus", () => {
    const p = normPerson("p", brut({ name: "Nixon", pirate: 1 }));
    expect(Object.keys(p).sort()).toEqual(
      ["days", "email", "id", "name", "note", "permis", "phone", "sk"]);
  });
});

describe("normSite", () => {
  it("fabrique un chantier complet à partir de rien, ouvert le lundi de la semaine en cours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 10, 0));             // vendredi 25 septembre 2026
    expect(normSite("s_x", null)).toEqual({
      id: "s_x", code: "?", addr: "", start: "2026-09-21", months: 2, coef: 1,
      ph: Array.from({ length: 12 }, () => 0), note: "", plan: {}, tasks: {}
    });
    expect(mondayOf(todayISO())).toBe("2026-09-21");
  });

  it("remplace une date de début mal formée par le lundi courant, même un dimanche", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 18, 0));             // dimanche 27
    expect(normSite("s", { start: "31/08/2026" }).start).toBe("2026-09-21");
    expect(normSite("s", brut({ start: 20260831 })).start).toBe("2026-09-21");
    expect(normSite("s", { start: "2026-8-31" }).start).toBe("2026-09-21");
  });

  it("garde une date de début bien formée, même si ce n'est pas un lundi", () => {
    expect(normSite("s", { start: "2026-09-02" }).start).toBe("2026-09-02");
  });

  it("laisse entrer une date de début impossible, et le chantier n'est alors jamais actif", () => {
    // ⚠ NOUVEAU CONSTAT — le contrôle de date ne vérifie que la forme
    // AAAA-MM-JJ. « 2026-13-45 » passe : sa semaine devient « NaN-NaN-NaN »,
    // qui se classe après toute date réelle ; le chantier n'est jamais
    // actif et optimizeWeek ne le pourvoit jamais, sans aucun message.
    // « 2026-02-30 » passe aussi, et glisse au 2 mars. Comportement figé.
    const s = normSite("s", { start: "2026-13-45" });
    expect(s.start).toBe("2026-13-45");
    expect(span(s)).toEqual({ first: "NaN-NaN-NaN", last: "NaN-NaN-NaN" });
    expect(isActive(s, "2026-09-21")).toBe(false);
    expect(isActive(s, "2099-12-28")).toBe(false);
    expect(normSite("s", { start: "2026-02-30" }).start).toBe("2026-02-30");
    expect(span(normSite("s", { start: "2026-02-30" })).first).toBe("2026-03-02");
  });

  it("borne l'avancement de chaque étape entre 0 et 100, arrondi", () => {
    const s = normSite("s", brut({ ph: [150, -5, 33.4, 33.5, "50", NaN, null, 99.6, 100, 0, 1, 2, 77] }));
    expect(s.ph).toEqual([100, 0, 33, 34, 0, 0, 0, 100, 100, 0, 1, 2]);
  });

  it("complète à douze étapes un avancement trop court", () => {
    expect(normSite("s", { ph: [100, 50] }).ph).toEqual([100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("filtre le plan : dates bien formées, identifiants en texte, sans doublon ni jour vide", () => {
    const s = normSite("s", brut({
      plan: {
        "2026-09-21": ["p_a", "p_b", "p_a", 42, null],
        "2026-09-22": [],
        "2026-09-23": [7, null],
        "2026-9-24": ["p_a"],
        "lundi": ["p_a"],
        "2026-09-25": "p_a"
      }
    }));
    expect(s.plan).toEqual({ "2026-09-21": ["p_a", "p_b"] });
  });

  it("étale l'ancien format `weeks` sur le lundi-vendredi, après le plan", () => {
    const s = normSite("s", brut({
      plan: { "2026-08-31": ["p_c", "p_a"], "2026-09-05": ["p_d"] },
      weeks: { "2026-08-31": ["p_a", "p_b"] }
    }));
    expect(s.plan).toEqual({
      "2026-08-31": ["p_c", "p_a", "p_b"],                   // fusionné, sans doublon
      "2026-09-01": ["p_a", "p_b"],
      "2026-09-02": ["p_a", "p_b"],
      "2026-09-03": ["p_a", "p_b"],
      "2026-09-04": ["p_a", "p_b"],
      "2026-09-05": ["p_d"]                                  // le samedi n'est pas touché
    });
    expect("weeks" in s).toBe(false);
  });

  it("ignore une semaine `weeks` dont le lundi est illisible", () => {
    const s = normSite("s", brut({ weeks: { "semaine 36": ["p_a"], "2026-08-31": "p_a" } }));
    expect(s.plan).toEqual({});
  });

  it("borne les missions cochées aux douze étapes et à leur nombre de missions", () => {
    const s = normSite("s", brut({
      tasks: {
        "2": [1, 0, "x", true],          // trois missions : la quatrième case tombe
        "3": [true],
        "1": [false, false],             // rien de coché : l'étape disparaît
        "12": [true], "-1": [true], "x": [true],
        "0": "tout",
        "9": [true]                      // complété par des cases décochées
      }
    }));
    expect(s.tasks).toEqual({
      "2": [true, false, true],
      "3": [true],
      "9": [true, false, false, false]
    });
  });

  it("lit la clé d'étape avec parseInt : « 3.7 » vaut l'étape 3", () => {
    expect(normSite("s", brut({ tasks: { "3.7": [true] } })).tasks).toEqual({ "3": [true] });
  });

  it("borne la durée entre 1 et 12 mois, arrondie, 2 par défaut", () => {
    expect(normSite("s", { months: 0 }).months).toBe(1);
    expect(normSite("s", { months: 13 }).months).toBe(12);
    expect(normSite("s", { months: 2.6 }).months).toBe(3);
    expect(normSite("s", brut({ months: "4" })).months).toBe(2);
    expect(normSite("s", {}).months).toBe(2);
  });

  it("borne le coefficient entre 0,3 et 3, sans l'arrondir, 1 par défaut", () => {
    expect(normSite("s", { coef: 0 }).coef).toBe(0.3);
    expect(normSite("s", { coef: 0.1 }).coef).toBe(0.3);
    expect(normSite("s", { coef: 5 }).coef).toBe(3);
    expect(normSite("s", { coef: 1.25 }).coef).toBe(1.25);
    expect(normSite("s", brut({ coef: "2" })).coef).toBe(1);
    expect(normSite("s", { coef: NaN }).coef).toBe(1);
  });

  it("tronque code, adresse et note, et met « ? » à un chantier sans code", () => {
    const s = normSite("s", { code: "C".repeat(30), addr: "A".repeat(200), note: "n".repeat(2500) });
    expect(s.code).toHaveLength(20);
    expect(s.addr).toHaveLength(120);
    expect(s.note).toHaveLength(2000);
    expect(normSite("s", { code: "" }).code).toBe("?");
  });

  it("ne garde que les champs connus : la révision `_rev` disparaît", () => {
    const s = normSite("s", brut({ start: "2026-09-21", _rev: 4, pirate: 1 }));
    expect(Object.keys(s).sort()).toEqual(
      ["addr", "code", "coef", "id", "months", "note", "ph", "plan", "start", "tasks"]);
  });

  it("rend un chantier dont le plan et les missions ne partagent rien avec l'entrée", () => {
    const entree: Partial<Site> = { start: "2026-09-21", plan: { "2026-09-21": ["p_a"] }, tasks: { "3": [true] } };
    const s = normSite("s", entree);
    s.plan["2026-09-21"].push("p_b");
    s.tasks["3"][0] = false;
    expect(entree.plan).toEqual({ "2026-09-21": ["p_a"] });
    expect(entree.tasks).toEqual({ "3": [true] });
  });
});

describe("normAvail", () => {
  it("fabrique une réponse vide à partir de rien", () => {
    expect(normAvail("a_x", null)).toEqual({
      id: "a_x", token: "", personId: "", week: "", days: null, note: "", answeredAt: null
    });
  });

  it("garde une réponse complète, jours complétés à sept", () => {
    const a = normAvail("a", {
      token: "t0k", personId: "p_nixon", week: "2026-09-21",
      days: [true, true, false], note: "rdv médecin mercredi", answeredAt: "2026-09-19T08:12:00Z"
    });
    expect(a).toEqual({
      id: "a", token: "t0k", personId: "p_nixon", week: "2026-09-21",
      days: [true, true, false, false, false, false, false],
      note: "rdv médecin mercredi", answeredAt: "2026-09-19T08:12:00Z"
    });
  });

  it("vide une semaine mal formée et laisse `days` à null sans tableau", () => {
    const a = normAvail("a", brut({ week: "S39", days: "lun" }));
    expect(a.week).toBe("");
    expect(a.days).toBeNull();
    // Un tableau vide est une réponse : « aucun jour ».
    expect(normAvail("a", { days: [] }).days).toEqual([false, false, false, false, false, false, false]);
  });

  it("tronque la note à 300 caractères et ramène une date de réponse vide à null", () => {
    expect(normAvail("a", { note: "x".repeat(400) }).note).toHaveLength(300);
    expect(normAvail("a", { answeredAt: "" }).answeredAt).toBeNull();
  });

  it("laisse passer une date de réponse de n'importe quel type", () => {
    // ⚠ NOUVEAU CONSTAT — `answeredAt` n'est ni contrôlé ni converti : un
    // nombre ou un objet traverse la normalisation, contre le type déclaré
    // (string | null). Un affichage qui ferait `.slice` dessus planterait.
    // Comportement actuel figé.
    expect(normAvail("a", brut<Partial<Avail>>({ answeredAt: 42 })).answeredAt).toBe(42);
  });

  it("n'accepte que la forme de la semaine, pas sa validité", () => {
    // Même trou que pour la date de début d'un chantier (voir plus haut).
    expect(normAvail("a", { week: "2026-13-45" }).week).toBe("2026-13-45");
  });
});
