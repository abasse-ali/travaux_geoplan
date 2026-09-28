/* Le calendrier. Tout le domaine désigne un jour par sa date ISO locale
   et une semaine par son lundi ; une erreur d'un jour ici décale un plan
   entier. Les pièges visés : les changements d'heure (un jour de 23 h ou
   de 25 h), la fin d'année, la semaine 53, le 29 février, et les fuseaux
   où minuit n'existe pas certains jours. */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NDAYS, DAYS, DAYS_L, WEEKEND, MONTHS,
  pad, iso, parse, todayISO, addDays, addMonths, mondayOf, dayIndex,
  weekDates, weekNum, fmtDay, fmtRange
} from "../../src/domain.ts";
import { sousFuseau } from "./fabriques.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("constantes du calendrier", () => {
  it("comptent sept jours, lundi en tête, week-end en fin", () => {
    expect(NDAYS).toBe(7);
    expect(DAYS).toEqual(["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]);
    expect(DAYS_L[0]).toBe("Lundi");
    expect(DAYS_L[6]).toBe("Dimanche");
    expect(WEEKEND).toEqual([false, false, false, false, false, true, true]);
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[1]).toBe("févr.");
    expect(MONTHS[7]).toBe("août");
  });
});

describe("pad", () => {
  it("complète à deux chiffres sans jamais tronquer", () => {
    expect(pad(0)).toBe("00");
    expect(pad(5)).toBe("05");
    expect(pad(12)).toBe("12");
    expect(pad(123)).toBe("123");
  });
});

describe("iso et parse", () => {
  it("iso écrit la date LOCALE, même tard le soir", () => {
    expect(iso(new Date(2026, 0, 5))).toBe("2026-01-05");
    // 23 h 59 à Paris, c'est déjà le lendemain en UTC : iso doit l'ignorer.
    expect(iso(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("parse donne minuit heure locale, y compris les jours de changement d'heure", () => {
    for (const s of ["2026-03-29", "2026-10-25", "2028-02-29", "2026-12-31"]) {
      const d = parse(s);
      expect(d.getHours()).toBe(0);
      expect(iso(d)).toBe(s);
    }
    expect(parse("2026-03-29").getTimezoneOffset()).toBe(-60);   // encore l'heure d'hiver à minuit
    expect(parse("2026-03-30").getTimezoneOffset()).toBe(-120);
  });

  it("parse d'une chaîne invalide donne une date invalide, que iso écrit NaN-NaN-NaN", () => {
    // C'est ce qui rend inoffensives les clés de plan mal formées dans normSite :
    // la date étalée depuis une semaine invalide échoue au contrôle de format.
    expect(Number.isNaN(parse("lundi").getTime())).toBe(true);
    expect(iso(parse("lundi"))).toBe("NaN-NaN-NaN");
    expect(iso(parse("2026-13-45"))).toBe("NaN-NaN-NaN");
  });

  it("parse d'un 30 février déborde sur mars sans prévenir", () => {
    // Le moteur de V8 accepte un jour jusqu'à 31 quel que soit le mois.
    // Combiné au contrôle de format de normSite, une date impossible entre
    // dans les données (voir normalisation.test.ts).
    expect(iso(parse("2026-02-30"))).toBe("2026-03-02");
  });
});

describe("todayISO", () => {
  it("rend la date du jour à l'horloge", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 10, 0));
    expect(todayISO()).toBe("2026-09-25");
  });

  it("rend la date locale et non la date UTC", () => {
    vi.useFakeTimers();
    // 22 h 30 UTC le 25 = 0 h 30 à Paris le 26 : Geoffrey est déjà le 26.
    vi.setSystemTime(new Date("2026-09-25T22:30:00Z"));
    expect(todayISO()).toBe("2026-09-26");
  });
});

describe("addDays", () => {
  it("traverse le passage à l'heure d'été (29 mars 2026) sans perdre de jour", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-03-23", 7)).toBe("2026-03-30");
    expect(addDays("2026-03-30", -1)).toBe("2026-03-29");
    expect(addDays("2026-03-30", -7)).toBe("2026-03-23");
  });

  it("traverse le passage à l'heure d'hiver (25 octobre 2026) sans doubler de jour", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-10-19", 7)).toBe("2026-10-26");
    expect(addDays("2026-10-26", -1)).toBe("2026-10-25");
  });

  it("passe la fin d'année et le 29 février", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2024-02-29", 365)).toBe("2025-02-28");
  });

  it("ne bouge pas avec zéro jour", () => {
    expect(addDays("2026-09-25", 0)).toBe("2026-09-25");
  });

  it("égrène deux ans de jours consécutifs, sans trou ni doublon", () => {
    let d = "2025-12-29";                     // un lundi
    const vus = new Set<string>([d]);
    for (let i = 1; i <= 800; i++) {
      const suivant = addDays(d, 1);
      expect(suivant > d).toBe(true);        // l'ordre des chaînes est celui des dates
      expect(dayIndex(suivant)).toBe(i % 7);
      vus.add(suivant);
      d = suivant;
    }
    expect(vus.size).toBe(801);
    expect(d).toBe(addDays("2025-12-29", 800));
  });
});

