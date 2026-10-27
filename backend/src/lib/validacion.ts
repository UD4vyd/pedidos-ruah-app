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
