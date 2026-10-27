import type { Agent } from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("GET /api/pedidos/historial", () => {
  function entregado(fechaEntregado: string, clienteId = cliente.id) {
    return crearPedido({
      clienteId,
      usuarioId: usuario.id,
      estado: "ENTREGADO",
      fechaEntregado: new Date(fechaEntregado),
    });
  }

  async function idsDelHistorial(query: Record<string, string>) {
    const res = await agent.get("/api/pedidos/historial").query(query);
    expect(res.status).toBe(200);
    return res.body.map((p: { id: number }) => p.id);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("se resuelve antes que /:id y responde una lista", async () => {
    const res = await agent.get("/api/pedidos/historial");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("solo incluye pedidos ENTREGADO", async () => {
    let entregadoId = 0;
    for (const estado of ["DISENO", "PRODUCCION", "ENTREGA", "ENTREGADO", "CANCELADO"] as const) {
      // Todos con fechaEntregado en el rango, para probar que el filtro es por estado.
      const pedido = await crearPedido({
        clienteId: cliente.id,
        usuarioId: usuario.id,
        estado,
        fechaEntregado: new Date("2026-10-15T15:00:00Z"),
      });
      if (estado === "ENTREGADO") entregadoId = pedido.id;
    }

    expect(await idsDelHistorial({ desde: "2026-10-15", hasta: "2026-10-15" })).toEqual([entregadoId]);
  });

  it("responde con la forma de un pedido e incluye fechaEntregado", async () => {
    const pedido = await entregado("2026-10-15T15:00:00.000Z");

    const res = await agent.get("/api/pedidos/historial").query({ desde: "2026-10-15", hasta: "2026-10-15" });
    const detalle = await agent.get(`/api/pedidos/${pedido.id}`);

    expect(res.body).toEqual([detalle.body]);
    expect(res.body[0]).toMatchObject({ estado: "ENTREGADO", fechaEntregado: "2026-10-15T15:00:00.000Z" });
  });

  it("ordena del entregado más reciente al más antiguo", async () => {
    const primero = await entregado("2026-10-10T15:00:00Z");
    const tercero = await entregado("2026-10-12T15:00:00Z");
    const segundo = await entregado("2026-10-11T15:00:00Z");

    expect(await idsDelHistorial({ desde: "2026-10-10", hasta: "2026-10-12" })).toEqual([
      tercero.id,
      segundo.id,
      primero.id,
    ]);
  });

  it("filtra por nombre del cliente sin distinguir mayúsculas", async () => {
    const otro = await crearCliente({ nombre: "Ferretería Central" });
    const delTrigal = await entregado("2026-10-15T15:00:00Z");
    await entregado("2026-10-15T16:00:00Z", otro.id);

    const query = { desde: "2026-10-15", hasta: "2026-10-15" };
    expect(await idsDelHistorial({ ...query, buscar: "TRIGAL" })).toEqual([delTrigal.id]);
    expect(await idsDelHistorial({ ...query, buscar: "   " })).toHaveLength(2);
  });

  describe("días de Colombia (UTC−5)", () => {
    it("hasta incluye lo entregado a las 10 p. m. de ese día en Colombia, que en UTC ya es el día siguiente", async () => {
      // 2026-10-27 22:00 en Colombia = 2026-10-28 03:00 UTC.
      const pedido = await entregado("2026-10-28T03:00:00.000Z");

      expect(await idsDelHistorial({ desde: "2026-10-27", hasta: "2026-10-27" })).toEqual([pedido.id]);
      expect(await idsDelHistorial({ desde: "2026-10-28", hasta: "2026-10-28" })).toEqual([]);
    });

    it("desde empieza a la medianoche de Colombia (05:00 UTC)", async () => {
      const inicio = await entregado("2026-10-27T05:00:00.000Z");
      await entregado("2026-10-27T04:59:59.999Z"); // 26 de octubre, 11:59:59.999 p. m. en Colombia

      expect(await idsDelHistorial({ desde: "2026-10-27", hasta: "2026-10-27" })).toEqual([inicio.id]);
    });

    it("sin desde ni hasta trae los últimos 7 días de Colombia, incluido hoy", async () => {
      const finDelDia26 = await entregado("2026-10-27T04:59:59.999Z");
      const inicioDelDia20 = await entregado("2026-10-20T05:00:00.000Z");
      await entregado("2026-10-20T04:59:59.999Z"); // 19 de octubre en Colombia: fuera
      await entregado("2026-10-27T05:00:00.000Z"); // 27 de octubre en Colombia: fuera

      // 2026-10-27 03:00 UTC: en Colombia todavía es el 26 a las 10 p. m.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-27T03:00:00.000Z"));

      expect(await idsDelHistorial({})).toEqual([finDelDia26.id, inicioDelDia20.id]);
    });

    it("solo con desde llega hasta hoy", async () => {
      const dia25 = await entregado("2026-10-25T15:00:00Z");
      const dia26 = await entregado("2026-10-26T15:00:00Z");
      await entregado("2026-10-24T15:00:00Z");

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-27T03:00:00.000Z"));

      expect(await idsDelHistorial({ desde: "2026-10-25" })).toEqual([dia26.id, dia25.id]);
    });

    it("solo con hasta trae los 7 días que terminan ese día", async () => {
      const dia10 = await entregado("2026-10-10T15:00:00Z");
      const dia4 = await entregado("2026-10-04T05:00:00.000Z");
      await entregado("2026-10-04T04:59:59.999Z"); // 3 de octubre en Colombia: fuera

      expect(await idsDelHistorial({ hasta: "2026-10-10" })).toEqual([dia10.id, dia4.id]);
    });
  });

  it("acepta un rango de 366 días contando los dos extremos", async () => {
    const res = await agent.get("/api/pedidos/historial").query({ desde: "2025-10-28", hasta: "2026-10-28" });

    expect(res.status).toBe(200);
  });

  it.each([
    ["rango invertido", { desde: "2026-10-28", hasta: "2026-10-27" }, "desde no puede ser posterior a hasta"],
    ["rango de 367 días", { desde: "2025-10-27", hasta: "2026-10-28" }, "El rango máximo es de 366 días"],
    ["desde que no existe", { desde: "2026-02-30" }, "La fecha no existe"],
    ["hasta que no existe", { hasta: "2026-02-30" }, "La fecha no existe"],
    ["desde en otro formato", { desde: "27/10/2026" }, "Usa el formato AAAA-MM-DD"],
    ["hasta en otro formato", { hasta: "27/10/2026" }, "Usa el formato AAAA-MM-DD"],
    ["búsqueda demasiado larga", { buscar: "a".repeat(151) }, "La búsqueda es demasiado larga"],
  ])("responde 400 con %s", async (_caso, query, mensaje) => {
    const res = await agent.get("/api/pedidos/historial").query(query);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "VALIDATION_ERROR", message: mensaje } });
  });
});

