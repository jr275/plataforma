// Tipos de ACESSO ao esquema de produto (ADR-011): o SQL escrito à mão em db/migrations é a autoridade; o Drizzle só tipa o
// acesso e NUNCA gera nem aplica migrations. Manter em sincronia com as migrations (0001_tenant, 0002_opportunity).
import { index, integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const plataforma = pgSchema("plataforma");

export const tenant = plataforma.table("tenant", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opportunity = plataforma.table(
  "opportunity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    nextAction: text("next_action").notNull(),
    kind: text("kind", { enum: ["page", "cluster", "faq", "comparison"] }).notNull(),
    intent: text("intent", { enum: ["informational", "comparison", "transactional"] }).notNull(),
    demand: text("demand", { enum: ["high", "medium", "low"] }).notNull(),
    competition: text("competition", { enum: ["high", "medium", "low"] }).notNull(),
    evidence: text("evidence", { enum: ["high", "medium", "low"] }).notNull(),
    status: text("status", { enum: ["candidate", "in_review", "ready", "blocked", "dismissed"] }).notNull(),
    rank: integer("rank").notNull(),
    rationale: text("rationale").array().notNull().default([]),
    gaps: text("gaps").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("opportunity_tenant_rank_idx").on(t.tenantId, t.rank)], // os CHECKs e o RLS vivem só nas migrations
);
