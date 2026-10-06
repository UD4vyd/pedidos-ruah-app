import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";

const DURACION_MS = 12 * 60 * 60 * 1000; // 12 horas
export const COOKIE_SESION = "sesion";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function crearSesion(usuarioId: number, dispositivo?: string) {
  await prisma.sesion.deleteMany({ where: { expiraEn: { lt: new Date() } } });

  const token = randomBytes(32).toString("base64url");
  const expiraEn = new Date(Date.now() + DURACION_MS);

  await prisma.sesion.create({
    data: {
      id: hashToken(token),
      usuarioId,
      expiraEn,
      dispositivo: dispositivo?.slice(0, 255),
    },
  });

  return { token, expiraEn };
}

export async function buscarSesion(token: string) {
  const sesion = await prisma.sesion.findUnique({
    where: { id: hashToken(token) },
    include: { usuario: true },
  });
  if (!sesion || sesion.expiraEn < new Date()) return null;
  return sesion;
}

export async function cerrarSesion(token: string) {
  await prisma.sesion.deleteMany({ where: { id: hashToken(token) } });
}
