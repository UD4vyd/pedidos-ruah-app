import { Router } from "express";
import { z } from "zod";
import { enviarError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { idSchema } from "../lib/validacion.js";

export const clientesRouter = Router();

const camposCliente = { id: true, nombre: true, telefonoWhatsapp: true } as const;

const clienteSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(150),
  telefonoWhatsapp: z
    .string()
    .transform((valor) => valor.replace(/\D/g, ""))
    .pipe(z.string().regex(/^3\d{9}$/, "El teléfono debe ser un celular de 10 dígitos")),
});

clientesRouter.get("/", async (req, res) => {
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim() : "";

  const clientes = await prisma.cliente.findMany({
    where: buscar
      ? {
          OR: [
            { nombre: { contains: buscar, mode: "insensitive" } },
            { telefonoWhatsapp: { contains: buscar } },
          ],
        }
      : undefined,
    orderBy: { nombre: "asc" },
    take: 50,
    select: camposCliente,
  });

  res.json(clientes);
});

clientesRouter.post("/", async (req, res) => {
  const datos = clienteSchema.safeParse(req.body);
  if (!datos.success) {
    enviarError(res, 400, "VALIDATION_ERROR", datos.error.issues[0]?.message ?? "Datos inválidos");
    return;
  }

  const existente = await prisma.cliente.findFirst({
    where: { telefonoWhatsapp: datos.data.telefonoWhatsapp },
  });
  if (existente) {
    enviarError(res, 409, "CLIENTE_DUPLICADO", "Ya existe un cliente con ese teléfono");
    return;
  }

  const cliente = await prisma.cliente.create({ data: datos.data, select: camposCliente });
  res.status(201).json(cliente);
});

clientesRouter.patch("/:id", async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const datos = clienteSchema.partial().safeParse(req.body);
  if (!id.success || !datos.success) {
    enviarError(res, 400, "VALIDATION_ERROR", "Datos inválidos");
    return;
  }

  const existe = await prisma.cliente.findUnique({ where: { id: id.data } });
  if (!existe) {
    enviarError(res, 404, "NO_ENCONTRADO", "El cliente no existe");
    return;
  }

  if (datos.data.telefonoWhatsapp) {
    const duplicado = await prisma.cliente.findFirst({
      where: { telefonoWhatsapp: datos.data.telefonoWhatsapp, NOT: { id: id.data } },
    });
    if (duplicado) {
      enviarError(res, 409, "CLIENTE_DUPLICADO", "Ya existe un cliente con ese teléfono");
      return;
    }
  }

  const cliente = await prisma.cliente.update({
    where: { id: id.data },
    data: datos.data,
    select: camposCliente,
  });
  res.json(cliente);
});

clientesRouter.delete("/:id", async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    enviarError(res, 400, "VALIDATION_ERROR", "Id inválido");
    return;
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id: id.data },
    include: { _count: { select: { pedidos: true } } },
  });
  if (!cliente) {
    enviarError(res, 404, "NO_ENCONTRADO", "El cliente no existe");
    return;
  }
  if (cliente._count.pedidos > 0) {
    enviarError(res, 409, "CLIENTE_CON_PEDIDOS", "No se puede borrar un cliente que tiene pedidos");
    return;
  }

  await prisma.cliente.delete({ where: { id: id.data } });
  res.status(204).end();
});
