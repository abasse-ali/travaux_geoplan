import { describe, expect, it } from "vitest";
import { lireConfig } from "../src/config.ts";

const base = {
  DATABASE_URL: "mysql://geoplan:x@mysql:3306/geoplan",
  REDIS_URL: "redis://redis:6379",
  APP_ORIGIN: "https://geoplan.exemple.fr"
};

describe("lireConfig", () => {
  it("prend des valeurs par défaut sûres : relance à blanc, samedi 9 h à Paris", () => {
    const c = lireConfig(base);
    expect(c.MAIL_MODE).toBe("a-blanc");
    expect(c.RAPPEL_CRON).toBe("0 9 * * 6");
    expect(c.RAPPEL_TZ).toBe("Europe/Paris");
    expect(c.TRUST_PROXY).toBe(1);
  });

  it("tient une variable vide pour absente, comme docker compose la transmet", () => {
    const c = lireConfig({ ...base, BREVO_API_KEY: "", MAIL_FROM: "", MAIL_REPLY_TO: "" });
    expect(c.BREVO_API_KEY).toBeUndefined();
  });

  it("refuse l'envoi réel sans clé Brevo ni expéditeur", () => {
    expect(() => lireConfig({ ...base, MAIL_MODE: "brevo" })).toThrow(/BREVO_API_KEY et MAIL_FROM/);
  });

  it("exige https en production, sauf pour l'essai local sur localhost", () => {
    expect(() => lireConfig({ ...base, NODE_ENV: "production", APP_ORIGIN: "http://geoplan.exemple.fr" }))
      .toThrow(/https/);
    expect(lireConfig({ ...base, NODE_ENV: "production", APP_ORIGIN: "http://localhost:8080" }).APP_ORIGIN)
      .toBe("http://localhost:8080");
  });

  it("nomme chaque variable fautive, sans jamais recopier une valeur", () => {
    try {
      lireConfig({ DATABASE_URL: "postgres://secret@x/y", REDIS_URL: "redis://r", APP_ORIGIN: "https://a.fr" });
      expect.unreachable();
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("DATABASE_URL");
      expect(m).not.toContain("secret");
    }
  });
});
