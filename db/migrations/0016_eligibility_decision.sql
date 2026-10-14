-- 0016_eligibility_decision: decisão de elegibilidade DETERMINÍSTICA (spec seções 8 e 9, ADR-030). Histórico imutável (SELECT/INSERT): cada avaliação guarda o SNAPSHOT congelado das entradas,
-- a política (versão), os resultados de cada gate, os scores por dimensão, o total, as referências de evidência e a decisão. Mesmo snapshot + mesma política = a mesma linha (idempotência).
-- Também amplia o ciclo de vida: `scored → rejected` e `eligible → rejected` (a reavaliação pode concluir REJECTED depois de uma decisão anterior).

CREATE OR REPLACE FUNCTION plataforma.opportunity_transition_ok(old_status text, new_status text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT old_status = new_status OR (old_status, new_status) IN (VALUES
    ('discovered', 'validated'),
    ('discovered', 'rejected'),
    ('discovered', 'retired'),
    ('validated', 'scored'),
    ('validated', 'rejected'),
    ('validated', 'retired'),
    ('scored', 'eligible'),
    ('scored', 'rejected'),
    ('scored', 'retired'),
    ('eligible', 'serp_analyzed'),
    ('eligible', 'blueprinted'),
    ('eligible', 'scored'),
    ('eligible', 'rejected'),
    ('eligible', 'retired'),
    ('serp_analyzed', 'blueprinted'),
    ('serp_analyzed', 'scored'),
    ('serp_analyzed', 'retired'),
    ('blueprinted', 'data_assembled'),
    ('blueprinted', 'serp_analyzed'),
    ('blueprinted', 'retired'),
    ('data_assembled', 'evidence_validated'),
    ('data_assembled', 'blueprinted'),
    ('data_assembled', 'retired'),
    ('evidence_validated', 'experience_built'),
    ('evidence_validated', 'data_assembled'),
    ('evidence_validated', 'retired'),
    ('experience_built', 'qa'),
    ('experience_built', 'evidence_validated'),
    ('experience_built', 'retired'),
    ('qa', 'published'),
    ('qa', 'experience_built'),
    ('qa', 'retired'),
    ('published', 'indexed'),
    ('published', 'retired'),
    ('indexed', 'monitored'),
    ('indexed', 'retired'),
    ('monitored', 'converted'),
    ('monitored', 'measured'),
    ('monitored', 'retired'),
    ('converted', 'measured'),
    ('converted', 'retired'),
    ('measured', 'learned'),
    ('measured', 'retired'),
    ('learned', 'refreshed'),
    ('learned', 'retired'),
    ('refreshed', 'scored'),
    ('refreshed', 'retired'),
    ('rejected', 'discovered'),
    ('rejected', 'retired')
  )
$$;

CREATE TABLE plataforma.eligibility_decision (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ordem de gravação (avaliações com o MESMO instante de referência continuam ordenadas)
  seq                  bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id            uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id       uuid        NOT NULL,
  topic_id             text        NOT NULL CHECK (topic_id ~ '^[0-9a-f]{64}$'),
  run_id               uuid,
  policy_id            uuid        NOT NULL,
  policy_version       integer     NOT NULL CHECK (policy_version >= 1),
  snapshot_hash        text        NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  snapshot             jsonb       NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  reference_time       timestamptz NOT NULL,
  decision             text        NOT NULL CHECK (decision IN ('READY_FOR_BLUEPRINT', 'DATA_REQUIRED', 'RESEARCH_REQUIRED', 'REJECTED')),
  eligible             boolean     NOT NULL,
  gate_results         jsonb       NOT NULL CHECK (jsonb_typeof(gate_results) = 'object'),
  gate_details         jsonb       NOT NULL CHECK (jsonb_typeof(gate_details) = 'object'),
  blocking_reasons     jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(blocking_reasons) = 'array'),
  missing_requirements jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(missing_requirements) = 'array'),
  scores               jsonb       NOT NULL CHECK (jsonb_typeof(scores) = 'object'),
  -- NULL = nenhuma dimensão foi pontuada (um gate reprovou: a nota só existe depois dos gates)
  total_score          numeric(6,3) CHECK (total_score IS NULL OR total_score BETWEEN 0 AND 100),
  weight_coverage      numeric(5,4) CHECK (weight_coverage IS NULL OR weight_coverage BETWEEN 0 AND 1),
  evidence_refs        jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence_refs) = 'array'),
  recommended_action   text        NOT NULL CHECK (length(recommended_action) BETWEEN 1 AND 1000),
  evaluated_at         timestamptz NOT NULL,
  created_by           text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.research_run (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES plataforma.policy (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, snapshot_hash, policy_id),
  -- READY só existe com o booleano `eligible` e vice-versa; nota alta nunca fabrica elegibilidade
  CHECK (eligible = (decision = 'READY_FOR_BLUEPRINT'))
);
CREATE INDEX eligibility_decision_latest_idx ON plataforma.eligibility_decision (tenant_id, opportunity_id, seq DESC);
CREATE INDEX eligibility_decision_decision_idx ON plataforma.eligibility_decision (tenant_id, decision);

ALTER TABLE plataforma.eligibility_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.eligibility_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.eligibility_decision AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
REVOKE ALL ON TABLE plataforma.eligibility_decision FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE plataforma.eligibility_decision TO menlo_app;
