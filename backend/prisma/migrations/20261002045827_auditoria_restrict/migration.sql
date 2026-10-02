-- DropForeignKey
ALTER TABLE "gastos" DROP CONSTRAINT "gastos_borrado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "pagos" DROP CONSTRAINT "pagos_borrado_por_id_fkey";

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_borrado_por_id_fkey" FOREIGN KEY ("borrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_borrado_por_id_fkey" FOREIGN KEY ("borrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
