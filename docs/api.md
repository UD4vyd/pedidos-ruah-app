# Contrato de la API — Pedidos RUAH

Referencia de los endpoints del backend: qué recibe cada uno, qué responde y qué reglas aplica.
Si el código y este documento no coinciden, uno de los dos está mal: se corrige en el mismo PR.

---

## Convenciones generales

- Todas las rutas empiezan con `/api`, salvo `/health`.
- Los cuerpos de petición y respuesta son JSON.
- Los montos de dinero viajan como **string** (`"45000.00"`), no como número, para no perder precisión (vienen de columnas `Decimal`).
- Los montos de entrada (dinero y cantidades) aceptan máximo 2 decimales, sin separador de miles, y como máximo `99999999.99`. Si no cumplen, responden `400`.
- Los ids (en la URL o en el body, como `clienteId`) son enteros positivos hasta `2147483647`. Fuera de ese rango responden `400`.
- Las fechas viajan en formato ISO 8601 (`"2026-10-01T15:30:00.000Z"`). Las fechas sin hora, como `fechaEntrega`, como `"2026-10-05"`.
- Todas las rutas, excepto `/health`, `POST /api/auth/login` y `POST /api/auth/logout`, requieren sesión iniciada. Sin sesión responden `401`.

### Códigos de estado usados

| Código | Significado |
|---|---|
| 200 | OK, con datos en la respuesta |
| 201 | Recurso creado |
| 204 | OK, sin contenido (por ejemplo, después de borrar) |
| 400 | Datos inválidos (falta un campo, tipo incorrecto) |
| 401 | No hay sesión iniciada o expiró |
| 404 | El recurso o la ruta no existe |
| 409 | Conflicto con el estado actual (ej. borrar un cliente con pedidos) |
| 500 | Error interno del servidor |