describe("PATCH /api/pedidos/:id", () => {
  const NUEVOS_ITEMS = [
    { descripcion: "Vinilo cortado", tipoMaquina: "LASER", cantidad: "3", precioUnitario: "15000" },
    { descripcion: "Laminado", tipoMaquina: "LAMINADORA", cantidad: "1", precioUnitario: "5000.50" },
  ];

  function pedidoActivo(cambios: Partial<Parameters<typeof crearPedido>[0]> = {}) {
    return crearPedido({
      clienteId: cliente.id,
      usuarioId: usuario.id,
      fechaEntrega: "2026-10-05",
      items: [{ descripcion: "Pendón 1x2m", cantidad: "1", precioUnitario: "85000" }],
      ...cambios,
    });
  }

  async function idsDeItems(pedidoId: number) {
    const items = await prisma.detallePedido.findMany({ where: { pedidoId }, orderBy: { id: "asc" } });
    return items.map((item) => item.id);
  }

  it("cambia solo fechaEntrega y deja los ítems intactos", async () => {
    const pedido = await pedidoActivo();
    const idsAntes = await idsDeItems(pedido.id);

    const res = await agent.patch(`/api/pedidos/${pedido.id}`).send({ fechaEntrega: "2026-11-15" });

    expect(res.status).toBe(200);
    expect(res.body.fechaEntrega).toBe("2026-11-15");
    expect(await idsDeItems(pedido.id)).toEqual(idsAntes);
  });

  it("quita fechaEntrega con null", async () => {
    const pedido = await pedidoActivo();

    const res = await agent.patch(`/api/pedidos/${pedido.id}`).send({ fechaEntrega: null });

    expect(res.status).toBe(200);
    expect(res.body.fechaEntrega).toBeNull();
  });

  it("reemplaza la lista completa de ítems y recalcula el total", async () => {
    const pedido = await pedidoActivo();
    const idsAntes = await idsDeItems(pedido.id);

    const res = await agent.patch(`/api/pedidos/${pedido.id}`).send({ items: NUEVOS_ITEMS });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { id: expect.any(Number), descripcion: "Vinilo cortado", tipoMaquina: "LASER", cantidad: "3.00", precioUnitario: "15000.00" },
      { id: expect.any(Number), descripcion: "Laminado", tipoMaquina: "LAMINADORA", cantidad: "1.00", precioUnitario: "5000.50" },
    ]);
    expect(res.body.total).toBe("50000.50");
    expect(res.body.fechaEntrega).toBe("2026-10-05");
    const idsDespues = await idsDeItems(pedido.id);
    expect(idsDespues).toHaveLength(2);
    expect(idsDespues.some((itemId) => idsAntes.includes(itemId))).toBe(false);
  });

  it("cambia fechaEntrega e ítems a la vez", async () => {
    const pedido = await pedidoActivo();

    const res = await agent
      .patch(`/api/pedidos/${pedido.id}`)
      .send({ fechaEntrega: "2026-12-01", items: NUEVOS_ITEMS });

    expect(res.status).toBe(200);
    expect(res.body.fechaEntrega).toBe("2026-12-01");
    expect(res.body.items).toHaveLength(2);
  });

  it("con cuerpo vacío responde 200 sin cambios", async () => {
    const pedido = await pedidoActivo();
    const antes = await agent.get(`/api/pedidos/${pedido.id}`);

    const res = await agent.patch(`/api/pedidos/${pedido.id}`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(antes.body);
  });

  it("rechaza estado en el body y no cambia el estado", async () => {
    const pedido = await pedidoActivo();

    const res = await agent
      .patch(`/api/pedidos/${pedido.id}`)
      .send({ estado: "ENTREGADO", fechaEntrega: "2026-11-15" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Para cambiar el estado usa PATCH /api/pedidos/:id/estado" },
    });
    const guardado = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(guardado.estado).toBe("DISENO");
    expect(guardado.fechaEntrega?.toISOString().slice(0, 10)).toBe("2026-10-05");
  });

  it.each([
    ["items vacío", { items: [] }, "El pedido debe tener al menos un ítem"],
    ["un ítem sin descripción", { items: [{ ...NUEVOS_ITEMS[0], descripcion: " " }] }, "Cada ítem necesita descripción"],
    ["un ítem con cantidad 0", { items: [{ ...NUEVOS_ITEMS[0], cantidad: "0" }] }, "La cantidad debe ser mayor que 0"],
    ["un precio mayor que el máximo", { items: [{ ...NUEVOS_ITEMS[0], precioUnitario: "100000000" }] }, "El monto máximo es 99999999.99"],
    ["una fecha que no existe", { fechaEntrega: "2026-02-30" }, "La fecha no existe"],
    ["una fecha en otro formato", { fechaEntrega: "05/10/2026" }, "Usa el formato AAAA-MM-DD"],
  ])("responde 400 con %s", async (_caso, body, mensaje) => {
    const pedido = await pedidoActivo();
    const idsAntes = await idsDeItems(pedido.id);

    const res = await agent.patch(`/api/pedidos/${pedido.id}`).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "VALIDATION_ERROR", message: mensaje } });
    expect(await idsDeItems(pedido.id)).toEqual(idsAntes);
  });

  it.each(["abc", "0", "2147483648"])("responde 400 con id %s", async (id) => {
    const res = await agent.patch(`/api/pedidos/${id}`).send({ fechaEntrega: "2026-11-15" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Id inválido" } });
  });

  it.each(["999", "2147483647"])("responde 404 si el pedido %s no existe", async (id) => {
    const res = await agent.patch(`/api/pedidos/${id}`).send({ fechaEntrega: "2026-11-15" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NO_ENCONTRADO", message: "El pedido no existe" } });
  });

  it.each(["ENTREGADO", "CANCELADO"] as const)(
    "responde 409 PEDIDO_CERRADO si el pedido está %s y no cambia nada",
    async (estado) => {
      const pedido = await pedidoActivo({ estado });
      const idsAntes = await idsDeItems(pedido.id);

      const res = await agent
        .patch(`/api/pedidos/${pedido.id}`)
        .send({ fechaEntrega: "2026-11-15", items: NUEVOS_ITEMS });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PEDIDO_CERRADO");
      expect(await idsDeItems(pedido.id)).toEqual(idsAntes);
      const guardado = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
      expect(guardado.fechaEntrega?.toISOString().slice(0, 10)).toBe("2026-10-05");
    },
  );

  describe("total frente a lo ya pagado", () => {
    it("responde 409 TOTAL_MENOR_QUE_PAGADO si el total quedaría por debajo de lo pagado", async () => {
      const pedido = await pedidoActivo();
      await prisma.pago.create({ data: { pedidoId: pedido.id, monto: "60000", metodo: "EFECTIVO" } });
      const idsAntes = await idsDeItems(pedido.id);

      const res = await agent.patch(`/api/pedidos/${pedido.id}`).send({ items: NUEVOS_ITEMS });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: "TOTAL_MENOR_QUE_PAGADO",
          message: "El total quedaría en 50000.50, menos de lo ya pagado (60000.00). Corrige primero el pago.",
        },
      });
      expect(await idsDeItems(pedido.id)).toEqual(idsAntes);
    });

    it("permite un total igual a lo pagado, con saldo 0.00", async () => {
      const pedido = await pedidoActivo();
      await prisma.pago.create({ data: { pedidoId: pedido.id, monto: "50000.50", metodo: "EFECTIVO" } });

      const res = await agent.patch(`/api/pedidos/${pedido.id}`).send({ items: NUEVOS_ITEMS });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: "50000.50", pagado: "50000.50", saldo: "0.00" });
    });

    it("no cuenta los pagos borrados", async () => {
      const pedido = await pedidoActivo();
      await prisma.pago.createMany({
        data: [
          { pedidoId: pedido.id, monto: "40000", metodo: "EFECTIVO" },
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

      // 50000.50 es menos que 80000 (contando el borrado) pero más que 40000 (vigente).
      const res = await agent.patch(`/api/pedidos/${pedido.id}`).send({ items: NUEVOS_ITEMS });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: "50000.50", pagado: "40000.00", saldo: "10000.50" });
    });
  });

  it("es atómico: si falla un ítem nuevo, quedan los ítems y la fecha anteriores", async () => {
    const pedido = await pedidoActivo();
    const idsAntes = await idsDeItems(pedido.id);
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await conTriggerQueFalla(() =>
      agent.patch(`/api/pedidos/${pedido.id}`).send({
        fechaEntrega: "2026-12-24",
        items: [NUEVOS_ITEMS[0], { ...NUEVOS_ITEMS[1], descripcion: DESCRIPCION_QUE_FALLA }],
      }),
    );

    expect(res.status).toBe(500);
    expect(consola).toHaveBeenCalled();
    consola.mockRestore();
    expect(await idsDeItems(pedido.id)).toEqual(idsAntes);
    const guardado = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(guardado.fechaEntrega?.toISOString().slice(0, 10)).toBe("2026-10-05");
  });
});

