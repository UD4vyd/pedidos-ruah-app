// Días de Colombia (America/Bogota) para filtros por fecha.
//
// Las fechas con hora se guardan en UTC, pero los usuarios piensan en días de
// Colombia. Colombia usa UTC−5 todo el año (sin horario de verano desde 1993),
// así que el día D en Colombia es exactamente [D 05:00 UTC, D+1 05:00 UTC).
// Si Colombia volviera a cambiar la hora en el año, este offset fijo dejaría de ser correcto.
const OFFSET_COLOMBIA = "-05:00";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Instante en que empieza el día `fecha` (AAAA-MM-DD) en Colombia. */
export function inicioDelDiaEnColombia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000${OFFSET_COLOMBIA}`);
}

/** Fecha de hoy (AAAA-MM-DD) en Colombia. Entre las 7 p. m. y la medianoche, en UTC ya es mañana. */
export function hoyEnColombia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

/** Suma (o resta, con `dias` negativo) días de calendario a una fecha AAAA-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const date = new Date(`${fecha}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}

/** Cantidad de días de `desde` a `hasta`, contando los dos extremos. */
export function diasIncluidos(desde: string, hasta: string): number {
  const diferencia = Date.parse(`${hasta}T00:00:00.000Z`) - Date.parse(`${desde}T00:00:00.000Z`);
  return diferencia / MS_POR_DIA + 1;
}
