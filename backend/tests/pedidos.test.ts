import type { Agent } from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import {
  DESCRIPCION_QUE_FALLA,
  conTriggerQueFalla,
  crearCliente,
  crearPedido,
  crearUsuario,
  iniciarSesion,
} from "./helpers.js";

let agent: Agent;
let usuario: { id: number; nombre: string };
let cliente: { id: number; nombre: string; telefonoWhatsapp: string };

beforeEach(async () => {
  const sesion = await iniciarSesion();
  agent = sesion.agent;
  usuario = sesion.usuario;
  const c = await crearCliente({ nombre: "Panadería El Trigal", telefonoWhatsapp: "3001234567" });
  cliente = { id: c.id, nombre: c.nombre, telefonoWhatsapp: c.telefonoWhatsapp };
});

function pedidoValido(cambios: Record<string, unknown> = {}) {
  return {
    clienteId: cliente.id,
    fechaEntrega: "2026-10-05",
    items: [{ descripcion: "Pendón 1x2m", tipoMaquina: "PLOTTER_UV", cantidad: "1", precioUnitario: "85000" }],
    ...cambios,
  };
}

function conItem(cambios: Record<string, unknown>) {
  return pedidoValido({
    items: [{ descripcion: "Pendón 1x2m", tipoMaquina: "PLOTTER_UV", cantidad: "1", precioUnitario: "85000", ...cambios }],
  });
}

