-- 0020_page_factory: lotes de geração, aprovação de página e deployments (Vercel). A interface é projeção destes registros e dos já existentes (page_recipe, qa_report, pipeline_*).
-- Estados distintos e nunca equivalentes: candidata (oportunidade) → blueprint → recipe gerado → QA → APROVADA (page_approval) → DEPLOYADA (deployment_page) → VERIFICADA.
-- Produção exige autorização explícita registrada; o padrão é preview.

CREATE TABLE plataforma.generation_batch (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  name             text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  status           text        NOT NULL CHECK (status IN ('PLANNED', 'CONFIRMED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED')),
  mode             text        NOT NULL CHECK (mode IN ('real', 'test_simulation')),
  config           jsonb       NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  estimate         jsonb       NOT NULL CHECK (jsonb_typeof(estimate) = 'object'),
  cancel_requested boolean     NOT NULL DEFAULT false,
  created_by       text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_by     text,
  confirmed_at     timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (status = 'PLANNED' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE INDEX generation_batch_recent_idx ON plataforma.generation_batch (tenant_id, seq DESC);

CREATE TABLE plataforma.generation_batch_item (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  batch_id         uuid        NOT NULL,
  opportunity_id   uuid        NOT NULL,
  -- classificação feita na validação (antes de executar): só ELIGIBLE vira trabalho
  classification   text        NOT NULL CHECK (classification IN ('ELIGIBLE', 'BLOCKED', 'DATA_PENDING', 'ALREADY_DONE')),
  reason           text        CHECK (reason IS NULL OR length(reason) <= 500),
  status           text        NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'BLOCKED', 'FAILED', 'CANCELLED', 'SKIPPED')),
  stage            text        CHECK (stage IS NULL OR length(stage) <= 40),
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  pipeline_run_id  uuid,
  final_outcome    text        CHECK (final_outcome IS NULL OR final_outcome IN ('APPROVED', 'BLOCKED', 'NEEDS_REVIEW')),
  error            text        CHECK (error IS NULL OR length(error) <= 1000),
  started_at       timestamptz,
  finished_at      timestamptz,
  FOREIGN KEY (tenant_id, batch_id) REFERENCES plataforma.generation_batch (tenant_id, id),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, pipeline_run_id) REFERENCES plataforma.pipeline_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, batch_id, opportunity_id)
);
CREATE INDEX generation_batch_item_state_idx ON plataforma.generation_batch_item (tenant_id, batch_id, status);

-- Aprovação humana de UMA versão de recipe (insert-only; a última decisão vale). Aprovar não publica.
CREATE TABLE plataforma.page_approval (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id   uuid        NOT NULL,
  recipe_id        uuid        NOT NULL,
  decision         text        NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'REVOKED')),
  reason           text        NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  actor            text        NOT NULL CHECK (length(actor) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES plataforma.page_recipe (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX page_approval_recipe_idx ON plataforma.page_approval (tenant_id, recipe_id, seq DESC);

CREATE TABLE plataforma.deployment (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                    bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id              uuid        NOT NULL REFERENCES plataforma.tenant (id),
  provider               text        NOT NULL CHECK (provider IN ('vercel')),
  project_ref            text        NOT NULL CHECK (length(project_ref) BETWEEN 1 AND 200),
  target                 text        NOT NULL CHECK (target IN ('preview', 'production')),
  status                 text        NOT NULL CHECK (status IN ('QUEUED', 'BUILDING', 'READY', 'FAILED', 'CANCELED', 'VERIFICATION_PENDING', 'VERIFIED')),
  provider_deployment_id text,
  url                    text        CHECK (url IS NULL OR length(url) <= 500),
  git_branch             text        CHECK (git_branch IS NULL OR length(git_branch) <= 200),
  git_commit             text        CHECK (git_commit IS NULL OR git_commit ~ '^[0-9a-f]{7,40}$'),
  batch_id               uuid,
  idempotency_key        text        NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  -- produção só com autorização explícita registrada
  authorized_by          text,
  authorization_reason   text,
  error                  text        CHECK (error IS NULL OR length(error) <= 1000),
  created_by             text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES plataforma.generation_batch (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (target = 'preview' OR (authorized_by IS NOT NULL AND length(authorization_reason) >= 10))
);
CREATE INDEX deployment_recent_idx ON plataforma.deployment (tenant_id, seq DESC);

CREATE TABLE plataforma.deployment_event (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  deployment_id    uuid        NOT NULL,
  status           text        NOT NULL CHECK (status IN ('QUEUED', 'BUILDING', 'READY', 'FAILED', 'CANCELED', 'VERIFICATION_PENDING', 'VERIFIED')),
  -- estado como o provedor o relatou (ex.: BUILDING, READY, ERROR) e a origem da informação
  provider_state   text        CHECK (provider_state IS NULL OR length(provider_state) <= 60),
  source           text        NOT NULL CHECK (source IN ('request', 'poll', 'webhook', 'verification')),
  detail           jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, deployment_id) REFERENCES plataforma.deployment (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX deployment_event_idx ON plataforma.deployment_event (tenant_id, deployment_id, seq DESC);

-- Quais versões de recipe entraram em cada deployment (relação deployment ↔ lote ↔ páginas).
CREATE TABLE plataforma.deployment_page (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  deployment_id    uuid        NOT NULL,
  opportunity_id   uuid        NOT NULL,
  recipe_id        uuid        NOT NULL,
  url_path         text        NOT NULL CHECK (url_path ~ '^/'),
  http_status      integer     CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  verified_at      timestamptz,
  FOREIGN KEY (tenant_id, deployment_id) REFERENCES plataforma.deployment (tenant_id, id),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES plataforma.page_recipe (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, deployment_id, recipe_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['generation_batch', 'generation_batch_item', 'page_approval', 'deployment', 'deployment_event', 'deployment_page'] LOOP
    EXECUTE format('ALTER TABLE plataforma.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE plataforma.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON plataforma.%I AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON TABLE plataforma.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE plataforma.%I TO menlo_app', t);
  END LOOP;
END $$;
GRANT UPDATE (status, config, estimate, cancel_requested, confirmed_by, confirmed_at, started_at, finished_at) ON TABLE plataforma.generation_batch TO menlo_app;
GRANT UPDATE (status, stage, attempts, pipeline_run_id, final_outcome, error, started_at, finished_at) ON TABLE plataforma.generation_batch_item TO menlo_app;
GRANT UPDATE (status, provider_deployment_id, url, git_branch, git_commit, error, updated_at) ON TABLE plataforma.deployment TO menlo_app;
GRANT UPDATE (http_status, verified_at) ON TABLE plataforma.deployment_page TO menlo_app;
