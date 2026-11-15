-- Each signed-in device can have a team workspace active.
ALTER TABLE "Session" ADD COLUMN "workspaceId" TEXT;
