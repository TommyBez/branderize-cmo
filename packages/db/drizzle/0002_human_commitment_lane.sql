ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_human_approval_required_from_queued"
  CHECK (
    "activation" <> 'human'
    OR "status" NOT IN (
      'queued',
      'running',
      'succeeded',
      'failed',
      'outcome_unknown',
      'expired'
    )
    OR "approval_action_id" IS NOT NULL
  );
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_human_approved_at_pair"
  CHECK (("approval_action_id" IS NULL) = ("approved_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_human_conflict_key_null_while_awaiting"
  CHECK (
    "status" <> 'awaiting_approval'
    OR "commitment_conflict_key" IS NULL
  );
--> statement-breakpoint
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_human_result_required_on_terminal"
  CHECK (
    "activation" <> 'human'
    OR "status" NOT IN ('succeeded', 'failed', 'outcome_unknown')
    OR "result_action_id" IS NOT NULL
  );