describe("POST /api/pedidos", () => {
  it("crea el pedido en DISENO con totales calculados y montos como string", async () => {
    const res = await agent.post("/api/pedidos").send(
      pedidoValido({
        items: [
          { descripcion: "Stickers troquelados", tipoMaquina: "LASER", cantidad: "2", precioUnitario: "12500.50" },
          { descripcion: "Pendón 1x2m", tipoMaquina: "PLOTTER_UV", cantidad: "1", precioUnitario: "85000" },
        ],
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      estado: "DISENO",
      fechaCreacion: expect.any(String),
      fechaEntrega: "2026-10-05",
      fechaEntregado: null,
      cliente,
      usuario: { id: usuario.id, nombre: usuario.nombre },
      items: [
        { id: expect.any(Number), descripcion: "Stickers troquelados", tipoMaquina: "LASER", cantidad: "2.00", precioUnitario: "12500.50" },
        { id: expect.any(Number), descripcion: "Pendón 1x2m", tipoMaquina: "PLOTTER_UV", cantidad: "1.00", precioUnitario: "85000.00" },
      ],
      pagos: [],
      total: "110001.00",
      pagado: "0.00",
      saldo: "110001.00",
    });
  });

  it("toma el usuario de la sesión e ignora usuarioId y estado del body", async () => {
    const otro = await crearUsuario();

    const res = await agent.post("/api/pedidos").send(pedidoValido({ usuarioId: otro.id, estado: "ENTREGADO" }));

    expect(res.status).toBe(201);
    expect(res.body.usuario.id).toBe(usuario.id);
    expect(res.body.estado).toBe("DISENO");
  });

  it("devuelve fechaEntrega igual a la enviada, sin correrse por la zona horaria", async () => {
    const res = await agent.post("/api/pedidos").send(pedidoValido({ fechaEntrega: "2026-12-31" }));

    expect(res.body.fechaEntrega).toBe("2026-12-31");
  });

  it("acepta un pedido sin fechaEntrega", async () => {
    const res = await agent.post("/api/pedidos").send(pedidoValido({ fechaEntrega: undefined }));

    expect(res.status).toBe(201);
    expect(res.body.fechaEntrega).toBeNull();
  });

  it("acepta el monto máximo 99999999.99 en cantidad y precio", async () => {
    const res = await agent.post("/api/pedidos").send(conItem({ cantidad: "99999999.99", precioUnitario: "99999999.99" }));

    expect(res.status).toBe(201);
    expect(res.body.items[0]).toMatchObject({ cantidad: "99999999.99", precioUnitario: "99999999.99" });
  });

  it.each([
    ["sin ítems", () => pedidoValido({ items: [] }), "El pedido debe tener al menos un ítem"],
    ["sin clienteId", () => pedidoValido({ clienteId: undefined }), undefined],
    ["clienteId mayor que el int de Postgres", () => pedidoValido({ clienteId: 2147483648 }), undefined],
    ["ítem sin descripción", () => conItem({ descripcion: "  " }), "Cada ítem necesita descripción"],
    ["tipoMaquina inválido", () => conItem({ tipoMaquina: "IMPRESORA" }), undefined],
    ["cantidad 0", () => conItem({ cantidad: "0" }), "La cantidad debe ser mayor que 0"],
    ["tres decimales", () => conItem({ precioUnitario: "1.234" }), "Usa números con máximo 2 decimales y sin separador de miles"],
    ["separador de miles", () => conItem({ precioUnitario: "45,000" }), "Usa números con máximo 2 decimales y sin separador de miles"],
    ["precio mayor que el máximo", () => conItem({ precioUnitario: "100000000" }), "El monto máximo es 99999999.99"],
    ["precio mayor que el máximo con decimales", () => conItem({ precioUnitario: "100000000.00" }), "El monto máximo es 99999999.99"],
    ["cantidad mayor que el máximo", () => conItem({ cantidad: "100000000" }), "El monto máximo es 99999999.99"],
    ["fecha que no existe", () => pedidoValido({ fechaEntrega: "2026-02-30" }), "La fecha no existe"],
    ["fecha en otro formato", () => pedidoValido({ fechaEntrega: "05/10/2026" }), "Usa el formato AAAA-MM-DD"],
  ])("responde 400 con %s", async (_caso, body, mensaje) => {
    // body es una función: la tabla se arma antes de que beforeEach cree el cliente.
    const res = await agent.post("/api/pedidos").send(body());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    if (mensaje) expect(res.body.error.message).toBe(mensaje);
    expect(await prisma.pedido.count()).toBe(0);
  });

  it("responde 400 CLIENTE_NO_EXISTE si el cliente no existe", async () => {
    const res = await agent.post("/api/pedidos").send(pedidoValido({ clienteId: 999 }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "CLIENTE_NO_EXISTE", message: "El cliente no existe" } });
  });

  it("es atómico: si la base falla al guardar un ítem, no queda ni el pedido ni sus ítems", async () => {
    // El 500 se registra con console.error; se silencia para no ensuciar la salida.
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await conTriggerQueFalla(() =>
      agent.post("/api/pedidos").send(
        pedidoValido({
          items: [
            { descripcion: "Ítem que sí se inserta", tipoMaquina: "LASER", cantidad: "1", precioUnitario: "1000" },
            { descripcion: DESCRIPCION_QUE_FALLA, tipoMaquina: "LASER", cantidad: "1", precioUnitario: "1000" },
          ],
        }),
      ),
    );

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("ERROR_INTERNO");
    expect(consola).toHaveBeenCalled();
    expect(await prisma.pedido.count()).toBe(0);
    expect(await prisma.detallePedido.count()).toBe(0);
    consola.mockRestore();

    // El trigger se borró: un pedido normal vuelve a guardarse.
    const despues = await agent.post("/api/pedidos").send(pedidoValido());
    expect(despues.status).toBe(201);
  });
});

