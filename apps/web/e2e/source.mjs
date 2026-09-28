/* Lance Playwright contre une source de données : node e2e/source.mjs api [options…]
   (npm lance ses scripts dans cmd.exe sous Windows, qui ne sait pas
   écrire « VAR=valeur commande » ; la variable passe donc par ici.) */
import { spawn } from "node:child_process";

const [source, ...options] = process.argv.slice(2);
const p = spawn("npx", ["playwright", "test", ...options], {
  stdio: "inherit", shell: true, env: { ...process.env, GEOPLAN_E2E_SOURCE: source }
});
p.on("exit", code => process.exit(code ?? 1));
