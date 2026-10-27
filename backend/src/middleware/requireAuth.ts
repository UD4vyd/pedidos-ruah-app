import type { NextFunction, Request, Response } from "express";
import { enviarError } from "../lib/http.js";
import { COOKIE_SESION, buscarSesion } from "../services/sesiones.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_SESION];
  const sesion = typeof token === "string" ? await buscarSesion(token) : null;

  if (!sesion) {
    enviarError(res, 401, "NO_AUTENTICADO", "Debes iniciar sesión");
    return;
  }

  req.usuario = {
    id: sesion.usuario.id,
    nombre: sesion.usuario.nombre,
    email: sesion.usuario.email,
  };
  next();
}
