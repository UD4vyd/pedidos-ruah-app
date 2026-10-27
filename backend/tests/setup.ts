import { afterAll, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { verificarBaseDePruebas } from "./env.js";

verificarBaseDePruebas(process.env.DATABASE_URL);

let tablas: string[] | undefined;

// Cada prueba empieza con la base vacía. Se leen las tablas de pg_tables
// para que las tablas nuevas se limpien sin tocar este archivo.
beforeEach(async () => {
  tablas ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
  ).map(({ tablename }) => `"${tablename}"`);

  await prisma.$executeRawUnsafe(`TRUNCATE ${tablas.join(", ")} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
