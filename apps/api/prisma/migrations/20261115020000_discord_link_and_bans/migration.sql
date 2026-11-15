-- CreateEnum
CREATE TYPE "BanKind" AS ENUM ('EMAIL', 'DISCORD');

-- AlterEnum
ALTER TYPE "EmailTokenPurpose" ADD VALUE 'DISCORD_LINK';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "discordAvatarUrl" TEXT,
ADD COLUMN     "discordId" TEXT,
ADD COLUMN     "discordLinkedAt" TIMESTAMP(3),
ADD COLUMN     "discordUsername" TEXT;

-- CreateTable
CREATE TABLE "Ban" (
    "id" TEXT NOT NULL,
    "kind" "BanKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "bannedById" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ban_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ban_kind_value_key" ON "Ban"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

