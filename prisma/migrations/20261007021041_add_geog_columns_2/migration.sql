/*
  Warnings:

  - You are about to drop the column `geog` on the `StoreAddress` table. All the data in the column will be lost.
  - You are about to drop the column `geog` on the `StoreLocation` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "StoreAddress_geog_idx";

-- DropIndex
DROP INDEX "StoreLocation_geog_idx";

-- AlterTable
ALTER TABLE "StoreAddress" DROP COLUMN "geog";

-- AlterTable
ALTER TABLE "StoreLocation" DROP COLUMN "geog";
