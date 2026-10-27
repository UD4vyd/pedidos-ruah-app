# Pedidos RUAH

Sistema web de gestión de pedidos para un local familiar de publicidad (plotter UV, laminadora, cama láser, sublimadora, estampado). Tablero Kanban de pedidos (Diseño → Producción → Entrega → Entregado), pagos, gastos, inventario de materia prima y balance.

El dueño del repositorio es estudiante de Ingeniería de Sistemas y usa este proyecto para aprender. **Explica el porqué de cada decisión**, no solo qué cambiaste. Si una petición choca con una convención de este archivo, dilo antes de hacer el cambio.

## Fuente de verdad

- `docs/api.md` es el contrato de la API. Si cambias un endpoint, actualiza el contrato en el mismo cambio. Si el código y el contrato no coinciden, pregunta cuál está mal antes de corregir.
- `backend/prisma/schema.prisma` define el modelo de datos.

## Stack

- Node según `.nvmrc` (usa `nvm use`).
- Express 5 + TypeScript, ES Modules (`"type": "module"`, `module: NodeNext`).
  - Los imports de archivos propios llevan extensión `.js` aunque el archivo sea `.ts`.
- Prisma **7** con PostgreSQL y el adaptador `@prisma/adapter-pg`.
  - **No actualizar a Prisma 8** (está en release candidate). Ignorar el aviso de actualización del CLI.
  - La configuración está en `backend/prisma7.config.ts`.
  - El cliente se genera en `backend/src/generated/prisma/` (no se sube a git).
- `zod` 4 para validar entradas, `argon2` para contraseñas, `cookie-parser` para la sesión.

## Comandos (desde `backend/`)

Usa siempre los scripts de npm. **No uses `npx prisma ...`**: puede descargar otra versión de Prisma.

| Comando | Para qué |
|---|---|
| `npm run dev` | Servidor en desarrollo con recarga (`tsx watch`) |
| `npx tsc --noEmit` | Revisar tipos. Debe quedar limpio antes de terminar cualquier cambio |
| `npm run db:migrate -- --name <nombre>` | Crear y aplicar una migración |
| `npm run db:generate` | Regenerar el cliente de Prisma |
| `npm run db:status` | Estado de las migraciones |
| `npm run db:seed` | Crear los usuarios de desarrollo (idempotente) |

## Estructura de `backend/src/`

- `index.ts`: arma la app. Orden: middlewares globales → rutas → 404 JSON → manejador de errores.
- `routes/`: un router por recurso. Validación y respuesta HTTP.
- `services/`: lógica reutilizable (sesiones, contraseñas, formato de pedidos).
- `middleware/requireAuth.ts`: valida la sesión y deja `req.usuario`.
- `lib/`: cliente de Prisma (instancia única) y `enviarError`.
- `types/express.d.ts`: extensión del tipo `Request`.
- `scripts/seed.ts`: usuarios de desarrollo.

## Convenciones

### API
- Errores siempre con `enviarError(res, status, code, message)` → `{ "error": { "code", "message" } }`. Mensajes en español, pensados para mostrarse al usuario.
- Validar todo lo que llega (`body`, `params`, `query`) con `zod` y `safeParse`. Responder `400` antes de tocar la base.
- Los routers se protegen al montarlos: `app.use("/api/x", requireAuth, xRouter)`.
- `usuarioId` se toma de `req.usuario`, nunca del body.
- Usar `select` para limitar los campos que salen. Nunca devolver `passwordHash` ni tokens.
- Verificar que los recursos relacionados existan antes de crear (para responder `400`/`404` claros en vez de un `500` por llave foránea).

### Dinero y fechas
- **El dinero nunca se maneja como `number`.** Columnas `Decimal`, operaciones con `.add()`, `.sub()`, `.mul()`, y salida como string con `.toFixed(2)`.
- Los montos de entrada se validan como string con máximo dos decimales y sin separador de miles.
- `total`, `pagado` y `saldo` se calculan en cada consulta; no se guardan como columnas.
- Fechas sin hora en formato `AAAA-MM-DD`.

### Borrado lógico
- Pagos y gastos no se borran: se marcan con `borradoEn`, `borradoPorId` y `motivoBorrado`.
- El filtro `borradoEn: null` debe estar centralizado (ver `incluirPedido` en `services/pedidos.ts`), no repetido en cada ruta.

### Sesiones
- Sesiones en la tabla `sesiones`, no JWT. En la base se guarda el hash SHA-256 del token, nunca el token.
- Cookie `httpOnly`, `sameSite: lax`, `secure` en producción.

### Base de datos
- **Nunca editar una migración ya aplicada.** Los cambios van en una migración nueva.
- Antes de terminar, mostrar el `migration.sql` generado y señalar cualquier `DROP` o cambio que pueda perder datos.

## Reglas de trabajo

- No leer, modificar ni mostrar el contenido de `.env`. Las variables necesarias están en `.env.example`.
- No hacer `git push`, merge ni borrar ramas sin pedirlo explícitamente.
- Una rama por tarea, creada desde `dev` (`feature/...`, `fix/...`, `chore/...`, `docs/...`).
- Commits en inglés, Conventional Commits y modo imperativo: `feat: add payments endpoints`.
- Antes de dar una tarea por terminada: `npx tsc --noEmit` limpio y, si existen, pruebas en verde.
