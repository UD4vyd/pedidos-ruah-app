import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

const ARCHIVO = ".env.test";

// Las pruebas vacían todas las tablas antes de cada caso. Esta verificación
// impide que eso ocurra en una base que no sea la de pruebas.
export function verificarBaseDePruebas(url: string | undefined): string {
  if (!url) {
    throw new Error(`Falta DATABASE_URL en ${ARCHIVO}`);
  }
  const nombreBase = new URL(url).pathname.slice(1);
  if (!nombreBase.endsWith("_test")) {
    throw new Error(
      `La base "${nombreBase}" no termina en "_test". Las pruebas borran datos: se cancelan.`,
    );
  }
  return url;
}

export function cargarEnvDePruebas(): Record<string, string> {
  if (!existsSync(ARCHIVO)) {
    throw new Error(`Falta ${ARCHIVO}. Cópialo desde ${ARCHIVO}.example y completa DATABASE_URL.`);
  }
  const env = parse(readFileSync(ARCHIVO));
  verificarBaseDePruebas(env.DATABASE_URL);
  return env;
}
