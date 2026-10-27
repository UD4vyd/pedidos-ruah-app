import { Router } from "express";
import { z } from "zod";
import { enviarError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { fecha, idSchema, monto } from "../lib/validacion.js";
import { formatearPedido, incluirPedido, obtenerPedido } from "../services/pedidos.js";

export const pedidosRouter = Router();

const itemSchema = z.object({
  descripcion: z.string().trim().min(1, "Cada ítem necesita descripción").max(255),
  tipoMaquina: z.enum(["PLOTTER_UV", "LAMINADORA", "LASER", "SUBLIMADORA", "ESTAMPADO"]),
  cantidad: monto.refine((valor) => Number(valor) > 0, "La cantidad debe ser mayor que 0"),
  precioUnitario: monto,
});

const crearPedidoSchema = z.object({
  clienteId: idSchema,
  fechaEntrega: fecha.optional(),
  items: z.array(itemSchema).min(1, "El pedido debe tener al menos un ítem"),
});

pedidosRouter.post("/", async (req, res) => {
  const datos = crearPedidoSchema.safeParse(req.body);
  if (!datos.success) {
    enviarError(res, 400, "VALIDATION_ERROR", datos.error.issues[0]?.message ?? "Datos inválidos");
    return;
  }
  if (!req.usuario) {
    enviarError(res, 401, "NO_AUTENTICADO", "Debes iniciar sesión");
    return;
  }

  const { clienteId, fechaEntrega, items } = datos.data;

  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
  if (!cliente) {
    enviarError(res, 400, "CLIENTE_NO_EXISTE", "El cliente no existe");
    return;
  }

  const pedido = await prisma.pedido.create({
    data: {
      clienteId,
      usuarioId: req.usuario.id,
      fechaEntrega: fechaEntrega ? new Date(`${fechaEntrega}T00:00:00.000Z`) : undefined,
      items: { create: items },
    },
  });

  res.status(201).json(await obtenerPedido(pedido.id));
});

pedidosRouter.get("/", async (_req, res) => {
  const pedidos = await prisma.pedido.findMany({
    where: { estado: { notIn: ["ENTREGADO", "CANCELADO"] } },
    include: incluirPedido,
    orderBy: [
      { fechaEntrega: { sort: "asc", nulls: "last" } },
      { fechaCreacion: "asc" },
    ],
  });

  res.json(pedidos.map(formatearPedido));
});

pedidosRouter.get("/:id", async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    enviarError(res, 400, "VALIDATION_ERROR", "Id inválido");
    return;
  }

  const pedido = await obtenerPedido(id.data);
  if (!pedido) {
    enviarError(res, 404, "NO_ENCONTRADO", "El pedido no existe");
    return;
  }

  res.json(pedido);
});