### Formato de error (siempre el mismo)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "El campo telefonoWhatsapp es obligatorio"
  }
}
```

### Rutas que no existen

Una ruta desconocida responde **404** con `code: "RUTA_NO_ENCONTRADA"`, en el mismo formato de error.
Es distinto de `NO_ENCONTRADO`, que significa que la ruta existe pero el recurso pedido (un cliente, un pedido) no.
Dentro de un recurso protegido (por ejemplo `/api/clientes/x/y`), sin sesión responde primero **401**.

---

## Salud

### `GET /health`
Verifica que el servidor y la base de datos responden. No requiere sesión.

**200**
```json
{ "status": "ok", "database": "connected" }
```

---

## Autenticación

No existe endpoint de registro público. Los usuarios se crean con un script del servidor (seed), no desde la web.

### Cómo funcionan las sesiones

Las sesiones se guardan en la base de datos (tabla `sesiones`), no en JWT, para que el servidor pueda cerrarlas cuando quiera.

- **Login:** el servidor genera un token aleatorio, lo envía al navegador en una cookie `httpOnly` y guarda en la tabla **el hash** del token (nunca el token en texto plano).
- **Cada petición:** el servidor toma el token de la cookie, calcula su hash, busca la sesión y verifica que no haya expirado. Si no existe o expiró → `401`.
- **Duración:** 12 horas desde el login. Después hay que iniciar sesión de nuevo, aunque el navegador siga abierto.
- **Limpieza:** en cada login se borran todas las sesiones expiradas, para que la tabla no crezca sin control.
- **Cookie:** `httpOnly` (JavaScript no puede leerla), `secure` en producción (solo viaja por HTTPS) y `sameSite=lax` (no se envía en peticiones originadas desde otros sitios).

### `POST /api/auth/login`
**Body**
```json
{ "email": "recepcion@ruah.com", "password": "..." }
```
**200** — crea la sesión y establece la cookie
```json
{ "usuario": { "id": 1, "nombre": "Laura", "email": "recepcion@ruah.com" } }
```
**401** — credenciales incorrectas. El mensaje es genérico ("Correo o contraseña incorrectos") para no revelar si el correo existe.

### `POST /api/auth/logout`
Borra la sesión actual de la base de datos y la cookie del navegador. **204**

No requiere sesión: si no hay sesión (o ya expiró), igual responde **204**. Así cerrar sesión dos veces no es un error.

### `GET /api/auth/me`
Devuelve el usuario de la sesión actual. El frontend lo usa al cargar para saber si ya hay sesión.
**200**
```json
{ "usuario": { "id": 1, "nombre": "Laura", "email": "recepcion@ruah.com" } }
```

### `GET /api/auth/sesiones`
Lista las sesiones activas del usuario actual, para ver desde qué equipos está conectado.
**200**
```json
[
  { "id": "a1b2c3", "dispositivo": "Chrome en Linux", "creadaEn": "2026-10-01T13:00:00.000Z", "expiraEn": "2026-10-02T01:00:00.000Z", "actual": true }
]
```
`id` es un identificador corto para referirse a la sesión; nunca se expone el token ni su hash completo.

### `DELETE /api/auth/sesiones/:id`
Cierra una sesión específica (por ejemplo, la de un equipo que ya no se usa). **204**

### `DELETE /api/auth/sesiones`
Cierra todas las sesiones del usuario **excepto la actual** (por ejemplo, si alguien perdió el celular). **204**

---

## Clientes

### `GET /api/clientes?buscar=texto`
Lista clientes. `buscar` es opcional y filtra por nombre o teléfono. Se usa en el formulario de pedido para encontrar un cliente existente antes de crear uno nuevo.

**200**
```json
[
  { "id": 3, "nombre": "Panadería El Trigal", "telefonoWhatsapp": "3001234567" }
]
```

### `POST /api/clientes`
**Body**
```json
{ "nombre": "Panadería El Trigal", "telefonoWhatsapp": "3001234567" }
```
**201** — cliente creado
**409** `CLIENTE_DUPLICADO` — ya existe un cliente con ese teléfono.

### `PATCH /api/clientes/:id`
Actualiza nombre o teléfono. Solo se envían los campos que cambian. **200**
**404** si el cliente no existe. **409** `CLIENTE_DUPLICADO` si el teléfono nuevo ya lo tiene **otro** cliente (reenviar el teléfono propio no es un error).

### `DELETE /api/clientes/:id`
**204** si no tiene pedidos. **409** si tiene pedidos asociados: no se borra, para no perder historial financiero.

---

## Pedidos

### `GET /api/pedidos`
Pedidos **activos** para el Kanban: todos los que no están en `ENTREGADO` ni `CANCELADO`, ordenados por `fechaEntrega` (los más urgentes primero).

**200**
```json
[
  {
    "id": 12,
    "estado": "PRODUCCION",
    "fechaCreacion": "2026-10-01T15:30:00.000Z",
    "fechaEntrega": "2026-10-05",
    "fechaEntregado": null,
    "cliente": { "id": 3, "nombre": "Panadería El Trigal", "telefonoWhatsapp": "3001234567" },
    "usuario": { "id": 1, "nombre": "Laura" },
    "items": [
      { "id": 30, "descripcion": "Pendón 1x2m", "tipoMaquina": "PLOTTER_UV", "cantidad": "1.00", "precioUnitario": "85000.00" }
    ],
    "pagos": [
      { "id": 7, "monto": "40000.00", "metodo": "TRANSFERENCIA", "fecha": "2026-10-01T15:45:00.000Z" }
    ],
    "total": "85000.00",
    "pagado": "40000.00",
    "saldo": "45000.00"
  }
]
```
`total`, `pagado` y `saldo` **no están guardados** en la base: el backend los calcula sumando `items` y `pagos` en cada consulta.

Forma de un pedido (la misma en la lista, el historial, el detalle y las respuestas de creación y edición):
- `fechaEntregado`: fecha y hora en que pasó a `ENTREGADO` (ISO 8601), o `null` si no está entregado.
- `pagos`: los pagos vigentes del pedido, del más antiguo al más reciente. Los pagos borrados no aparecen ni cuentan en `pagado` ni en `saldo`.

### `GET /api/pedidos/historial?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&buscar=texto`
Pedidos en estado `ENTREGADO`, filtrados por `fechaEntregado`.
- Sin `desde`/`hasta`: últimos 7 días.
- `buscar`: filtra por nombre de cliente.

Misma forma de respuesta que `GET /api/pedidos`.

### `GET /api/pedidos/:id`
Detalle de un pedido, con la misma forma que cada elemento de `GET /api/pedidos`. **200** o **404**.

### `POST /api/pedidos`
Crea un pedido con sus ítems en una sola operación (transacción: o se crea todo o nada). El `usuarioId` lo toma el backend de la sesión, no del body. El estado inicial siempre es `DISENO`.

**Body**
```json
{
  "clienteId": 3,
  "fechaEntrega": "2026-10-05",
  "items": [
    { "descripcion": "Pendón 1x2m", "tipoMaquina": "PLOTTER_UV", "cantidad": "1", "precioUnitario": "85000" }
  ]
}
```
Debe tener al menos un ítem. **201** con el pedido creado (forma de `GET /api/pedidos/:id`).
Emite el evento de socket `pedido:creado`.

### `PATCH /api/pedidos/:id`
Edita datos del pedido (fecha de entrega, ítems). **No cambia el estado**: para eso existe el endpoint siguiente. **200**
Emite `pedido:actualizado`.

### `PATCH /api/pedidos/:id/estado`
Mueve el pedido de columna. Es lo que llama el drag & drop del Kanban.

**Body**
```json
{ "estado": "ENTREGA" }
```
Reglas:
- Al pasar a `ENTREGADO`, el backend guarda `fechaEntregado` con la fecha actual.
- Si sale de `ENTREGADO` (corrección de un error), `fechaEntregado` vuelve a `null`.

**200** con el pedido actualizado. Emite `pedido:estado`.

> Va separado de `PATCH /api/pedidos/:id` porque cambiar el estado tiene efectos propios (la fecha de entregado, el evento en tiempo real) y es la operación más frecuente del sistema.

---

## Pagos

Los pagos son un **libro de movimientos**: no se editan. Si se registró mal, se borra y se registra de nuevo.

**Borrado lógico:** borrar un pago no elimina la fila. Se marca con `borradoEn`, `borradoPorId` y `motivoBorrado`, y deja de contar en todos los cálculos (`pagado`, `saldo`, `ingresos`). Queda el rastro de qué se borró, quién y por qué.

### `POST /api/pedidos/:id/pagos`
**Body**
```json
{ "monto": "40000", "metodo": "TRANSFERENCIA" }
```
`monto` debe ser mayor que 0. **201** con el pago creado.
Emite `pedido:actualizado`, porque cambian `pagado` y `saldo` en la tarjeta.

### `DELETE /api/pagos/:id`
Corrección de un pago registrado por error (borrado lógico).

**Body**
```json
{ "motivo": "Se registró dos veces" }
```
`motivo` es obligatorio. **204**. Emite `pedido:actualizado`.
Un pago ya borrado responde **404**.

### `GET /api/pedidos/:id/pagos/borrados`
Pagos borrados de un pedido, con quién y por qué. Para revisar correcciones. **200**

---

## Gastos

### `GET /api/gastos?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&categoria=texto`
Lista gastos del periodo. Sin fechas: mes actual.
**200**
```json
{
  "gastos": [
    { "id": 5, "categoria": "materia prima", "descripcion": "Rollo vinilo blanco", "monto": "320000.00", "fecha": "2026-10-01T10:00:00.000Z", "usuario": { "id": 2, "nombre": "Carlos" } }
  ],
  "total": "320000.00"
}
```

### `POST /api/gastos`
**Body**
```json
{ "categoria": "materia prima", "descripcion": "Rollo vinilo blanco", "monto": "320000", "fecha": "2026-10-01" }
```
`fecha` es opcional (por defecto, hoy). **201**

### `DELETE /api/gastos/:id`
Corrección de un gasto registrado por error. Mismo borrado lógico que los pagos.

**Body**
```json
{ "motivo": "Monto equivocado" }
```
`motivo` es obligatorio. **204**

### `GET /api/gastos/borrados?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`
Gastos borrados en el periodo, con quién y por qué. **200**

---

## Inventario

`stockActual` **nunca se edita directamente**: solo cambia al registrar un movimiento.

### `GET /api/materiales`
**200**
```json
[
  { "id": 1, "nombre": "Vinilo blanco", "unidad": "metros", "stockActual": "180.00", "stockMinimo": "50.00", "bajoMinimo": false }
]
```
`bajoMinimo` lo calcula el backend (`stockActual <= stockMinimo`).

### `POST /api/materiales`
**Body**
```json
{ "nombre": "Vinilo blanco", "unidad": "metros", "stockMinimo": "50" }
```
El stock inicial es 0; se carga con un movimiento de entrada. **201**

### `PATCH /api/materiales/:id`
Edita nombre, unidad o stock mínimo. **No acepta `stockActual`.** **200**

### `GET /api/materiales/:id/movimientos`
Historial de entradas y salidas del material, del más reciente al más antiguo. **200**

### `POST /api/materiales/:id/movimientos`
**Body**
```json
{ "tipo": "ENTRADA", "cantidad": "100", "motivo": "Compra rollo nuevo" }
```
Reglas:
- Inserta el movimiento y actualiza `stockActual` **en la misma transacción**.
- Una `SALIDA` mayor que el stock disponible responde **409**.

**201** con el movimiento y el material actualizado.

---

## Balance

### `GET /api/balance?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`
Sin fechas: mes actual.
**200**
```json
{
  "desde": "2026-10-01",
  "hasta": "2026-10-31",
  "ingresos": "1250000.00",
  "gastos": "480000.00",
  "utilidad": "770000.00",
  "porCobrar": "310000.00"
}
```
- `ingresos`: suma de pagos con `fecha` en el rango.
- `gastos`: suma de gastos con `fecha` en el rango.
- `utilidad`: ingresos − gastos.
- `porCobrar`: saldo pendiente de todos los pedidos no cancelados (no depende del rango).

---

## Eventos en tiempo real (Socket.io)

El servidor emite; los navegadores conectados escuchan y actualizan el Kanban sin recargar.
Solo se aceptan conexiones de socket con sesión válida.

| Evento | Cuándo | Contenido |
|---|---|---|
| `pedido:creado` | `POST /api/pedidos` | El pedido completo |
| `pedido:actualizado` | Edición de pedido, pago registrado o borrado | El pedido completo |
| `pedido:estado` | `PATCH /api/pedidos/:id/estado` | `{ id, estado, estadoAnterior }` |

Los clientes **no** envían cambios por socket: todo cambio entra por la API REST, que valida, guarda y después emite. El socket es solo de notificación.