describe("GET /api/pedidos", () => {
  it("excluye los pedidos ENTREGADO y CANCELADO", async () => {
    for (const estado of ["DISENO", "PRODUCCION", "ENTREGA", "ENTREGADO", "CANCELADO"] as const) {
      await crearPedido({ clienteId: cliente.id, usuarioId: usuario.id, estado });
    }

    const res = await agent.get("/api/pedidos");

    expect(res.status).toBe(200);
    expect(res.body.map((p: { estado: string }) => p.estado).sort()).toEqual(["DISENO", "ENTREGA", "PRODUCCION"]);
  });

  it("ordena por fechaEntrega, deja al final los que no tienen fecha y desempata por fechaCreacion", async () => {
    const base = { clienteId: cliente.id, usuarioId: usuario.id };
    const sinFecha = await crearPedido({ ...base, fechaCreacion: new Date("2026-09-01T10:00:00Z") });
    const dia10 = await crearPedido({ ...base, fechaEntrega: "2026-10-10", fechaCreacion: new Date("2026-09-02T10:00:00Z") });
    const dia5Nuevo = await crearPedido({ ...base, fechaEntrega: "2026-10-05", fechaCreacion: new Date("2026-09-03T10:00:00Z") });
    const dia5Viejo = await crearPedido({ ...base, fechaEntrega: "2026-10-05", fechaCreacion: new Date("2026-09-01T09:00:00Z") });

    const res = await agent.get("/api/pedidos");

    expect(res.body.map((p: { id: number }) => p.id)).toEqual([dia5Viejo.id, dia5Nuevo.id, dia10.id, sinFecha.id]);
  });

  it("calcula pagado y saldo sin contar los pagos borrados", async () => {
    const pedido = await crearPedido({
      clienteId: cliente.id,
      usuarioId: usuario.id,
      items: [{ cantidad: "1", precioUnitario: "85000" }],
    });
    await prisma.pago.createMany({
      data: [
        { pedidoId: pedido.id, monto: "40000", metodo: "TRANSFERENCIA" },
        {
          pedidoId: pedido.id,
          monto: "40000",
          metodo: "EFECTIVO",
          borradoEn: new Date(),
          borradoPorId: usuario.id,
          motivoBorrado: "Se registró dos veces",
        },
      ],
    });

    const res = await agent.get("/api/pedidos");

    expect(res.body[0]).toMatchObject({ total: "85000.00", pagado: "40000.00", saldo: "45000.00" });
    expect(res.body[0].pagos).toHaveLength(1);
  });

  it("devuelve una lista vacía si no hay pedidos activos", async () => {
    const res = await agent.get("/api/pedidos");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /api/pedidos/:id", () => {
  it("devuelve el detalle con sus pagos", async () => {
    const pedido = await crearPedido({
      clienteId: cliente.id,
      usuarioId: usuario.id,
      items: [{ cantidad: "1", precioUnitario: "85000" }],
    });
    const pago = await prisma.pago.create({
      data: { pedidoId: pedido.id, monto: "40000", metodo: "TRANSFERENCIA" },
    });

    const res = await agent.get(`/api/pedidos/${pedido.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: pedido.id,
      cliente,
      pagos: [{ id: pago.id, monto: "40000.00", metodo: "TRANSFERENCIA", fecha: pago.fecha.toISOString() }],
      total: "85000.00",
      pagado: "40000.00",
      saldo: "45000.00",
    });
  });

  it.each(["999", "2147483647"])("responde 404 si el pedido %s no existe", async (id) => {
    const res = await agent.get(`/api/pedidos/${id}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NO_ENCONTRADO", message: "El pedido no existe" } });
  });

  it.each(["abc", "0", "2147483648"])("responde 400 con id %s", async (id) => {
    const res = await agent.get(`/api/pedidos/${id}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("pendiente de implementar", () => {
  it.todo("GET /api/pedidos/historial filtra ENTREGADO por fechaEntregado (por defecto, últimos 7 días)");
  it.todo("PATCH /api/pedidos/:id edita fecha de entrega e ítems sin cambiar el estado");
  it.todo("PATCH /api/pedidos/:id/estado guarda fechaEntregado al pasar a ENTREGADO");
  it.todo("PATCH /api/pedidos/:id/estado vuelve fechaEntregado a null al salir de ENTREGADO");
  it.todo("los cambios de pedidos emiten pedido:creado, pedido:actualizado y pedido:estado por socket");
});
