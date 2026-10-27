import { defineConfig } from "vitest/config";
import { cargarEnvDePruebas } from "./tests/env.js";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: cargarEnvDePruebas(),
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Todos los archivos comparten la misma base: si corrieran en paralelo,
    // uno vaciaría las tablas en medio de otro.
    fileParallelism: false,
  },
});
