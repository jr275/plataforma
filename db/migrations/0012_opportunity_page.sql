-- 0012_opportunity_page: liga a oportunidade (com seu blueprint e rascunho) à página gerada pelo pipeline EXISTENTE de geração (ADR-028), e fecha no banco a porta
-- da publicação nesta fase. Histórico imutável (a aplicação só lê e insere). Nada aqui publica, indexa ou muda uma página: só registra o que a geração produziu.

CREATE TABLE plataforma.opportunity_page (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id  uuid        NOT NULL,
  blueprint_id    uuid        NOT NULL,
  draft_id        uuid,
  run_id          uuid        NOT NULL,
  outcome         text        NOT NULL CHECK (outcome IN ('generated', 'unchanged', 'blocked')),
  page_id         uuid,
  page_version_id uuid,
  -- resultado dos 6 gates da PÁGINA gerada (o mesmo registro de generation_item), copiado para a leitura por oportunidade
  gates           jsonb       NOT NULL CHECK (jsonb_typeof(gates) = 'array' AND jsonb_array_length(gates) = 6),
  qa_passed       boolean     NOT NULL,
  created_by      text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, blueprint_id) REFERENCES plataforma.page_blueprint (tenant_id, id),
  FOREIGN KEY (tenant_id, draft_id) REFERENCES plataforma.page_draft (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.generation_run (tenant_id, id),
  FOREIGN KEY (tenant_id, page_id) REFERENCES plataforma.page (tenant_id, id),
  FOREIGN KEY (tenant_id, page_version_id) REFERENCES plataforma.page_version (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, run_id),
  -- reprovado nos gates não tem versão; gerado ou inalterado tem; aprovado no QA exige gates verdes e página existente
  CHECK ((outcome = 'blocked') = (page_version_id IS NULL)),
  CHECK (NOT qa_passed OR outcome <> 'blocked')
);
CREATE INDEX opportunity_page_latest_idx ON plataforma.opportunity_page (tenant_id, opportunity_id, created_at DESC);
CREATE INDEX opportunity_page_page_idx ON plataforma.opportunity_page (tenant_id, page_id);

ALTER TABLE plataforma.opportunity_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.opportunity_page FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.opportunity_page AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
REVOKE ALL ON TABLE plataforma.opportunity_page FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE plataforma.opportunity_page TO menlo_app;

-- Publicação bloqueada no banco (defesa em profundidade): os estados depois de QA existem no modelo (e na tabela de transições), mas NENHUMA oportunidade pode entrar
-- neles nesta fase, por nenhum caminho, nem por SQL direto. Quando houver mecanismo real de publicação, uma migration própria troca esta função.
CREATE OR REPLACE FUNCTION plataforma.growth_opportunity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.vertical_id <> OLD.vertical_id OR NEW.cluster_key <> OLD.cluster_key THEN
    RAISE EXCEPTION 'a identidade da oportunidade é imutável' USING ERRCODE = '23514';
  END IF;
  IF NOT plataforma.opportunity_transition_ok(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'transição de ciclo de vida inválida: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('published', 'indexed', 'monitored', 'converted', 'measured', 'learned', 'refreshed') THEN
    RAISE EXCEPTION 'transição bloqueada: publicação e etapas seguintes não estão habilitadas (% -> %)', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
