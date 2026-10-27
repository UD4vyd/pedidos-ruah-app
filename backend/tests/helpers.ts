import request from "supertest";
import { expect } from "vitest";
import { app } from "../src/app.js";
import type { EstadoPedido, TipoMaquina } from "../src/generated/prisma/enums.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/services/password.js";

export const PASSWORD_PRUEBA = "clave-de-prueba-123";

// argon2 es lento a propósito. El hash se calcula una sola vez por archivo
// de pruebas y se reutiliza en todos los usuarios.
let hashPrueba: Promise<string> | undefined;

let contador = 0;
function siguiente() {
  contador += 1;
  return contador;
}

export async function crearUsuario(datos: { nombre?: string; email?: string } = {}) {
  const n = siguiente();
  hashPrueba ??= hashPassword(PASSWORD_PRUEBA);
  return prisma.usuario.create({
    data: {
      nombre: datos.nombre ?? `Usuario ${n}`,
      email: datos.email ?? `usuario${n}@ruah.test`,
      passwordHash: await hashPrueba,
    },
    select: { id: true, nombre: true, email: true },
  });
}

// Devuelve un agente de supertest que guarda la cookie de sesión entre peticiones.
export async function iniciarSesion(usuario?: { email: string }) {
  const u = usuario ?? (await crearUsuario());
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email: u.email, password: PASSWORD_PRUEBA });
  expect(res.status).toBe(200);
  return { agent, usuario: res.body.usuario as { id: number; nombre: string; email: string } };
}

export async function crearCliente(datos: { nombre?: string; telefonoWhatsapp?: string } = {}) {
  const n = siguiente();
  return prisma.cliente.create({
    data: {
      nombre: datos.nombre ?? `Cliente ${n}`,
      telefonoWhatsapp: datos.telefonoWhatsapp ?? String(3000000000 + n),
    },
  });
}

type ItemPrueba = {
  descripcion?: string;
  tipoMaquina?: TipoMaquina;
  cantidad?: string;
  precioUnitario?: string;
};

export async function crearPedido(datos: {
  clienteId: number;
  usuarioId: number;
  estado?: EstadoPedido;
  fechaEntrega?: string;
  fechaCreacion?: Date;
  items?: ItemPrueba[];
}) {
  const items = datos.items ?? [{}];
  return prisma.pedido.create({
    data: {
      clienteId: datos.clienteId,
      usuarioId: datos.usuarioId,
      estado: datos.estado,
      fechaCreacion: datos.fechaCreacion,
      fechaEntrega: datos.fechaEntrega ? new Date(`${datos.fechaEntrega}T00:00:00.000Z`) : undefined,
      items: {
        create: items.map((item) => ({
          descripcion: item.descripcion ?? "Pendón 1x2m",
          tipoMaquina: item.tipoMaquina ?? "PLOTTER_UV",
          cantidad: item.cantidad ?? "1",
          precioUnitario: item.precioUnitario ?? "10000",
        })),
      },
    },
  });
}

export const DESCRIPCION_QUE_FALLA = "__FALLA_PRUEBA__";

// Instala un trigger que hace fallar en Postgres el insert de cualquier ítem
// con DESCRIPCION_QUE_FALLA, ejecuta `fn` y siempre lo borra al final.
// Sirve para provocar un error de la base con datos que zod considera válidos.
// TRUNCATE no borra triggers: por eso el `finally` es obligatorio.
export async function conTriggerQueFalla<T>(fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION prueba_falla_item() RETURNS trigger AS $$
    BEGIN
      IF NEW.descripcion = '${DESCRIPCION_QUE_FALLA}' THEN
        RAISE EXCEPTION 'Falla provocada por la prueba de atomicidad';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER prueba_falla_item BEFORE INSERT ON detalle_pedido
    FOR EACH ROW EXECUTE FUNCTION prueba_falla_item()`);
  try {
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS prueba_falla_item ON detalle_pedido");
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS prueba_falla_item()");
  }
}
