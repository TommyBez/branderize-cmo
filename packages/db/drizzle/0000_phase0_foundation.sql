CREATE TYPE "actor_type" AS ENUM ('human', 'agent', 'system');
--> statement-breakpoint
CREATE TYPE "intent_status" AS ENUM ('draft', 'active', 'settled', 'abandoned');
--> statement-breakpoint
CREATE TYPE "object_status" AS ENUM ('active', 'superseded');
--> statement-breakpoint
CREATE TYPE "execution_mode" AS ENUM ('agent', 'direct');
--> statement-breakpoint
CREATE TYPE "task_activation" AS ENUM ('automatic', 'human');
--> statement-breakpoint
CREATE TYPE "task_status" AS ENUM (
  'awaiting_approval',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
  'outcome_unknown',
  'expired',
  'needs_regeneration',
  'dismissed'
);
--> statement-breakpoint
CREATE TYPE "ledger_entry_type" AS ENUM ('grant', 'model_charge', 'action_charge');
--> statement-breakpoint
CREATE TYPE "schedule_cadence" AS ENUM ('daily', 'weekly');
--> statement-breakpoint
CREATE TYPE "brand_onboarding_status" AS ENUM ('incomplete', 'importing', 'ready');
--> statement-breakpoint

CREATE TABLE "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "user_email_nonempty" CHECK (length(btrim("email")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" ("email");
--> statement-breakpoint

CREATE TABLE "organization" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo" text,
  "metadata" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "organization_name_nonempty" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_unique" ON "organization" ("slug");
--> statement-breakpoint

