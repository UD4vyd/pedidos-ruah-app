import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export const incluirPedido = {
  cliente: { select: { id: true, nombre: true, telefonoWhatsapp: true } },
  usuario: { select: { id: true, nombre: true } },
  items: { orderBy: { id: "asc" } },
  pagos: { where: { borradoEn: null }, orderBy: { fecha: "asc" } },
} satisfies Prisma.PedidoInclude;

type PedidoConRelaciones = Prisma.PedidoGetPayload<{ include: typeof incluirPedido }>;

type ValorDecimal = string | Prisma.Decimal;

// Total de un pedido: suma de cantidad × precioUnitario. Acepta ítems guardados
// (Decimal) o recién validados (string), para calcular el total antes de guardar.
export function sumarItems(items: { cantidad: ValorDecimal; precioUnitario: ValorDecimal }[]) {
  return items.reduce(
    (suma, item) => suma.add(new Prisma.Decimal(item.cantidad).mul(item.precioUnitario)),
    new Prisma.Decimal(0),
  );
}

export function formatearPedido(pedido: PedidoConRelaciones) {
  const total = sumarItems(pedido.items);
  const pagado = pedido.pagos.reduce((suma, pago) => suma.add(pago.monto), new Prisma.Decimal(0));

  return {
    id: pedido.id,
    estado: pedido.estado,
    fechaCreacion: pedido.fechaCreacion,
    fechaEntrega: pedido.fechaEntrega ? pedido.fechaEntrega.toISOString().slice(0, 10) : null,
    fechaEntregado: pedido.fechaEntregado,
    cliente: pedido.cliente,
    usuario: pedido.usuario,
    items: pedido.items.map((item) => ({
      id: item.id,
      descripcion: item.descripcion,
      tipoMaquina: item.tipoMaquina,
      cantidad: item.cantidad.toFixed(2),
      precioUnitario: item.precioUnitario.toFixed(2),
    })),
    pagos: pedido.pagos.map((pago) => ({
      id: pago.id,
      monto: pago.monto.toFixed(2),
      metodo: pago.metodo,
      fecha: pago.fecha,
    })),
    total: total.toFixed(2),
    pagado: pagado.toFixed(2),
    saldo: total.sub(pagado).toFixed(2),
  };
}

export async function obtenerPedido(id: number) {
  const pedido = await prisma.pedido.findUnique({ where: { id }, include: incluirPedido });
  return pedido ? formatearPedido(pedido) : null;
}
