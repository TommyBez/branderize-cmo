CREATE TYPE "connection_provider_slot" AS ENUM ('notion', 'typefully');
--> statement-breakpoint
CREATE TYPE "connection_status" AS ENUM ('active', 'inactive');
--> statement-breakpoint

CREATE TABLE "brand_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "provider_slot" "connection_provider_slot" NOT NULL,
  "connector_uid" text NOT NULL,
  "installation_id" text,
  "account_label" text NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" "connection_status" NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "brand_connections_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "brand_connections_brand_id_id_unique" UNIQUE ("brand_id", "id"),
  CONSTRAINT "brand_connections_account_label_nonempty"
    CHECK (length(btrim("account_label")) > 0),
  CONSTRAINT "brand_connections_connector_uid_nonempty"
    CHECK (length(btrim("connector_uid")) > 0),
  CONSTRAINT "brand_connections_installation_id_nonempty"
    CHECK ("installation_id" IS NULL OR length(btrim("installation_id")) > 0),
  CONSTRAINT "brand_connections_scopes_array"
    CHECK (jsonb_typeof("scopes") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "brand_connections_active_slot_unique"
  ON "brand_connections" ("brand_id", "provider_slot")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "brand_connections_brand_status_idx"
  ON "brand_connections" ("brand_id", "status", "provider_slot");
