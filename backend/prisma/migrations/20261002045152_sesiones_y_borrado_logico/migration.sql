-- AlterTable
ALTER TABLE "gastos" ADD COLUMN     "borrado_en" TIMESTAMP(3),
ADD COLUMN     "borrado_por_id" INTEGER,
ADD COLUMN     "motivo_borrado" VARCHAR(255);

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "borrado_en" TIMESTAMP(3),
ADD COLUMN     "borrado_por_id" INTEGER,
ADD COLUMN     "motivo_borrado" VARCHAR(255);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" VARCHAR(64) NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "dispositivo" VARCHAR(255),

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_idx" ON "sesiones"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_expira_en_idx" ON "sesiones"("expira_en");

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_borrado_por_id_fkey" FOREIGN KEY ("borrado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_borrado_por_id_fkey" FOREIGN KEY ("borrado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
