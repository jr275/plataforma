// Tipos de ACESSO ao esquema de produto (ADR-011): o SQL escrito à mão em db/migrations é a autoridade; o Drizzle só tipa o
// acesso e NUNCA gera nem aplica migrations. Manter em sincronia com as migrations (0001_tenant a 0004_city).
import { bigint, index, integer, jsonb, pgSchema, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const importRun = plataforma.table(
  "import_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    kind: text("kind", { enum: ["csv"] }).notNull(),
    sourceName: text("source_name").notNull(),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    origin: text("origin", { enum: ["real", "test", "manual"] }).notNull(),
    mapping: jsonb("mapping").notNull(),
    status: text("status", { enum: ["running", "succeeded", "partial", "failed"] }).notNull().default("running"),
    totalRows: integer("total_rows").notNull().default(0),
    acceptedRows: integer("accepted_rows").notNull().default(0),
    rejectedRows: integer("rejected_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("import_run_tenant_started_idx").on(t.tenantId, t.startedAt)],
);

export const importRecord = plataforma.table(
  "import_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    runId: uuid("run_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").notNull(),
    outcome: text("outcome", { enum: ["accepted", "rejected", "duplicate"] }).notNull(),
    issues: jsonb("issues").notNull().default([]),
    entityId: uuid("entity_id"),
  },
  (t) => [index("import_record_run_idx").on(t.tenantId, t.runId, t.rowNumber)], // FK composta (tenant_id, run_id) vive na migration
);

export const city = plataforma.table(
  "city",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    ibgeCode: text("ibge_code").notNull(),
    name: text("name").notNull(),
    uf: text("uf").notNull(),
    region: text("region", { enum: ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] }),
    population: bigint("population", { mode: "number" }),
    populationYear: smallint("population_year"),
    sourceRunId: uuid("source_run_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("city_tenant_uf_name_idx").on(t.tenantId, t.uf, t.name)],
);