describe("addMonths", () => {
  it("ajoute des mois à quantième égal, y compris à travers l'année", () => {
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
    expect(addMonths("2026-08-31", 2)).toBe("2026-10-31");
  });

  it("déborde sur le mois suivant quand le quantième n'existe pas", () => {
    // ⚠ constat D5 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // Un chantier commencé un 31 janvier pour un mois « finit » le 3 mars.
    expect(addMonths("2026-01-31", 1)).toBe("2026-03-03");
    expect(addMonths("2024-01-31", 1)).toBe("2024-03-02");
    expect(addMonths("2026-03-31", -1)).toBe("2026-03-03");
    expect(addMonths("2024-02-29", 12)).toBe("2025-03-01");
  });
});

describe("mondayOf", () => {
  it("laisse un lundi tel quel", () => {
    expect(mondayOf("2026-09-21")).toBe("2026-09-21");
    expect(mondayOf("2026-03-30")).toBe("2026-03-30");
  });

  it("ramène un dimanche au lundi qui le précède, pas au suivant", () => {
    expect(mondayOf("2026-09-27")).toBe("2026-09-21");
    expect(mondayOf("2026-03-29")).toBe("2026-03-23");   // jour de 23 h
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");   // jour de 25 h
  });

  it("traverse la fin d'année et le 29 février", () => {
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
    expect(mondayOf("2028-03-01")).toBe("2028-02-28");
    expect(mondayOf("2028-02-29")).toBe("2028-02-28");
  });
});

describe("dayIndex", () => {
  it("compte lundi 0 et dimanche 6", () => {
    expect(dayIndex("2026-09-21")).toBe(0);
    expect(dayIndex("2026-09-25")).toBe(4);
    expect(dayIndex("2026-09-27")).toBe(6);
    expect(dayIndex("2026-03-29")).toBe(6);
    expect(dayIndex("2026-10-25")).toBe(6);
    expect(dayIndex("2028-02-29")).toBe(1);
  });
});

describe("weekDates", () => {
  it("donne les sept jours de la semaine, lundi en tête", () => {
    expect(weekDates("2026-09-21")).toEqual([
      "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24",
      "2026-09-25", "2026-09-26", "2026-09-27"
    ]);
  });

  it("garde sept jours distincts les semaines de changement d'heure", () => {
    expect(weekDates("2026-03-23")).toEqual([
      "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26",
      "2026-03-27", "2026-03-28", "2026-03-29"
    ]);
    expect(weekDates("2026-10-19")).toEqual([
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
      "2026-10-23", "2026-10-24", "2026-10-25"
    ]);
  });

  it("enjambe le jour de l'an", () => {
    expect(weekDates("2026-12-28")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31",
      "2027-01-01", "2027-01-02", "2027-01-03"
    ]);
  });
});

