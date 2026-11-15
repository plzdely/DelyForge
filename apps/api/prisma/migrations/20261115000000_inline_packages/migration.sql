-- Marketplace packages are stored inline (declarative JSON), so a hosted file URL is optional.
ALTER TABLE "ListingVersion" ADD COLUMN "content" JSONB;
ALTER TABLE "ListingVersion" ALTER COLUMN "packageUrl" DROP NOT NULL;