CREATE TABLE "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "token" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL,
  "active_organization_id" text,
  CONSTRAINT "session_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  CONSTRAINT "session_active_organization_id_organization_id_fk"
    FOREIGN KEY ("active_organization_id") REFERENCES "organization" ("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" ("token");
--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");
--> statement-breakpoint
CREATE INDEX "session_active_organization_id_idx" ON "session" ("active_organization_id");
--> statement-breakpoint

CREATE TABLE "account" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope" text,
  "password" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "account_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique"
  ON "account" ("provider_id", "account_id");
--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");
--> statement-breakpoint

CREATE TABLE "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
--> statement-breakpoint

CREATE TABLE "member" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "member_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE,
  CONSTRAINT "member_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  CONSTRAINT "member_role_valid" CHECK ("role" IN ('owner', 'admin', 'member', 'viewer')),
  CONSTRAINT "member_organization_user_unique" UNIQUE ("organization_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" ("user_id");
--> statement-breakpoint

CREATE TABLE "invitation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "email" text NOT NULL,
  "role" text,
  "status" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "inviter_id" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "invitation_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE,
  CONSTRAINT "invitation_inviter_id_user_id_fk"
    FOREIGN KEY ("inviter_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  CONSTRAINT "invitation_role_valid"
    CHECK ("role" IS NULL OR "role" IN ('owner', 'admin', 'member', 'viewer')),
  CONSTRAINT "invitation_status_valid"
    CHECK ("status" IN ('pending', 'accepted', 'rejected', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX "invitation_organization_status_idx"
  ON "invitation" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");
--> statement-breakpoint

CREATE TABLE "brands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "website_url" text NOT NULL,
  "onboarding_status" "brand_onboarding_status" DEFAULT 'incomplete' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "brands_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE,
  CONSTRAINT "brands_organization_slug_unique" UNIQUE ("organization_id", "slug"),
  CONSTRAINT "brands_name_nonempty" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "brands_website_url_nonempty" CHECK (length(btrim("website_url")) > 0)
);
--> statement-breakpoint
CREATE INDEX "brands_organization_id_idx" ON "brands" ("organization_id");
--> statement-breakpoint

CREATE TABLE "actors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" "actor_type" NOT NULL,
  "actor_key" text NOT NULL,
  "user_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "actors_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "actors_actor_key_unique" UNIQUE ("actor_key"),
  CONSTRAINT "actors_user_id_unique" UNIQUE ("user_id"),
  CONSTRAINT "actors_human_user_consistency"
    CHECK (("type" = 'human') = ("user_id" IS NOT NULL)),
  CONSTRAINT "actors_human_key_consistency"
    CHECK ("type" <> 'human' OR "actor_key" = 'human:' || "user_id"),
  CONSTRAINT "actors_key_nonempty" CHECK (length(btrim("actor_key")) > 0)
);
--> statement-breakpoint

CREATE TABLE "intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "author_actor_id" uuid NOT NULL,
  "parent_intent_id" uuid,
  "statement" text NOT NULL,
  "acceptance_criteria" jsonb,
  "constraints" jsonb,
  "status" "intent_status" NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "intents_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "intents_author_actor_id_actors_id_fk"
    FOREIGN KEY ("author_actor_id") REFERENCES "actors" ("id") ON DELETE RESTRICT,
  CONSTRAINT "intents_brand_id_id_unique" UNIQUE ("brand_id", "id"),
  CONSTRAINT "intents_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "intents_statement_nonempty" CHECK (length(btrim("statement")) > 0),
  CONSTRAINT "intents_acceptance_criteria_nonempty_array"
    CHECK (
      "acceptance_criteria" IS NULL OR
      (jsonb_typeof("acceptance_criteria") = 'array' AND jsonb_array_length("acceptance_criteria") > 0)
    ),
  CONSTRAINT "intents_constraints_nonempty_array"
    CHECK (
      "constraints" IS NULL OR
      (jsonb_typeof("constraints") = 'array' AND jsonb_array_length("constraints") > 0)
    ),
  CONSTRAINT "intents_constraints_require_criteria"
    CHECK ("constraints" IS NULL OR "acceptance_criteria" IS NOT NULL),
  CONSTRAINT "intents_parent_not_self"
    CHECK ("parent_intent_id" IS NULL OR "parent_intent_id" <> "id")
);
--> statement-breakpoint
ALTER TABLE "intents"
  ADD CONSTRAINT "intents_parent_same_brand_fk"
  FOREIGN KEY ("brand_id", "parent_intent_id")
  REFERENCES "intents" ("brand_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE INDEX "intents_brand_status_created_idx"
  ON "intents" ("brand_id", "status", "created_at");
--> statement-breakpoint

CREATE TABLE "actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "type" text NOT NULL,
  "rationale" text NOT NULL,
  "effect_class" text NOT NULL,
  "payload" jsonb NOT NULL,
  "policy_snapshot" jsonb NOT NULL,
  "operation_key" text,
  "request_hash" text,
  "intent_id" uuid,
  "task_id" uuid,
  "decision_id" uuid,
  "schedule_id" uuid,
  "session_id" text,
  "call_id" text,
  "conversation_id" uuid,
  "turn_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "actions_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "actions_actor_id_actors_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "actors" ("id") ON DELETE RESTRICT,
  CONSTRAINT "actions_brand_id_id_unique" UNIQUE ("brand_id", "id"),
  CONSTRAINT "actions_intent_same_brand_fk"
    FOREIGN KEY ("brand_id", "intent_id") REFERENCES "intents" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "actions_operation_receipt_pair"
    CHECK (("operation_key" IS NULL) = ("request_hash" IS NULL)),
  CONSTRAINT "actions_conversation_turn_pair"
    CHECK (("conversation_id" IS NULL) = ("turn_id" IS NULL)),
  CONSTRAINT "actions_turn_requires_session"
    CHECK ("turn_id" IS NULL OR "session_id" IS NOT NULL),
  CONSTRAINT "actions_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "actions_policy_snapshot_object"
    CHECK (jsonb_typeof("policy_snapshot") = 'object'),
  CONSTRAINT "actions_effect_class_nonempty" CHECK (length(btrim("effect_class")) > 0),
  CONSTRAINT "actions_rationale_nonempty" CHECK (length(btrim("rationale")) > 0),
  CONSTRAINT "actions_type_nonempty" CHECK (length(btrim("type")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "actions_brand_operation_key_unique"
  ON "actions" ("brand_id", "operation_key")
  WHERE "operation_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "actions_task_questions_resolved_unique"
  ON "actions" ("task_id")
  WHERE "type" = 'task_questions_resolved';
--> statement-breakpoint
CREATE INDEX "actions_brand_created_idx" ON "actions" ("brand_id", "created_at");
--> statement-breakpoint
CREATE INDEX "actions_brand_conversation_created_idx"
  ON "actions" ("brand_id", "conversation_id", "created_at", "id")
  WHERE "conversation_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "actions_brand_conversation_session_turn_idx"
  ON "actions" ("brand_id", "conversation_id", "session_id", "turn_id", "created_at", "id")
  WHERE "turn_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "actions_intent_id_idx" ON "actions" ("intent_id");
--> statement-breakpoint
CREATE INDEX "actions_task_id_idx" ON "actions" ("task_id");
--> statement-breakpoint

CREATE TABLE "objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "type" text NOT NULL,
  "status" "object_status" DEFAULT 'active' NOT NULL,
  "singleton_key" text,
  "content" jsonb NOT NULL,
  "content_text" text NOT NULL,
  "search_vector" tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content_text", ''))) STORED NOT NULL,
  "blob_key" text,
  "blob_sha256" text,
  "blob_content_type" text,
  "blob_byte_size" bigint,
  "produced_by" uuid NOT NULL,
  "superseded_by" uuid,
  "superseded_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "objects_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "objects_brand_id_id_unique" UNIQUE ("brand_id", "id"),
  CONSTRAINT "objects_produced_by_same_brand_fk"
    FOREIGN KEY ("brand_id", "produced_by") REFERENCES "actions" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "objects_content_object" CHECK (jsonb_typeof("content") = 'object'),
  CONSTRAINT "objects_type_nonempty" CHECK (length(btrim("type")) > 0),
  CONSTRAINT "objects_supersession_consistency"
    CHECK (
      ("status" = 'active' AND "superseded_by" IS NULL AND "superseded_at" IS NULL) OR
      ("status" = 'superseded' AND "superseded_by" IS NOT NULL AND "superseded_at" IS NOT NULL)
    ),
  CONSTRAINT "objects_not_self_superseded"
    CHECK ("superseded_by" IS NULL OR "superseded_by" <> "id"),
  CONSTRAINT "objects_artifact_blob_consistency"
    CHECK (
      (
        "type" = 'artifact' AND
        "blob_key" IS NOT NULL AND
        "blob_sha256" IS NOT NULL AND
        "blob_content_type" IS NOT NULL AND
        "blob_byte_size" IS NOT NULL AND
        "blob_byte_size" > 0 AND
        "blob_sha256" ~ '^[0-9a-f]{64}$' AND
        position("brand_id"::text IN "blob_key") > 0 AND
        position("blob_sha256" IN "blob_key") > 0
      ) OR
      (
        "type" <> 'artifact' AND
        "blob_key" IS NULL AND
        "blob_sha256" IS NULL AND
        "blob_content_type" IS NULL AND
        "blob_byte_size" IS NULL
      )
    )
);
--> statement-breakpoint
ALTER TABLE "objects"
  ADD CONSTRAINT "objects_superseded_by_same_brand_fk"
  FOREIGN KEY ("brand_id", "superseded_by")
  REFERENCES "objects" ("brand_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE UNIQUE INDEX "objects_singleton_active_unique"
  ON "objects" ("brand_id", "singleton_key")
  WHERE "status" = 'active' AND "singleton_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "objects_blob_key_unique"
  ON "objects" ("blob_key")
  WHERE "blob_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "objects_brand_type_status_idx"
  ON "objects" ("brand_id", "type", "status");
--> statement-breakpoint
CREATE INDEX "objects_search_vector_idx" ON "objects" USING gin ("search_vector");
--> statement-breakpoint

CREATE TABLE "cmo_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "owner_user_id" text NOT NULL,
  "session_id" text,
  "stream_index" bigint DEFAULT 0 NOT NULL,
  "title" text,
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "cmo_conversations_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "cmo_conversations_owner_user_id_user_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "user" ("id") ON DELETE RESTRICT,
  CONSTRAINT "cmo_conversations_brand_id_id_unique" UNIQUE ("brand_id", "id"),
  CONSTRAINT "cmo_conversations_brand_id_id_session_id_unique"
    UNIQUE ("brand_id", "id", "session_id"),
  CONSTRAINT "cmo_conversations_stream_index_nonnegative" CHECK ("stream_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cmo_conversations_session_id_unique"
  ON "cmo_conversations" ("session_id")
  WHERE "session_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "cmo_conversations_owner_brand_created_idx"
  ON "cmo_conversations" ("owner_user_id", "brand_id", "created_at");
--> statement-breakpoint
ALTER TABLE "actions"
  ADD CONSTRAINT "actions_conversation_same_brand_session_fk"
  FOREIGN KEY ("brand_id", "conversation_id", "session_id")
  REFERENCES "cmo_conversations" ("brand_id", "id", "session_id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

CREATE TABLE "schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "schedule_key" text NOT NULL,
  "worker_key" text NOT NULL,
  "kind" text NOT NULL,
  "fixed_payload" jsonb NOT NULL,
  "payload_digest" text NOT NULL,
  "cadence" "schedule_cadence",
  "local_time" time,
  "local_weekday" smallint,
  "time_zone" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "next_scheduled_for" timestamptz,
  "coalesced_due_count" bigint DEFAULT 0 NOT NULL,
  "last_coalesced_for" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "schedules_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "schedules_brand_id_id_unique" UNIQUE ("brand_id", "id"),
  CONSTRAINT "schedules_brand_key_unique" UNIQUE ("brand_id", "schedule_key"),
  CONSTRAINT "schedules_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "schedules_coalesced_due_count_nonnegative" CHECK ("coalesced_due_count" >= 0),
  CONSTRAINT "schedules_coalescing_consistency"
    CHECK (("coalesced_due_count" = 0) = ("last_coalesced_for" IS NULL)),
  CONSTRAINT "schedules_fixed_payload_object" CHECK (jsonb_typeof("fixed_payload") = 'object'),
  CONSTRAINT "schedules_calendar_shape"
    CHECK (
      ("cadence" IS NULL AND "local_time" IS NULL AND "local_weekday" IS NULL) OR
      ("cadence" = 'daily' AND "local_time" IS NOT NULL AND "local_weekday" IS NULL) OR
      ("cadence" = 'weekly' AND "local_time" IS NOT NULL AND "local_weekday" BETWEEN 0 AND 6)
    ),
  CONSTRAINT "schedules_enabled_configuration"
    CHECK (
      NOT "enabled" OR
      (
        "cadence" IS NOT NULL AND
        "local_time" IS NOT NULL AND
        "time_zone" IS NOT NULL AND
        length(btrim("time_zone")) > 0 AND
        "next_scheduled_for" IS NOT NULL
      )
    )
);
--> statement-breakpoint
CREATE INDEX "schedules_due_worker_idx"
  ON "schedules" ("worker_key", "next_scheduled_for");
--> statement-breakpoint

CREATE TABLE "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "worker_key" text NOT NULL,
  "subject_key" text NOT NULL,
  "execution_mode" "execution_mode" NOT NULL,
  "activation" "task_activation" NOT NULL,
  "status" "task_status" NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "idempotency_key" text,
  "creation_hash" text,
  "intent_id" uuid,
  "intent_snapshot" jsonb,
  "plan_object_id" uuid,
  "move_candidate_id" uuid,
  "parent_task_id" uuid,
  "retry_of_task_id" uuid,
  "supersedes_task_id" uuid,
  "schedule_id" uuid,
  "scheduled_for" timestamptz,
  "session_id" text,
  "completion" jsonb,
  "next_due_at" timestamptz,
  "next_payload" jsonb,
  "next_rationale" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "leased_until" timestamptz,
  "commitment_conflict_key" text,
  "execute_before" timestamptz,
  "approved_at" timestamptz,
  "approval_action_id" uuid,
  "result_action_id" uuid,
  "outcome_code" text,
  "due_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tasks_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "tasks_brand_id_id_unique" UNIQUE ("brand_id", "id"),
  CONSTRAINT "tasks_intent_same_brand_fk"
    FOREIGN KEY ("brand_id", "intent_id") REFERENCES "intents" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "tasks_plan_same_brand_fk"
    FOREIGN KEY ("brand_id", "plan_object_id") REFERENCES "objects" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "tasks_move_same_brand_fk"
    FOREIGN KEY ("brand_id", "move_candidate_id") REFERENCES "objects" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "tasks_schedule_same_brand_fk"
    FOREIGN KEY ("brand_id", "schedule_id") REFERENCES "schedules" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "tasks_approval_action_same_brand_fk"
    FOREIGN KEY ("brand_id", "approval_action_id") REFERENCES "actions" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "tasks_result_action_same_brand_fk"
    FOREIGN KEY ("brand_id", "result_action_id") REFERENCES "actions" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "tasks_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "tasks_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "tasks_creator_receipt_pair"
    CHECK (("idempotency_key" IS NULL) = ("creation_hash" IS NULL)),
  CONSTRAINT "tasks_mode_activation_valid"
    CHECK (
      ("execution_mode" = 'agent' AND "activation" = 'automatic') OR
      "execution_mode" = 'direct'
    ),
  CONSTRAINT "tasks_status_mode_valid"
    CHECK (
      (
        "execution_mode" = 'agent' AND
        "status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'superseded')
      ) OR
      (
        "execution_mode" = 'direct' AND
        "activation" = 'automatic' AND
        "status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
      ) OR
      (
        "execution_mode" = 'direct' AND
        "activation" = 'human' AND
        "status" IN (
          'awaiting_approval',
          'queued',
          'running',
          'succeeded',
          'failed',
          'cancelled',
          'outcome_unknown',
          'expired',
          'needs_regeneration',
          'dismissed',
          'superseded'
        )
      )
    ),
  CONSTRAINT "tasks_finished_at_status_consistency"
    CHECK (
      ("status" IN ('awaiting_approval', 'queued', 'running') AND "finished_at" IS NULL) OR
      ("status" NOT IN ('awaiting_approval', 'queued', 'running') AND "finished_at" IS NOT NULL)
    ),
  CONSTRAINT "tasks_started_at_status_consistency"
    CHECK (
      ("status" = 'running' AND "started_at" IS NOT NULL) OR
      ("status" IN ('awaiting_approval', 'queued') AND "started_at" IS NULL) OR
      "status" NOT IN ('awaiting_approval', 'queued', 'running')
    ),
  CONSTRAINT "tasks_agent_runtime_fields"
    CHECK ("execution_mode" <> 'agent' OR ("attempts" = 0 AND "leased_until" IS NULL)),
  CONSTRAINT "tasks_direct_runtime_fields"
    CHECK ("execution_mode" <> 'direct' OR ("session_id" IS NULL AND "completion" IS NULL)),
  CONSTRAINT "tasks_human_runtime_fields"
    CHECK (
      "activation" <> 'human' OR
      (
        "attempts" = 0 AND
        "leased_until" IS NULL AND
        "session_id" IS NULL AND
        "completion" IS NULL AND
        "next_due_at" IS NULL AND
        "next_payload" IS NULL AND
        "next_rationale" IS NULL
      )
    ),
  CONSTRAINT "tasks_terminal_without_lease"
    CHECK ("finished_at" IS NULL OR "leased_until" IS NULL),
  CONSTRAINT "tasks_completion_shape"
    CHECK (
      "completion" IS NULL OR
      (jsonb_typeof("completion") = 'object' AND "completion" ->> 'status' IN ('completed', 'partial', 'blocked'))
    ),
  CONSTRAINT "tasks_completion_status_consistency"
    CHECK (
      "execution_mode" <> 'agent' OR
      ("status" = 'succeeded' AND "completion" IS NOT NULL) OR
      "status" = 'running' OR
      ("status" IN ('queued', 'failed', 'cancelled', 'superseded') AND "completion" IS NULL)
    ),
  CONSTRAINT "tasks_queued_agent_unbound"
    CHECK (NOT ("execution_mode" = 'agent' AND "status" = 'queued') OR "session_id" IS NULL),
  CONSTRAINT "tasks_next_tuple_consistency"
    CHECK (
      num_nonnulls("next_due_at", "next_payload", "next_rationale") IN (0, 3) AND
      ("next_due_at" IS NULL OR ("status" = 'running' AND jsonb_typeof("next_payload") = 'object'))
    ),
  CONSTRAINT "tasks_intent_snapshot_pair"
    CHECK (
      ("intent_id" IS NULL AND "intent_snapshot" IS NULL) OR
      (
        "intent_id" IS NOT NULL AND
        jsonb_typeof("intent_snapshot") = 'object' AND
        "intent_snapshot" ->> 'intent_id' = "intent_id"::text
      )
    ),
  CONSTRAINT "tasks_plan_move_pair" CHECK (("plan_object_id" IS NULL) = ("move_candidate_id" IS NULL)),
  CONSTRAINT "tasks_origin_exclusive" CHECK ("intent_id" IS NULL OR "plan_object_id" IS NULL),
  CONSTRAINT "tasks_schedule_slot_pair" CHECK (("schedule_id" IS NULL) = ("scheduled_for" IS NULL)),
  CONSTRAINT "tasks_schedule_origin"
    CHECK (
      "schedule_id" IS NULL OR
      (
        "execution_mode" = 'agent' AND
        "activation" = 'automatic' AND
        "idempotency_key" IS NULL AND
        "intent_id" IS NULL AND
        "intent_snapshot" IS NULL AND
        "plan_object_id" IS NULL AND
        "move_candidate_id" IS NULL AND
        "parent_task_id" IS NULL AND
        "retry_of_task_id" IS NULL AND
        "supersedes_task_id" IS NULL
      )
    ),
  CONSTRAINT "tasks_parent_not_self" CHECK ("parent_task_id" IS NULL OR "parent_task_id" <> "id"),
  CONSTRAINT "tasks_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "tasks_agent_superseded_shape"
    CHECK (
      NOT ("execution_mode" = 'agent' AND "status" = 'superseded') OR
      (
        "activation" = 'automatic' AND
        "outcome_code" = 'plan_move_excluded' AND
        "started_at" IS NULL AND
        "intent_id" IS NULL AND
        "intent_snapshot" IS NULL AND
        "plan_object_id" IS NOT NULL AND
        "move_candidate_id" IS NOT NULL AND
        "retry_of_task_id" IS NULL AND
        "supersedes_task_id" IS NULL AND
        "schedule_id" IS NULL AND
        "session_id" IS NULL AND
        "completion" IS NULL AND
        "next_due_at" IS NULL AND
        "next_payload" IS NULL AND
        "next_rationale" IS NULL AND
        "leased_until" IS NULL AND
        "attempts" = 0
      )
    )
);
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_parent_same_brand_fk"
  FOREIGN KEY ("brand_id", "parent_task_id")
  REFERENCES "tasks" ("brand_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_retry_same_brand_fk"
  FOREIGN KEY ("brand_id", "retry_of_task_id")
  REFERENCES "tasks" ("brand_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_supersedes_same_brand_fk"
  FOREIGN KEY ("brand_id", "supersedes_task_id")
  REFERENCES "tasks" ("brand_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_active_identity_unique"
  ON "tasks" ("kind", "brand_id", "subject_key")
  WHERE "status" IN ('awaiting_approval', 'queued', 'running');
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_idempotency_key_unique"
  ON "tasks" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_session_id_unique"
  ON "tasks" ("session_id")
  WHERE "session_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_schedule_slot_unique"
  ON "tasks" ("schedule_id", "scheduled_for")
  WHERE "schedule_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_active_schedule_unique"
  ON "tasks" ("schedule_id")
  WHERE "schedule_id" IS NOT NULL AND "status" IN ('queued', 'running');
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_active_commitment_conflict_unique"
  ON "tasks" ("brand_id", "commitment_conflict_key")
  WHERE
    "activation" = 'human' AND
    "status" IN ('queued', 'running') AND
    "commitment_conflict_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "tasks_agent_claim_idx"
  ON "tasks" ("worker_key", "created_at", "id")
  WHERE "execution_mode" = 'agent' AND "activation" = 'automatic' AND "status" = 'queued';
--> statement-breakpoint
CREATE INDEX "tasks_direct_automatic_claim_idx"
  ON "tasks" ("worker_key", "created_at", "id")
  WHERE
    "execution_mode" = 'direct' AND
    "activation" = 'automatic' AND
    "status" IN ('queued', 'running');
--> statement-breakpoint
CREATE INDEX "tasks_human_commitment_claim_idx"
  ON "tasks" ("worker_key", "execute_before", "approved_at", "id")
  WHERE "execution_mode" = 'direct' AND "activation" = 'human' AND "status" = 'queued';
--> statement-breakpoint

ALTER TABLE "actions"
  ADD CONSTRAINT "actions_task_same_brand_fk"
  FOREIGN KEY ("brand_id", "task_id") REFERENCES "tasks" ("brand_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "actions"
  ADD CONSTRAINT "actions_decision_same_brand_fk"
  FOREIGN KEY ("brand_id", "decision_id") REFERENCES "objects" ("brand_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "actions"
  ADD CONSTRAINT "actions_schedule_same_brand_fk"
  FOREIGN KEY ("brand_id", "schedule_id") REFERENCES "schedules" ("brand_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

CREATE TABLE "session_events" (
  "meta_id" text PRIMARY KEY NOT NULL,
  "ingestion_sequence" bigserial NOT NULL,
  "brand_id" uuid NOT NULL,
  "session_id" text NOT NULL,
  "root_session_id" text NOT NULL,
  "parent_session_id" text,
  "parent_call_id" text,
  "task_id" uuid,
  "conversation_id" uuid,
  "event_kind" text NOT NULL,
  "event" jsonb NOT NULL,
  "occurred_at" timestamptz,
  "ingested_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "session_events_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "session_events_task_same_brand_fk"
    FOREIGN KEY ("brand_id", "task_id") REFERENCES "tasks" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "session_events_conversation_same_brand_fk"
    FOREIGN KEY ("brand_id", "conversation_id")
    REFERENCES "cmo_conversations" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "session_events_ingestion_sequence_unique" UNIQUE ("ingestion_sequence"),
  CONSTRAINT "session_events_brand_meta_unique" UNIQUE ("brand_id", "meta_id"),
  CONSTRAINT "session_events_event_object" CHECK (jsonb_typeof("event") = 'object'),
  CONSTRAINT "session_events_lineage_consistency"
    CHECK (
      (
        "parent_session_id" IS NULL AND
        "parent_call_id" IS NULL AND
        "root_session_id" = "session_id"
      ) OR
      ("parent_session_id" IS NOT NULL AND "parent_call_id" IS NOT NULL)
    ),
  CONSTRAINT "session_events_owner_exclusive"
    CHECK (num_nonnulls("task_id", "conversation_id") <= 1)
);
--> statement-breakpoint
CREATE INDEX "session_events_session_replay_idx"
  ON "session_events" ("session_id", "ingestion_sequence");
--> statement-breakpoint
CREATE INDEX "session_events_root_session_idx"
  ON "session_events" ("root_session_id", "ingestion_sequence");
--> statement-breakpoint

CREATE TABLE "credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "entry_type" "ledger_entry_type" NOT NULL,
  "amount" numeric(20, 6) NOT NULL,
  "currency" text,
  "idempotency_key" text,
  "session_event_id" text,
  "session_id" text,
  "task_id" uuid,
  "conversation_id" uuid,
  "action_id" uuid,
  "model_id" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "gateway_cost_usd" numeric(20, 8),
  "generation_id" text,
  "pricing_version" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "credit_ledger_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE CASCADE,
  CONSTRAINT "credit_ledger_session_event_same_brand_fk"
    FOREIGN KEY ("brand_id", "session_event_id")
    REFERENCES "session_events" ("brand_id", "meta_id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "credit_ledger_task_same_brand_fk"
    FOREIGN KEY ("brand_id", "task_id") REFERENCES "tasks" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "credit_ledger_conversation_same_brand_fk"
    FOREIGN KEY ("brand_id", "conversation_id")
    REFERENCES "cmo_conversations" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "credit_ledger_action_same_brand_fk"
    FOREIGN KEY ("brand_id", "action_id") REFERENCES "actions" ("brand_id", "id")
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "credit_ledger_amount_nonzero" CHECK ("amount" <> 0),
  CONSTRAINT "credit_ledger_token_counts_nonnegative"
    CHECK (coalesce("input_tokens", 0) >= 0 AND coalesce("output_tokens", 0) >= 0),
  CONSTRAINT "credit_ledger_metadata_object" CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "credit_ledger_entry_shape"
    CHECK (
      (
        "entry_type" = 'grant' AND
        "amount" > 0 AND
        "idempotency_key" IS NOT NULL AND
        "session_event_id" IS NULL AND
        "action_id" IS NULL AND
        "currency" IS NULL
      ) OR
      (
        "entry_type" = 'model_charge' AND
        "amount" < 0 AND
        "session_event_id" IS NOT NULL AND
        "session_id" IS NOT NULL AND
        "model_id" IS NOT NULL AND
        "input_tokens" IS NOT NULL AND
        "output_tokens" IS NOT NULL AND
        "action_id" IS NULL AND
        "currency" IS NULL
      ) OR
      (
        "entry_type" = 'action_charge' AND
        "amount" < 0 AND
        "action_id" IS NOT NULL AND
        "pricing_version" IS NOT NULL AND
        "currency" ~ '^[A-Z]{3}$' AND
        "session_event_id" IS NULL
      )
    ),
  CONSTRAINT "credit_ledger_owner_exclusive"
    CHECK (num_nonnulls("task_id", "conversation_id") <= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_session_event_unique"
  ON "credit_ledger" ("session_event_id")
  WHERE "session_event_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_action_unique"
  ON "credit_ledger" ("action_id")
  WHERE "action_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_key_unique"
  ON "credit_ledger" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "credit_ledger_brand_created_idx"
  ON "credit_ledger" ("brand_id", "created_at");
--> statement-breakpoint

CREATE FUNCTION "enforce_brand_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only while its brand exists', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM "brands" WHERE "id" = OLD."brand_id") THEN
    RAISE EXCEPTION '% is append-only while its brand exists', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "actions_append_only"
  BEFORE UPDATE OR DELETE ON "actions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_brand_append_only"();
--> statement-breakpoint
CREATE TRIGGER "credit_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION "enforce_brand_append_only"();
--> statement-breakpoint

CREATE FUNCTION "enforce_object_immutable_fields"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."brand_id",
    NEW."type",
    NEW."singleton_key",
    NEW."content",
    NEW."content_text",
    NEW."blob_key",
    NEW."blob_sha256",
    NEW."blob_content_type",
    NEW."blob_byte_size",
    NEW."produced_by",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."brand_id",
    OLD."type",
    OLD."singleton_key",
    OLD."content",
    OLD."content_text",
    OLD."blob_key",
    OLD."blob_sha256",
    OLD."blob_content_type",
    OLD."blob_byte_size",
    OLD."produced_by",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Object content, authorship, and provenance are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'superseded' AND ROW(
    NEW."status",
    NEW."superseded_by",
    NEW."superseded_at"
  ) IS DISTINCT FROM ROW(
    OLD."status",
    OLD."superseded_by",
    OLD."superseded_at"
  ) THEN
    RAISE EXCEPTION 'Object supersession is irreversible'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "objects_immutable_fields"
  BEFORE UPDATE ON "objects"
  FOR EACH ROW EXECUTE FUNCTION "enforce_object_immutable_fields"();
--> statement-breakpoint

CREATE FUNCTION "enforce_intent_immutable_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."brand_id",
    NEW."author_actor_id",
    NEW."parent_intent_id",
    NEW."statement",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."brand_id",
    OLD."author_actor_id",
    OLD."parent_intent_id",
    OLD."statement",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Intent identity, author, parent, and statement are immutable in v1'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'Intent updates must advance exactly one revision'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD."status" = 'draft' AND NEW."status" IN ('draft', 'active', 'abandoned')) OR
    (OLD."status" = 'active' AND NEW."status" IN ('active', 'settled', 'abandoned'))
  ) THEN
    RAISE EXCEPTION 'Intent status transition is invalid'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "intents_immutable_identity"
  BEFORE UPDATE ON "intents"
  FOR EACH ROW EXECUTE FUNCTION "enforce_intent_immutable_identity"();
--> statement-breakpoint

CREATE FUNCTION "enforce_task_immutable_origin"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."brand_id",
    NEW."kind",
    NEW."worker_key",
    NEW."subject_key",
    NEW."execution_mode",
    NEW."activation",
    NEW."idempotency_key",
    NEW."creation_hash",
    NEW."intent_id",
    NEW."intent_snapshot",
    NEW."plan_object_id",
    NEW."move_candidate_id",
    NEW."parent_task_id",
    NEW."retry_of_task_id",
    NEW."supersedes_task_id",
    NEW."schedule_id",
    NEW."scheduled_for",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."brand_id",
    OLD."kind",
    OLD."worker_key",
    OLD."subject_key",
    OLD."execution_mode",
    OLD."activation",
    OLD."idempotency_key",
    OLD."creation_hash",
    OLD."intent_id",
    OLD."intent_snapshot",
    OLD."plan_object_id",
    OLD."move_candidate_id",
    OLD."parent_task_id",
    OLD."retry_of_task_id",
    OLD."supersedes_task_id",
    OLD."schedule_id",
    OLD."scheduled_for",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Task identity and common origin are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."execution_mode" = 'agent' AND ROW(
    NEW."payload",
    NEW."payload_hash",
    NEW."revision"
  ) IS DISTINCT FROM ROW(
    OLD."payload",
    OLD."payload_hash",
    OLD."revision"
  ) THEN
    RAISE EXCEPTION 'Agent task payloads are immutable after insertion'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."session_id" IS NOT NULL AND NEW."session_id" IS DISTINCT FROM OLD."session_id" THEN
    RAISE EXCEPTION 'Task session binding is fill-once'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."completion" IS NOT NULL AND NEW."completion" IS NOT NULL AND
    NEW."completion" IS DISTINCT FROM OLD."completion" THEN
    RAISE EXCEPTION 'Staged task completion is fill-or-match'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "tasks_immutable_origin"
  BEFORE UPDATE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "enforce_task_immutable_origin"();
--> statement-breakpoint

CREATE FUNCTION "enforce_conversation_binding"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(NEW."id", NEW."brand_id", NEW."owner_user_id", NEW."created_at")
    IS DISTINCT FROM ROW(OLD."id", OLD."brand_id", OLD."owner_user_id", OLD."created_at") THEN
    RAISE EXCEPTION 'Conversation identity and owner are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."session_id" IS NOT NULL AND NEW."session_id" IS DISTINCT FROM OLD."session_id" THEN
    RAISE EXCEPTION 'Conversation session binding is fill-once'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."stream_index" < OLD."stream_index" THEN
    RAISE EXCEPTION 'Conversation stream index is monotonic'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cmo_conversations_binding_guard"
  BEFORE UPDATE ON "cmo_conversations"
  FOR EACH ROW EXECUTE FUNCTION "enforce_conversation_binding"();
--> statement-breakpoint

CREATE FUNCTION "enforce_schedule_binding"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."brand_id",
    NEW."schedule_key",
    NEW."worker_key",
    NEW."kind",
    NEW."fixed_payload",
    NEW."payload_digest",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."brand_id",
    OLD."schedule_key",
    OLD."worker_key",
    OLD."kind",
    OLD."fixed_payload",
    OLD."payload_digest",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Schedule template bindings are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."revision" < OLD."revision" THEN
    RAISE EXCEPTION 'Schedule revision is monotonic'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "schedules_immutable_binding"
  BEFORE UPDATE ON "schedules"
  FOR EACH ROW EXECUTE FUNCTION "enforce_schedule_binding"();
--> statement-breakpoint

CREATE FUNCTION "enforce_session_event_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Session events are immutable after ingestion'
    USING ERRCODE = '55000';

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "session_events_immutable"
  BEFORE UPDATE ON "session_events"
  FOR EACH ROW EXECUTE FUNCTION "enforce_session_event_immutable"();
--> statement-breakpoint

INSERT INTO "actors" ("id", "type", "actor_key")
VALUES
  ('00000000-0000-0000-0000-000000000001', 'system', 'system:context-dev'),
  ('00000000-0000-0000-0000-000000000002', 'system', 'system:schedule-dispatcher'),
  ('00000000-0000-0000-0000-000000000101', 'agent', 'agent:cmo'),
  ('00000000-0000-0000-0000-000000000102', 'agent', 'agent:product-marketer'),
  ('00000000-0000-0000-0000-000000000103', 'agent', 'agent:content'),
  ('00000000-0000-0000-0000-000000000104', 'agent', 'agent:distribution'),
  ('00000000-0000-0000-0000-000000000105', 'agent', 'agent:seo-discovery'),
  ('00000000-0000-0000-0000-000000000106', 'agent', 'agent:lifecycle'),
  ('00000000-0000-0000-0000-000000000107', 'agent', 'agent:growth')
ON CONFLICT ("actor_key") DO NOTHING;
