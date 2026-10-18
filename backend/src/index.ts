import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { clientesRouter } from "./routes/clientes.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/clientes", requireAuth, clientesRouter);

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
    res.status(400).json({ error: { code: "JSON_INVALIDO", message: "El cuerpo de la petición no es JSON válido" } });
    return;
  }
  console.error(error);
  res.status(500).json({ error: { code: "ERROR_INTERNO", message: "Ocurrió un error inesperado" } });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
