import { beforeEach, describe, expect, it } from "vitest";
import type { Agent } from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { crearCliente, crearPedido, iniciarSesion } from "./helpers.js";

let agent: Agent;
let usuarioId: number;

beforeEach(async () => {
  const sesion = await iniciarSesion();
  agent = sesion.agent;
  usuarioId = sesion.usuario.id;
});

describe("GET /api/clientes", () => {
  it("lista los clientes ordenados por nombre, solo con id, nombre y teléfono", async () => {
    const zapateria = await crearCliente({ nombre: "Zapatería Rueda", telefonoWhatsapp: "3110000000" });
    const almacen = await crearCliente({ nombre: "Almacén La 14", telefonoWhatsapp: "3120000000" });

    const res = await agent.get("/api/clientes");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: almacen.id, nombre: "Almacén La 14", telefonoWhatsapp: "3120000000" },
      { id: zapateria.id, nombre: "Zapatería Rueda", telefonoWhatsapp: "3110000000" },
    ]);
  });

  it("filtra por nombre sin importar mayúsculas", async () => {
    await crearCliente({ nombre: "Panadería El Trigal" });
    await crearCliente({ nombre: "Ferretería Central" });

    const res = await agent.get("/api/clientes").query({ buscar: "TRIGAL" });

    expect(res.body.map((c: { nombre: string }) => c.nombre)).toEqual(["Panadería El Trigal"]);
  });

  it("filtra por parte del teléfono", async () => {
    await crearCliente({ nombre: "Uno", telefonoWhatsapp: "3001234567" });
    await crearCliente({ nombre: "Dos", telefonoWhatsapp: "3157654321" });

    const res = await agent.get("/api/clientes").query({ buscar: "1234" });

    expect(res.body.map((c: { nombre: string }) => c.nombre)).toEqual(["Uno"]);
  });

  it("con buscar vacío devuelve todos", async () => {
    await crearCliente();
    await crearCliente();

    const res = await agent.get("/api/clientes").query({ buscar: "   " });

    expect(res.body).toHaveLength(2);
  });

  it("devuelve como máximo 50 clientes", async () => {
    await prisma.cliente.createMany({
      data: Array.from({ length: 51 }, (_, i) => ({
        nombre: `Cliente ${String(i).padStart(2, "0")}`,
        telefonoWhatsapp: String(3200000000 + i),
      })),
    });

    const res = await agent.get("/api/clientes");

    expect(res.body).toHaveLength(50);
  });
});

describe("POST /api/clientes", () => {
  it("crea el cliente y guarda el teléfono solo con dígitos", async () => {
    const res = await agent
      .post("/api/clientes")
      .send({ nombre: "  Panadería El Trigal ", telefonoWhatsapp: "300 123-4567" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      nombre: "Panadería El Trigal",
      telefonoWhatsapp: "3001234567",
    });
    const guardado = await prisma.cliente.findUnique({ where: { id: res.body.id } });
    expect(guardado?.telefonoWhatsapp).toBe("3001234567");
  });

  it.each([
    ["sin nombre", { telefonoWhatsapp: "3001234567" }],
    ["nombre solo con espacios", { nombre: "   ", telefonoWhatsapp: "3001234567" }],
    ["sin teléfono", { nombre: "Cliente" }],
    ["teléfono de 9 dígitos", { nombre: "Cliente", telefonoWhatsapp: "300123456" }],
    ["teléfono que no empieza en 3", { nombre: "Cliente", telefonoWhatsapp: "6011234567" }],
    // Al quitar los símbolos quedan 12 dígitos (57 + celular): hoy se rechaza.
    ["teléfono con indicativo +57", { nombre: "Cliente", telefonoWhatsapp: "+57 300 123 4567" }],
  ])("responde 400 con %s", async (_caso, body) => {
    const res = await agent.post("/api/clientes").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.cliente.count()).toBe(0);
  });

  it("explica en el mensaje qué campo está mal", async () => {
    const res = await agent.post("/api/clientes").send({ nombre: "Cliente", telefonoWhatsapp: "123" });

    expect(res.body.error.message).toBe("El teléfono debe ser un celular de 10 dígitos");
  });

  it("responde 409 si ya existe un cliente con ese teléfono", async () => {
    await crearCliente({ telefonoWhatsapp: "3001234567" });

    const res = await agent.post("/api/clientes").send({ nombre: "Otro", telefonoWhatsapp: "300 123 4567" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: "CLIENTE_DUPLICADO", message: "Ya existe un cliente con ese teléfono" },
    });
    expect(await prisma.cliente.count()).toBe(1);
  });
});

