CREATE TABLE IF NOT EXISTS "scenario_mcqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_number" integer NOT NULL,
	"category_key" text NOT NULL,
	"category_name" text NOT NULL,
	"title" text NOT NULL,
	"process_type" text NOT NULL,
	"badge_class" text DEFAULT 'badge-auto' NOT NULL,
	"scenario" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_index" integer NOT NULL,
	"selected_index" integer NOT NULL,
	"answer_text" text NOT NULL,
	"explanation" text NOT NULL,
	"actors" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"tech_state" text NOT NULL,
	"api_code" text NOT NULL,
	"fin_math" jsonb NOT NULL,
	"decision_note" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_mcqs_flow_number_unique" UNIQUE("flow_number")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scenario_mcqs" ADD CONSTRAINT "scenario_mcqs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scenario_mcqs_cat_idx" ON "scenario_mcqs" USING btree ("category_key","flow_number");
