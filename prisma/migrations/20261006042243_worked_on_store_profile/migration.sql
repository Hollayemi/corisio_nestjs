/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `Product` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "coverPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "openingHours" JSONB,
ADD COLUMN     "socialLinks" JSONB,
ADD COLUMN     "tagline" VARCHAR(80),
ADD COLUMN     "whatsapp" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
