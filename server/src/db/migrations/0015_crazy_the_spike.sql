ALTER TABLE "skills" ADD COLUMN "context_documents" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "context_documents" jsonb;