/*
  Warnings:

  - You are about to drop the column `embedding` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "embedding";

-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "embedding" vector(64);
