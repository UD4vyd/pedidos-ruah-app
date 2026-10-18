import type { Response } from "express";

export function enviarError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}
