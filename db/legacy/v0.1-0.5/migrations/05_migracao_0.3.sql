-- Migração 0.2 -> 0.3 (DRAFT, aguarda revisão): contrato e elegibilidade de superfície,
-- política de uso e raio de impacto de fontes, ciclo de vida de localidade, padrão de conhecimento.
-- Regra mantida: nada de nota composta; tudo vira campo, sinalizador ou contagem separada.
SET search_path = menlo, public;

-- ------------------------------------------------ 1. FONTES: política de uso
CREATE TABLE source_usage_policy (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  source_id            uuid NOT NULL REFERENCES source(id),
  allowed_uses         text[] NOT NULL DEFAULT '{}'
                         CHECK (allowed_uses <@ ARRAY['internal_analysis','display_on_page','structured_data',
                                'derive_metrics','model_input','redistribute']),
  attribution_required boolean NOT NULL DEFAULT false,
  retention            interval,                    -- NULL = sem limite declarado
  terms_ref            text,                        -- onde estão os termos/contrato
  legal_status         text NOT NULL DEFAULT 'unreviewed'
                         CHECK (legal_status IN ('unreviewed','approved','restricted','prohibited')),
  reviewed_at          timestamptz,
  UNIQUE (tenant_id, source_id)
);

-- Raio de impacto: o que quebra se a fonte sair do ar ou for proibida. Contagens separadas.
CREATE VIEW v_source_blast_radius AS
SELECT s.id AS source_id, s.tenant_id, s.name,
       count(DISTINCT c.id)  FILTER (WHERE c.status = 'active')                    AS active_claims,
       count(DISTINCT c.entity_id) FILTER (WHERE c.status = 'active')              AS entities_touched,
       count(DISTINCT sv.surface_id)                                               AS surfaces_depending,
       count(DISTINCT sv.surface_id) FILTER (WHERE su.state = 'LIVE')              AS live_surfaces_depending
FROM source s
LEFT JOIN claim c           ON c.source_id = s.id
LEFT JOIN surface_fact sf   ON sf.claim_id = c.id
LEFT JOIN surface_version sv ON sv.id = sf.surface_version_id
                            AND sv.version = (SELECT max(version) FROM surface_version WHERE surface_id = sv.surface_id)
LEFT JOIN surface su        ON su.id = sv.surface_id
GROUP BY s.id, s.tenant_id, s.name;

-- ------------------------------------------------ 2. SUPERFÍCIES: contrato e elegibilidade
-- Contrato por tipo de superfície: o que ela exige para existir.
CREATE TABLE surface_contract (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  surface_kind   text NOT NULL,
  version        int  NOT NULL,
  requires       jsonb NOT NULL DEFAULT '{}',       -- seções, tipos de schema.org, mínimo de evidência
  valid_for      interval,                          -- validade temporal da recomendação
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, surface_kind, version)
);

-- Elegibilidade com razão: cada superfície é elegível ou não para um alvo, e por quê.
CREATE TABLE surface_eligibility (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  surface_id     uuid NOT NULL REFERENCES surface(id),
  target         text NOT NULL CHECK (target IN ('organic_listing','rich_result','ai_answer','ai_crawler','feed')),
  eligible       boolean NOT NULL,
  reason_code    text NOT NULL,                     -- ex.: 'missing_required_attribute','blocked_by_robots'
  contract_id    uuid REFERENCES surface_contract(id),
  checked_at     timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz,
  UNIQUE (surface_id, target, checked_at)
);
CREATE INDEX surface_elig_idx ON surface_eligibility (surface_id, target, checked_at DESC);

-- Elegibilidade mais recente por superfície e alvo.
CREATE VIEW v_surface_eligibility_current AS
SELECT DISTINCT ON (surface_id, target) *
FROM surface_eligibility
ORDER BY surface_id, target, checked_at DESC;

