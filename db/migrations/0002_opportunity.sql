-- 0002_opportunity: primeira tabela do data plane (ADR-014). Fatores separados (demanda, concorrência, evidência): NÃO existe
-- coluna de nota ou pontuação (regra 5, ADR-002). `rank` é a ordem editorial, não uma nota. Valores de domínio em inglês;
-- a interface os traduz.

CREATE TABLE plataforma.opportunity (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES plataforma.tenant (id),
  title       text        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary     text        NOT NULL CHECK (length(summary) <= 1000),
  next_action text        NOT NULL CHECK (length(next_action) <= 200),
  kind        text        NOT NULL CHECK (kind IN ('page', 'cluster', 'faq', 'comparison')),
  intent      text        NOT NULL CHECK (intent IN ('informational', 'comparison', 'transactional')),
  demand      text        NOT NULL CHECK (demand IN ('high', 'medium', 'low')),
  competition text        NOT NULL CHECK (competition IN ('high', 'medium', 'low')),
  evidence    text        NOT NULL CHECK (evidence IN ('high', 'medium', 'low')),
  status      text        NOT NULL CHECK (status IN ('candidate', 'in_review', 'ready', 'blocked', 'dismissed')),
  rank        integer     NOT NULL CHECK (rank >= 1),
  rationale   text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(rationale) <= 20),
  gaps        text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(gaps) <= 20),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX opportunity_tenant_rank_idx ON plataforma.opportunity (tenant_id, rank);

-- Mantém updated_at fiel mesmo se quem escreve esquecer. SECURITY INVOKER (o gate recusa SECURITY DEFINER acessível).
CREATE FUNCTION plataforma.set_updated_at() RETURNS trigger LANGUAGE plpgsql
AS $q$ BEGIN NEW.updated_at := now(); RETURN NEW; END $q$;
REVOKE ALL ON FUNCTION plataforma.set_updated_at() FROM PUBLIC;

CREATE TRIGGER opportunity_set_updated_at BEFORE UPDATE ON plataforma.opportunity
  FOR EACH ROW EXECUTE FUNCTION plataforma.set_updated_at();

ALTER TABLE plataforma.opportunity ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.opportunity FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON plataforma.opportunity AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id())
  WITH CHECK (tenant_id = plataforma.current_tenant_id());

-- Sem DELETE: descartar uma oportunidade é mudar o status para 'dismissed'.
REVOKE ALL ON TABLE plataforma.opportunity FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE plataforma.opportunity TO menlo_app;