describe("PATCH /api/clientes/:id", () => {
  it("cambia solo los campos enviados", async () => {
    const cliente = await crearCliente({ nombre: "Antes", telefonoWhatsapp: "3001234567" });

    const res = await agent.patch(`/api/clientes/${cliente.id}`).send({ nombre: "Después" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: cliente.id, nombre: "Después", telefonoWhatsapp: "3001234567" });
  });

  it("permite cambiar el nombre aunque existan otros clientes", async () => {
    await crearCliente({ telefonoWhatsapp: "3110000000" });
    const cliente = await crearCliente({ telefonoWhatsapp: "3120000000" });

    const res = await agent.patch(`/api/clientes/${cliente.id}`).send({ nombre: "Nuevo nombre" });

    expect(res.status).toBe(200);
  });

  it("permite reenviar su propio teléfono", async () => {
    const cliente = await crearCliente({ telefonoWhatsapp: "3001234567" });

    const res = await agent
      .patch(`/api/clientes/${cliente.id}`)
      .send({ nombre: "Mismo teléfono", telefonoWhatsapp: "3001234567" });

    expect(res.status).toBe(200);
    expect(res.body.telefonoWhatsapp).toBe("3001234567");
  });

  it("responde 409 si el teléfono ya lo tiene otro cliente", async () => {
    await crearCliente({ telefonoWhatsapp: "3110000000" });
    const cliente = await crearCliente({ telefonoWhatsapp: "3120000000" });

    const res = await agent.patch(`/api/clientes/${cliente.id}`).send({ telefonoWhatsapp: "311 000 0000" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CLIENTE_DUPLICADO");
    const sinCambios = await prisma.cliente.findUnique({ where: { id: cliente.id } });
    expect(sinCambios?.telefonoWhatsapp).toBe("3120000000");
  });

  it("responde 400 con un teléfono inválido", async () => {
    const cliente = await crearCliente();

    const res = await agent.patch(`/api/clientes/${cliente.id}`).send({ telefonoWhatsapp: "123" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("responde 404 si el cliente no existe", async () => {
    const res = await agent.patch("/api/clientes/999").send({ nombre: "X" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NO_ENCONTRADO", message: "El cliente no existe" } });
  });
});

describe("DELETE /api/clientes/:id", () => {
  it("borra un cliente sin pedidos", async () => {
    const cliente = await crearCliente();

    const res = await agent.delete(`/api/clientes/${cliente.id}`);

    expect(res.status).toBe(204);
    expect(await prisma.cliente.findUnique({ where: { id: cliente.id } })).toBeNull();
  });

  it("responde 409 y no borra si el cliente tiene pedidos", async () => {
    const cliente = await crearCliente();
    await crearPedido({ clienteId: cliente.id, usuarioId });

    const res = await agent.delete(`/api/clientes/${cliente.id}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CLIENTE_CON_PEDIDOS");
    expect(await prisma.cliente.findUnique({ where: { id: cliente.id } })).not.toBeNull();
  });

  it("responde 404 si el cliente no existe", async () => {
    const res = await agent.delete("/api/clientes/999");

    expect(res.status).toBe(404);
  });
});

describe("validación del id en la URL", () => {
  it.each([
    ["patch", "abc"],
    ["patch", "1.5"],
    ["patch", "0"],
    ["patch", "2147483648"],
    ["delete", "abc"],
    ["delete", "2147483648"],
  ] as const)("%s con id %s responde 400", async (metodo, id) => {
    const res = await agent[metodo](`/api/clientes/${id}`).send({ nombre: "X" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each(["patch", "delete"] as const)(
    "%s acepta el id máximo de Postgres (2147483647) y responde 404",
    async (metodo) => {
      const res = await agent[metodo]("/api/clientes/2147483647").send({ nombre: "X" });

      expect(res.status).toBe(404);
    },
  );
});
