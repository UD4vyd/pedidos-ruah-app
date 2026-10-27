import { execFileSync } from "node:child_process";
import { cargarEnvDePruebas } from "./env.js";

// Se ejecuta una vez antes de todas las pruebas: aplica las migraciones
// existentes a la base de pruebas. `migrate deploy` nunca crea migraciones
// nuevas ni pregunta si reinicia la base.
export default function setup() {
  const env = cargarEnvDePruebas();
  try {
    execFileSync(
      "node_modules/.bin/prisma",
      ["migrate", "deploy", "--config", "prisma7.config.ts"],
      { env: { ...process.env, ...env }, stdio: "pipe" },
    );
  } catch (error) {
    const salida = error as { stdout?: Buffer; stderr?: Buffer };
    console.error(salida.stdout?.toString(), salida.stderr?.toString());
    throw new Error("No se pudieron aplicar las migraciones a la base de pruebas");
  }
}
