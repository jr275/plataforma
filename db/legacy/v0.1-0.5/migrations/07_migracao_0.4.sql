-- Menlo OS: migração 0.4 (depois da 0.3). PostgreSQL 14+.
-- 1) page_type: os 12 tipos de página, separado de surface.kind (que descreve a superfície técnica).
-- 2) Carga idempotente de observações do Search Console (índice único por período + página + classe de consulta).
-- 3) Visão semanal por cidade dos cliques sem marca (série do piloto).
SET search_path = menlo, public;

-- 1. page_type -------------------------------------------------------------
ALTER TABLE surface  ADD COLUMN page_type text;
ALTER TABLE template ADD COLUMN page_type text;
ALTER TABLE surface  ADD CONSTRAINT surface_page_type_ck  CHECK (page_type IS NULL OR page_type IN
  ('entity_hub','location','comparison','directory','guide','attribute_facet',
   'ranking','persona','transactional','data_insights','combination','question_answer'));
ALTER TABLE template ADD CONSTRAINT template_page_type_ck CHECK (page_type IS NULL OR page_type IN
  ('entity_hub','location','comparison','directory','guide','attribute_facet',
   'ranking','persona','transactional','data_insights','combination','question_answer'));
CREATE INDEX surface_page_type_idx ON surface (tenant_id, page_type);
COMMENT ON COLUMN surface.page_type IS 'Um dos 12 Page Types. NULL até a superfície ser classificada. Independe de kind.';

-- 2. Observações do Search Console, sem duplicar na recarga ----------------
-- Convenção em observation (já existente):
--   metric: 'gsc_clicks' | 'gsc_impressions'
--   dimensions: {"page": url (opcional), "query_class": "nonbrand"|"brand"|"all", "grain": "day"|"period"}
CREATE UNIQUE INDEX observation_gsc_uniq ON observation
  (tenant_id, metric, period_start, period_end,
   (coalesce(dimensions->>'page','')), (coalesce(dimensions->>'query_class','')))
  WHERE metric IN ('gsc_clicks','gsc_impressions');

-- 3. Série semanal por cidade (desfecho do piloto: cliques sem marca) ------
-- Só linhas de 1 dia (API). Semana começa na segunda. dias_na_semana < 7 sinaliza semana incompleta.
CREATE VIEW v_city_week_nonbrand AS
SELECT o.tenant_id,
       o.city_entity_id,
       date_trunc('week', o.period_start)::date            AS week_start,
       sum(o.value) FILTER (WHERE o.metric = 'gsc_clicks')       AS clicks,
       sum(o.value) FILTER (WHERE o.metric = 'gsc_impressions')  AS impressions,
       count(DISTINCT o.period_start)                       AS dias_na_semana
FROM observation o
WHERE o.metric IN ('gsc_clicks','gsc_impressions')
  AND o.dimensions->>'query_class' = 'nonbrand'
  AND o.period_start = o.period_end
  AND o.city_entity_id IS NOT NULL
GROUP BY o.tenant_id, o.city_entity_id, date_trunc('week', o.period_start);

-- Reconciliação: marca + sem marca contra o total, por dia.
CREATE VIEW v_gsc_reconciliation AS
SELECT t.tenant_id, t.period_start AS dia,
       t.value                                        AS total_clicks,
       coalesce(b.value,0)                            AS brand_clicks,
       coalesce(n.value,0)                            AS nonbrand_clicks,
       t.value - coalesce(b.value,0) - coalesce(n.value,0) AS diferenca
FROM observation t
LEFT JOIN observation b ON b.tenant_id=t.tenant_id AND b.metric='gsc_clicks' AND b.period_start=t.period_start
                       AND b.period_end=t.period_end AND b.dimensions->>'query_class'='brand' AND NOT (b.dimensions ? 'page')
LEFT JOIN LATERAL (
   SELECT sum(x.value) AS value FROM observation x
   WHERE x.tenant_id=t.tenant_id AND x.metric='gsc_clicks' AND x.period_start=t.period_start AND x.period_end=t.period_end
     AND x.dimensions->>'query_class'='nonbrand') n ON true
WHERE t.metric='gsc_clicks' AND t.period_start=t.period_end
  AND t.dimensions->>'query_class'='all' AND NOT (t.dimensions ? 'page');
