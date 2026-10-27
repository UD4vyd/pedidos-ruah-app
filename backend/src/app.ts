import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { enviarError } from "./lib/http.js";
import { prisma } from "./lib/prisma.js";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { clientesRouter } from "./routes/clientes.js";
import { pedidosRouter } from "./routes/pedidos.js";

export const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/clientes", requireAuth, clientesRouter);
app.use("/api/pedidos", requireAuth, pedidosRouter);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", database: "disconnected" });
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed") {
    enviarError(res, 400, "JSON_INVALIDO", "El cuerpo de la petición no es JSON válido");
    return;
  }
  console.error(error);
  enviarError(res, 500, "ERROR_INTERNO", "Ocurrió un error inesperado");
});