describe("weekNum", () => {
  it("numérote à la norme ISO : 2026 a une semaine 53", () => {
    expect(weekNum("2026-12-28")).toBe(53);
    expect(weekNum("2027-01-04")).toBe(1);
  });

  it("numérote à la norme ISO : 2020 aussi", () => {
    expect(weekNum("2020-12-28")).toBe(53);
    expect(weekNum("2021-01-04")).toBe(1);
  });

  it("met en semaine 1 un lundi de décembre quand le jeudi est en janvier", () => {
    expect(weekNum("2025-12-29")).toBe(1);
    expect(weekNum("2026-01-05")).toBe(2);
    expect(weekNum("2024-12-30")).toBe(1);
  });

  it("n'est pas décalé par les changements d'heure", () => {
    expect(weekNum("2026-03-23")).toBe(13);
    expect(weekNum("2026-03-30")).toBe(14);
    expect(weekNum("2026-10-19")).toBe(43);
    expect(weekNum("2026-10-26")).toBe(44);
    expect(weekNum("2026-09-21")).toBe(39);
  });

  it("avance d'une semaine à chaque lundi pendant dix ans", () => {
    let wk = "2019-12-30";                       // semaine 1 de 2020
    let precedent = weekNum(wk);
    expect(precedent).toBe(1);
    let longues = 0;
    for (let i = 0; i < 540; i++) {
      wk = addDays(wk, 7);
      const n = weekNum(wk);
      if (n === 1) {
        // On ne revient à 1 qu'après la 52 ou la 53.
        expect([52, 53]).toContain(precedent);
        if (precedent === 53) longues++;
      } else {
        expect(n).toBe(precedent + 1);
      }
      precedent = n;
    }
    // 2020 et 2026 ont 53 semaines ; 2032 est hors de la plage parcourue.
    expect(longues).toBe(2);
  });

  it("n'est juste que pour un lundi : c'est son contrat", () => {
    // Hors contrat, un jeudi 31 décembre rend la semaine 1 au lieu de 53 : le
    // calcul avance de trois jours en supposant partir d'un lundi. Toute
    // l'interface lui passe une semaine, donc un lundi.
    expect(weekNum("2026-12-31")).toBe(1);
  });
});

describe("fmtDay et fmtRange", () => {
  it("fmtDay écrit le jour et le mois abrégé", () => {
    expect(fmtDay("2026-03-29")).toBe("29 mars");
    expect(fmtDay("2026-02-01")).toBe("1 févr.");
    expect(fmtDay("2026-12-31")).toBe("31 déc.");
  });

  it("fmtRange n'écrit le mois qu'une fois quand la semaine y tient", () => {
    expect(fmtRange("2026-03-23")).toBe("23 – 29 mars");
    expect(fmtRange("2026-10-19")).toBe("19 – 25 oct.");
  });

  it("fmtRange écrit les deux mois quand la semaine chevauche", () => {
    expect(fmtRange("2026-03-30")).toBe("30 mars – 5 avr.");
    // L'année n'apparaît jamais, même à cheval sur deux années.
    expect(fmtRange("2026-12-28")).toBe("28 déc. – 3 janv.");
  });
});

describe("robustesse au fuseau", () => {
  it("le fuseau de référence des tests est Paris", () => {
    expect(process.env.TZ).toBe("Europe/Paris");
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
  });

  it("à Santiago, où minuit n'existe pas le 6 septembre 2026, les dates restent justes", () => {
    sousFuseau("America/Santiago", () => {
      // Sans ce contrôle, un changement de fuseau ignoré rendrait le test vide de sens.
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(180);
      expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(240);
      // Minuit est sauté : parse tombe à 1 h, mais le quantième ne bouge pas.
      expect(parse("2026-09-06").getHours()).toBe(1);
      expect(iso(parse("2026-09-06"))).toBe("2026-09-06");
      expect(addDays("2026-09-05", 1)).toBe("2026-09-06");
      expect(addDays("2026-09-06", 1)).toBe("2026-09-07");
      expect(addDays("2026-04-04", 1)).toBe("2026-04-05");   // fin de l'heure d'été chilienne
      expect(mondayOf("2026-09-06")).toBe("2026-08-31");
      expect(dayIndex("2026-09-06")).toBe(6);
      expect(weekDates("2026-08-31")).toEqual([
        "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
        "2026-09-04", "2026-09-05", "2026-09-06"
      ]);
      expect(weekNum("2026-08-31")).toBe(36);
      expect(weekNum("2026-12-28")).toBe(53);
      expect(fmtRange("2026-08-31")).toBe("31 août – 6 sept.");
      let d = "2026-01-05";
      for (let i = 1; i <= 400; i++) {
        const suivant = addDays(d, 1);
        expect(dayIndex(suivant)).toBe(i % 7);
        d = suivant;
      }
      expect(d).toBe("2027-02-09");
    });
    // Le fuseau d'origine est bien rétabli.
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
  });

  it("en UTC, les mêmes calculs donnent les mêmes dates qu'à Paris", () => {
    const calculs = () => [
      addDays("2026-03-28", 2), addDays("2026-10-24", 2), mondayOf("2026-10-25"),
      weekNum("2026-12-28"), weekNum("2026-10-26"), fmtRange("2026-03-30"),
      addMonths("2026-01-31", 1), weekDates("2026-10-19").join(",")
    ];
    const paris = calculs();
    const utc = sousFuseau("UTC", () => {
      expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(0);
      return calculs();
    });
    expect(utc).toEqual(paris);
  });
});
