CREATE TABLE "capi_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"lead_id" uuid,
	"ad_id" text,
	"pixel_id" text,
	"payload" jsonb,
	"meta_response" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capi_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "insights_daily" (
	"ad_id" text NOT NULL,
	"date" date NOT NULL,
	"spend" numeric(12, 2),
	"impressions" integer,
	"reach" integer,
	"clicks" integer,
	"unique_clicks" integer,
	"ctr" numeric(8, 4),
	"cpc" numeric(10, 4),
	"frequency" numeric(8, 4),
	"messaging_started" integer,
	"landing_page_views" integer,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"phone_hash" text,
	"email_hash" text,
	"ad_id" text,
	"ctwa_clid" text,
	"fbclid" text,
	"fbp" text,
	"source_url" text,
	"cta_headline" text,
	"attribution_method" text,
	"wa_instance" text,
	"ghl_opportunity_id" text,
	"ghl_contact_id" text,
	"ghl_pipeline_id" text,
	"ghl_stage_id" text,
	"status" text DEFAULT 'opened' NOT NULL,
	"qualified_at" timestamp with time zone,
	"purchased_at" timestamp with time zone,
	"purchase_value" numeric(12, 2),
	"purchase_currency" text DEFAULT 'BRL',
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"wa_message_id" text NOT NULL,
	"direction" text,
	"text" text,
	"classification" text,
	"received_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
CREATE TABLE "meta_ads" (
	"ad_id" text PRIMARY KEY NOT NULL,
	"ad_name" text,
	"adset_id" text,
	"adset_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"account_id" text,
	"status" text,
	"destination_type" text,
	"thumbnail_url" text,
	"permalink_url" text,
	"pixel_id" text,
	"page_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"raw_body" jsonb,
	"headers" jsonb,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capi_events" ADD CONSTRAINT "capi_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights_daily" ADD CONSTRAINT "insights_daily_ad_id_meta_ads_ad_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."meta_ads"("ad_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_ad_id_meta_ads_ad_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."meta_ads"("ad_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capi_events_status_idx" ON "capi_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "capi_events_lead_idx" ON "capi_events" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "capi_events_created_idx" ON "capi_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_daily_pk" ON "insights_daily" USING btree ("ad_id","date");--> statement-breakpoint
CREATE INDEX "insights_daily_date_idx" ON "insights_daily" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_wa_unique" ON "leads" USING btree ("wa_instance","phone") WHERE source = 'whatsapp';--> statement-breakpoint
CREATE UNIQUE INDEX "leads_ghl_unique" ON "leads" USING btree ("ghl_opportunity_id") WHERE source = 'site_ghl';--> statement-breakpoint
CREATE INDEX "leads_ad_idx" ON "leads" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_first_seen_idx" ON "leads" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "messages_lead_received_idx" ON "messages" USING btree ("lead_id","received_at");--> statement-breakpoint
CREATE INDEX "meta_ads_campaign_idx" ON "meta_ads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "meta_ads_adset_idx" ON "meta_ads" USING btree ("adset_id");--> statement-breakpoint
CREATE INDEX "meta_ads_status_idx" ON "meta_ads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_inbox_source_processed_idx" ON "webhook_inbox" USING btree ("source","processed_at");--> statement-breakpoint
CREATE INDEX "webhook_inbox_received_idx" ON "webhook_inbox" USING btree ("received_at");