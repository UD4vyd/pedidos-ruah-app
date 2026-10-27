import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { PASSWORD_PRUEBA, crearUsuario, iniciarSesion } from "./helpers.js";

function cookieDeSesion(res: request.Response): string | undefined {
  const cookies = res.headers["set-cookie"] as unknown as string[] | undefined;
  return cookies?.find((cookie) => cookie.startsWith("sesion="));
}

function tokenDe(cookie: string): string {
  return cookie.split(";")[0]!.slice("sesion=".length);
}

const NO_AUTENTICADO = { error: { code: "NO_AUTENTICADO", message: "Debes iniciar sesión" } };

describe("POST /api/auth/login", () => {
  it("inicia sesión, devuelve el usuario sin datos sensibles y establece la cookie", async () => {
    const usuario = await crearUsuario({ nombre: "Laura", email: "recepcion@ruah.test" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "recepcion@ruah.test", password: PASSWORD_PRUEBA });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usuario: { id: usuario.id, nombre: "Laura", email: "recepcion@ruah.test" } });

    const cookie = cookieDeSesion(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    // En pruebas NODE_ENV=test: sin Secure, porque supertest usa HTTP sin TLS.
    expect(cookie).not.toMatch(/Secure/);
  });

  it("guarda en la base el hash SHA-256 del token, nunca el token", async () => {
    const usuario = await crearUsuario();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: usuario.email, password: PASSWORD_PRUEBA });

    const token = tokenDe(cookieDeSesion(res)!);
    const hash = createHash("sha256").update(token).digest("hex");

    expect(await prisma.sesion.findUnique({ where: { id: token } })).toBeNull();
    expect(await prisma.sesion.findUnique({ where: { id: hash } })).not.toBeNull();
  });

  it("acepta el correo con mayúsculas y espacios alrededor", async () => {
    await crearUsuario({ email: "recepcion@ruah.test" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "  RECEPCION@ruah.test ", password: PASSWORD_PRUEBA });

    expect(res.status).toBe(200);
  });

  it("responde lo mismo si el correo no existe o si la contraseña es incorrecta", async () => {
    const usuario = await crearUsuario();

    const correoInexistente = await request(app)
      .post("/api/auth/login")
      .send({ email: "nadie@ruah.test", password: PASSWORD_PRUEBA });
    const passwordIncorrecta = await request(app)
      .post("/api/auth/login")
      .send({ email: usuario.email, password: "otra-clave-cualquiera" });

    expect(correoInexistente.status).toBe(401);
    expect(passwordIncorrecta.status).toBe(401);
    expect(correoInexistente.body).toEqual({
      error: { code: "CREDENCIALES_INVALIDAS", message: "Correo o contraseña incorrectos" },
    });
    expect(passwordIncorrecta.body).toEqual(correoInexistente.body);
    expect(cookieDeSesion(passwordIncorrecta)).toBeUndefined();
  });

  it.each([
    ["sin cuerpo", {}],
    ["sin email", { password: PASSWORD_PRUEBA }],
    ["email mal formado", { email: "no-es-correo", password: PASSWORD_PRUEBA }],
    ["sin password", { email: "recepcion@ruah.test" }],
    ["password vacía", { email: "recepcion@ruah.test", password: "" }],
  ])("responde 400 con %s", async (_caso, body) => {
    const res = await request(app).post("/api/auth/login").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Correo y contraseña son obligatorios" },
    });
  });

  it("responde 400 JSON_INVALIDO si el cuerpo no es JSON válido", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "JSON_INVALIDO", message: "El cuerpo de la petición no es JSON válido" },
    });
  });

  it("borra las sesiones expiradas al iniciar sesión, sin tocar las vigentes", async () => {
    const usuario = await crearUsuario();
    await prisma.sesion.createMany({
      data: [
        { id: "a".repeat(64), usuarioId: usuario.id, expiraEn: new Date(Date.now() - 60_000) },
        { id: "b".repeat(64), usuarioId: usuario.id, expiraEn: new Date(Date.now() + 60_000) },
      ],
    });

    await iniciarSesion(usuario);

    expect(await prisma.sesion.findUnique({ where: { id: "a".repeat(64) } })).toBeNull();
    expect(await prisma.sesion.findUnique({ where: { id: "b".repeat(64) } })).not.toBeNull();
  });
});

describe("GET /api/auth/me", () => {
  it("devuelve el usuario de la sesión", async () => {
    const { agent, usuario } = await iniciarSesion();

    const res = await agent.get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usuario });
  });

  it("responde 401 sin cookie", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body).toEqual(NO_AUTENTICADO);
  });

  it("responde 401 con un token inventado", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", "sesion=token-inventado");

    expect(res.status).toBe(401);
    expect(res.body).toEqual(NO_AUTENTICADO);
  });

  it("responde 401 si la sesión expiró", async () => {
    const { agent } = await iniciarSesion();
    await prisma.sesion.updateMany({ data: { expiraEn: new Date(Date.now() - 1000) } });

    const res = await agent.get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body).toEqual(NO_AUTENTICADO);
  });
});

describe("POST /api/auth/logout", () => {
  it("borra la sesión, limpia la cookie y después /me responde 401", async () => {
    const { agent } = await iniciarSesion();
    expect(await prisma.sesion.count()).toBe(1);

    const res = await agent.post("/api/auth/logout");

    expect(res.status).toBe(204);
    expect(await prisma.sesion.count()).toBe(0);
    expect(cookieDeSesion(res)).toMatch(/^sesion=;.*Expires=Thu, 01 Jan 1970/);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("responde 204 aunque no haya sesión", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(204);
  });
});

describe("rutas protegidas", () => {
  it.each([
    ["get", "/api/auth/me"],
    ["get", "/api/clientes"],
    ["post", "/api/clientes"],
    ["patch", "/api/clientes/1"],
    ["delete", "/api/clientes/1"],
    ["get", "/api/pedidos"],
    ["post", "/api/pedidos"],
    ["get", "/api/pedidos/1"],
    ["patch", "/api/pedidos/1/estado"],
  ] as const)("%s %s responde 401 sin sesión", async (metodo, ruta) => {
    const res = await request(app)[metodo](ruta);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(NO_AUTENTICADO);
  });
});

describe("rutas desconocidas", () => {
  it("responden 404 en JSON", async () => {
    const res = await request(app).get("/api/no-existe");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: { code: "RUTA_NO_ENCONTRADA", message: "La ruta no existe" } });
  });

  it("dentro de un recurso protegido responden 401 sin sesión y 404 con sesión", async () => {
    const sinSesion = await request(app).get("/api/clientes/1/no-existe");
    expect(sinSesion.status).toBe(401);

    const { agent } = await iniciarSesion();
    const conSesion = await agent.get("/api/clientes/1/no-existe");
    expect(conSesion.status).toBe(404);
    expect(conSesion.body.error.code).toBe("RUTA_NO_ENCONTRADA");
  });
});

describe("sesiones (pendiente de implementar)", () => {
  it.todo("GET /api/auth/sesiones lista las sesiones activas del usuario y marca la actual");
  it.todo("DELETE /api/auth/sesiones/:id cierra una sesión específica");
  it.todo("DELETE /api/auth/sesiones cierra todas las sesiones excepto la actual");
});