-- ------------------------------------------------ 3. LOCALIDADE: ciclo de vida
CREATE TABLE locality_lifecycle (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  entity_id    uuid NOT NULL REFERENCES entity(id),
  stage        text NOT NULL CHECK (stage IN ('candidate','active','mature','declining','consolidating','retired')),
  reason       text,
  consolidate_into uuid REFERENCES entity(id),
  since        timestamptz NOT NULL DEFAULT now(),
  CHECK ((stage = 'consolidating') = (consolidate_into IS NOT NULL))
);
CREATE INDEX locality_lifecycle_idx ON locality_lifecycle (entity_id, since DESC);

-- Ação 'retire' passa a existir ao lado de 'consolidate'.
ALTER TABLE opportunity DROP CONSTRAINT IF EXISTS opportunity_action_check;
ALTER TABLE opportunity ADD CONSTRAINT opportunity_action_check CHECK (action IN
  ('create','update','consolidate','retire','acquire_evidence','create_relation',
   'authority_action','geo_surface','no_action'));

-- ------------------------------------------------ 4. PADRÃO DE CONHECIMENTO
CREATE TABLE knowledge_pattern (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  code         text NOT NULL,
  intent       text,
  contract     jsonb NOT NULL DEFAULT '{}',          -- atributos, relações e evidência exigidos
  stage        text NOT NULL DEFAULT 'hypothesis'
                 CHECK (stage IN ('hypothesis','pilot','validated','scaling','refining','stopped')),
  risk_flags   text[] NOT NULL DEFAULT '{}'
                 CHECK (risk_flags <@ ARRAY['thin_content','duplication','stale_source','legal','cannibalization']),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
ALTER TABLE surface ADD COLUMN IF NOT EXISTS pattern_id uuid REFERENCES knowledge_pattern(id);

-- Decisão Scale / Refine / Stop, sempre ligada ao experimento que a sustenta.
CREATE TABLE pattern_decision (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  pattern_id    uuid NOT NULL REFERENCES knowledge_pattern(id),
  decision      text NOT NULL CHECK (decision IN ('scale','refine','stop')),
  experiment_id uuid REFERENCES experiment(id),
  reason        text NOT NULL,
  decided_at    timestamptz NOT NULL DEFAULT now()
);

-- Teste de diferenciação: fração dos fatos de cada superfície que NÃO aparece em outras
-- superfícies do mesmo padrão. Um número por página, sem virar nota composta.
CREATE VIEW v_surface_differentiation AS
WITH latest AS (
  SELECT DISTINCT ON (sv.surface_id) sv.id AS sv_id, sv.surface_id, s.pattern_id, s.tenant_id
  FROM surface_version sv JOIN surface s ON s.id = sv.surface_id
  WHERE s.pattern_id IS NOT NULL
  ORDER BY sv.surface_id, sv.version DESC
),
facts AS (
  SELECT l.surface_id, l.pattern_id, l.tenant_id,
         coalesce(sf.claim_id, sf.relation_id) AS fact_id
  FROM latest l JOIN surface_fact sf ON sf.surface_version_id = l.sv_id
)
SELECT f.surface_id, f.pattern_id, f.tenant_id,
       count(*)                                                      AS facts_total,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM facts o WHERE o.pattern_id = f.pattern_id
           AND o.fact_id = f.fact_id AND o.surface_id <> f.surface_id)) AS facts_unique,
       round(count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM facts o WHERE o.pattern_id = f.pattern_id
           AND o.fact_id = f.fact_id AND o.surface_id <> f.surface_id))::numeric / count(*), 3) AS unique_fraction
FROM facts f GROUP BY f.surface_id, f.pattern_id, f.tenant_id;

-- ------------------------------------------------ 5. ISOLAMENTO POR TENANT nas tabelas novas
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['source_usage_policy','surface_contract','surface_eligibility',
                           'locality_lifecycle','knowledge_pattern','pattern_decision']
  LOOP
    EXECUTE format('ALTER TABLE menlo.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON menlo.%I
                      USING (tenant_id = nullif(current_setting('menlo.tenant_id', true), '')::uuid)
                      WITH CHECK (tenant_id = nullif(current_setting('menlo.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