describe("PATCH /api/pedidos/:id/estado", () => {
  const ESTADOS = ["DISENO", "PRODUCCION", "ENTREGA", "ENTREGADO", "CANCELADO"] as const;
  const PARES = ESTADOS.flatMap((origen) =>
    ESTADOS.filter((destino) => destino !== origen).map((destino) => [origen, destino] as const),
  );
  const ENTREGADO_ANTES = new Date("2026-10-20T15:00:00.000Z");

  function crearEn(estado: (typeof ESTADOS)[number]) {
    return crearPedido({
      clienteId: cliente.id,
      usuarioId: usuario.id,
      estado,
      fechaEntregado: estado === "ENTREGADO" ? ENTREGADO_ANTES : undefined,
    });
  }

  it.each(PARES)("permite mover de %s a %s", async (origen, destino) => {
    const pedido = await crearEn(origen);

    const res = await agent.patch(`/api/pedidos/${pedido.id}/estado`).send({ estado: destino });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe(destino);
    const guardado = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(guardado.estado).toBe(destino);
    // fechaEntregado tiene valor si y solo si el pedido queda ENTREGADO.
    expect(guardado.fechaEntregado !== null).toBe(destino === "ENTREGADO");
  });

  it("al pasar a ENTREGADO guarda la fecha y hora actual", async () => {
    const pedido = await crearEn("ENTREGA");

    const antes = Date.now();
    const res = await agent.patch(`/api/pedidos/${pedido.id}/estado`).send({ estado: "ENTREGADO" });
    const despues = Date.now();

    const fechaEntregado = new Date(res.body.fechaEntregado).getTime();
    expect(fechaEntregado).toBeGreaterThanOrEqual(antes);
    expect(fechaEntregado).toBeLessThanOrEqual(despues);
  });

  it.each(["ENTREGA", "CANCELADO"] as const)(
    "al salir de ENTREGADO hacia %s, fechaEntregado vuelve a null",
    async (destino) => {
      const pedido = await crearEn("ENTREGADO");

      const res = await agent.patch(`/api/pedidos/${pedido.id}/estado`).send({ estado: destino });

      expect(res.body.fechaEntregado).toBeNull();
    },
  );

  it("si el estado es el mismo responde 200 sin cambiar fechaEntregado", async () => {
    const pedido = await crearEn("ENTREGADO");

    const res = await agent.patch(`/api/pedidos/${pedido.id}/estado`).send({ estado: "ENTREGADO" });

    expect(res.status).toBe(200);
    expect(res.body.fechaEntregado).toBe(ENTREGADO_ANTES.toISOString());
    const guardado = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(guardado.fechaEntregado).toEqual(ENTREGADO_ANTES);
  });

  it("si el estado es el mismo en otra columna también responde 200", async () => {
    const pedido = await crearEn("DISENO");

    const res = await agent.patch(`/api/pedidos/${pedido.id}/estado`).send({ estado: "DISENO" });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe("DISENO");
  });

  it("responde el pedido completo y no toca ítems ni pagos", async () => {
    const pedido = await crearPedido({
      clienteId: cliente.id,
      usuarioId: usuario.id,
      items: [{ cantidad: "1", precioUnitario: "85000" }],
    });
    await prisma.pago.create({ data: { pedidoId: pedido.id, monto: "40000", metodo: "EFECTIVO" } });
    const antes = await agent.get(`/api/pedidos/${pedido.id}`);

    const res = await agent.patch(`/api/pedidos/${pedido.id}/estado`).send({ estado: "PRODUCCION" });

    expect(res.body).toEqual({ ...antes.body, estado: "PRODUCCION" });
  });

  it.each([
    ["un estado que no existe", { estado: "TERMINADO" }],
    ["el estado en minúscula", { estado: "entregado" }],
    ["sin estado", {}],
    ["un número", { estado: 1 }],
  ])("responde 400 con %s", async (_caso, body) => {
    const pedido = await crearEn("DISENO");

    const res = await agent.patch(`/api/pedidos/${pedido.id}/estado`).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "El estado no es válido" } });
    const guardado = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(guardado.estado).toBe("DISENO");
  });

  it("responde 400 sin cuerpo", async () => {
    const pedido = await crearEn("DISENO");

    const res = await agent.patch(`/api/pedidos/${pedido.id}/estado`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("El estado no es válido");
  });

  it.each(["abc", "0", "2147483648"])("responde 400 con id %s", async (id) => {
    const res = await agent.patch(`/api/pedidos/${id}/estado`).send({ estado: "ENTREGA" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Id inválido" } });
  });

  it.each(["999", "2147483647"])("responde 404 si el pedido %s no existe", async (id) => {
    const res = await agent.patch(`/api/pedidos/${id}/estado`).send({ estado: "ENTREGA" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NO_ENCONTRADO", message: "El pedido no existe" } });
  });
});

describe("pendiente de implementar", () => {
  it.todo("los cambios de pedidos emiten pedido:creado, pedido:actualizado y pedido:estado por socket");
});
