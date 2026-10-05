import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../services/password.js";

const usuarios = [
  { nombre: "Recepción", email: "recepcion@ruah.local" },
  { nombre: "Producción", email: "produccion@ruah.local" },
];

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error("Define SEED_PASSWORD en .env (mínimo 10 caracteres)");
  }

  for (const usuario of usuarios) {
    const passwordHash = await hashPassword(password);
    await prisma.usuario.upsert({
      where: { email: usuario.email },
      update: {},
      create: { ...usuario, passwordHash },
    });
    console.log(`Usuario listo: ${usuario.email}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

