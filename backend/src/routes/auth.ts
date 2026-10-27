import { Router } from "express";
import { z } from "zod";
import { enviarError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { verifyPassword } from "../services/password.js";
import { COOKIE_SESION, cerrarSesion, crearSesion } from "../services/sesiones.js";


export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const datos = loginSchema.safeParse(req.body);
  if (!datos.success) {
    enviarError(res, 400, "VALIDATION_ERROR", "Correo y contraseña son obligatorios");
    return;
  }

  const { email, password } = datos.data;
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const passwordValida = usuario
    ? await verifyPassword(usuario.passwordHash, password)
    : false;

  if (!usuario || !passwordValida) {
    enviarError(res, 401, "CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos");
    return;
  }

  const { token, expiraEn } = await crearSesion(usuario.id, req.get("user-agent"));

  res.cookie(COOKIE_SESION, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiraEn,
    path: "/",
  });

  res.json({
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email },
  });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ usuario: req.usuario });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[COOKIE_SESION];
  if (typeof token === "string") {
    await cerrarSesion(token);
  }
  res.clearCookie(COOKIE_SESION, { path: "/" });
  res.status(204).end();
});
