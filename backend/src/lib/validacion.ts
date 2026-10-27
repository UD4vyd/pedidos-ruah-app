import { z } from "zod";

// Máximo de una columna `Int` en PostgreSQL. Un id mayor haría fallar la consulta con un 500.
const MAX_INT_POSTGRES = 2147483647;

export const idSchema = z.coerce.number().int().positive().max(MAX_INT_POSTGRES);

// Columnas Decimal(10,2): hasta 8 dígitos enteros y 2 decimales (99999999.99).
// Se valida con la expresión regular, no con Number, para no tratar el dinero como number.
export const monto = z
  .coerce.string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Usa números con máximo 2 decimales y sin separador de miles")
  .regex(/^\d{1,8}(\.\d+)?$/, "El monto máximo es 99999999.99");

// Fecha sin hora (AAAA-MM-DD) que además debe existir en el calendario (rechaza 2026-02-30).
export const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD")
  .refine((valor) => {
    const date = new Date(`${valor}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valor;
  }, "La fecha no existe");
