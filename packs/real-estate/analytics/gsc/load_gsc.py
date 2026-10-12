#!/usr/bin/env python3
"""Carrega dados do Search Console na tabela menlo.observation (idempotente).

Dois modos:
  --export-dir PASTA   export da interface (Chart.csv + Pages.csv): totais por dia e páginas somadas no período.
  --api-dir PASTA      saída do extrator gsc_semanal.py (3 CSVs diários).
Cria, se faltarem: tenant, mercado br, fonte search_console, tipo de entidade 'city' e uma entidade por cidade
reconhecida na URL. Recarregar o mesmo arquivo atualiza os valores, não duplica.
Uso: python load_gsc.py --dsn "postgresql://..." --tenant remax --export-dir ./gsc1010
"""
import argparse, csv, os, re, sys, unicodedata, urllib.parse as U, datetime as dt, collections
import psycopg

HOST = "https://www.remax.com.br"

def slug(s):
    s = U.unquote(s).replace("_", "-").replace(" ", "-")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"-+", "-", s).strip("-")

def norm_url(u):
    u = u.split("#")[0]
    m = re.match(r"https?://(?:www\.)?remax\.com\.br(.*)$", u)
    return HOST + (m.group(1) or "/") if m else u

def city_of(url):
    """(chave_canonica, nome) ou None. Padrões: /_/Região/UF/Cidade, /pt-br/pesquisa/região/uf/cidade/..., /pt-br/escritorios/uf/cidade/..."""
    p = U.unquote(url)
    m = re.match(r"https?://(?:www\.)?remax\.com\.br/_/([^/]+)/([^/]+)/([^/?#]+)", p)
    if m: return f"{slug(m.group(2))}/{slug(m.group(3))}", m.group(3).replace("_", " ")
    m = re.match(r"https?://(?:www\.)?remax\.com\.br/pt-br/pesquisa/[^/]+/([^/]+)/([^/]+)/", p)
    if m: return f"{slug(m.group(1))}/{slug(m.group(2))}", m.group(2).replace("-", " ").title()
    m = re.match(r"https?://(?:www\.)?remax\.com\.br/pt-br/escritorios/([^/]+)/([^/]+)/", p)
    if m: return f"{slug(m.group(1))}/{slug(m.group(2))}", m.group(2).replace("-", " ").title()
    return None

def setup(cur, tenant):
    cur.execute("INSERT INTO menlo.tenant (slug,name) VALUES (%s,%s) ON CONFLICT (slug) DO NOTHING", (tenant, tenant))
    cur.execute("SELECT id FROM menlo.tenant WHERE slug=%s", (tenant,)); tid = cur.fetchone()[0]
    cur.execute("SELECT set_config('menlo.tenant_id', %s, false)", (str(tid),))
    cur.execute("INSERT INTO menlo.market (tenant_id,code,country_code,default_locale,currency) VALUES (%s,'br','BR','pt-BR','BRL') ON CONFLICT (tenant_id,code) DO NOTHING", (tid,))
    cur.execute("SELECT id FROM menlo.market WHERE tenant_id=%s AND code='br'", (tid,)); mid = cur.fetchone()[0]
    cur.execute("INSERT INTO menlo.source (tenant_id,name,kind,authority_class) VALUES (%s,'search_console','search_console','primary') ON CONFLICT (tenant_id,name) DO NOTHING", (tid,))
    cur.execute("SELECT id FROM menlo.source WHERE tenant_id=%s AND name='search_console'", (tid,)); sid = cur.fetchone()[0]
    cur.execute("INSERT INTO menlo.entity_type (tenant_id,code,label) VALUES (%s,'city','Cidade') ON CONFLICT DO NOTHING", (tid,))
    return tid, mid, sid

def city_id(cur, tid, cache, key, name):
    if key not in cache:
        cur.execute("""INSERT INTO menlo.entity (tenant_id,entity_type,canonical_key,name) VALUES (%s,'city',%s,%s)
                       ON CONFLICT (tenant_id,entity_type,canonical_key) DO UPDATE SET name=menlo.entity.name RETURNING id""", (tid, key, name))
        cache[key] = cur.fetchone()[0]
    return cache[key]

SQL = """INSERT INTO menlo.observation (tenant_id,market_id,city_entity_id,metric,value,period_start,period_end,dimensions,source_id)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
ON CONFLICT (tenant_id,metric,period_start,period_end,(coalesce(dimensions->>'page','')),(coalesce(dimensions->>'query_class','')))
WHERE metric IN ('gsc_clicks','gsc_impressions') DO UPDATE SET value=EXCLUDED.value, city_entity_id=EXCLUDED.city_entity_id"""

def emit(cur, tid, mid, sid, rows):
    import json
    n = 0
    for (cid, d0, d1, clicks, imps, dims) in rows:
        for metric, v in (("gsc_clicks", clicks), ("gsc_impressions", imps)):
            cur.execute(SQL, (tid, mid, cid, metric, v, d0, d1, json.dumps(dims), sid)); n += 1
    return n

def pages(cur, tid, cache, items, d0, d1, qclass, grain):
    """items: [(url, clicks, imps)] -> agrega variantes http/https/www e devolve linhas."""
    agg = collections.defaultdict(lambda: [0, 0])
    for u, c, i in items:
        a = agg[norm_url(u)]; a[0] += c; a[1] += i
    out = []
    for u, (c, i) in agg.items():
        ct = city_of(u); cid = city_id(cur, tid, cache, *ct) if ct else None
        out.append((cid, d0, d1, c, i, {"page": u, "query_class": qclass, "grain": grain}))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", required=True); ap.add_argument("--tenant", default="remax")
    ap.add_argument("--export-dir"); ap.add_argument("--api-dir")
    a = ap.parse_args()
    if not (a.export_dir or a.api_dir): sys.exit("Informe --export-dir ou --api-dir")
    with psycopg.connect(a.dsn, autocommit=False) as con, con.cursor() as cur:
        tid, mid, sid = setup(cur, a.tenant); cache = {}; total = 0
        if a.export_dir:
            ch = list(csv.DictReader(open(os.path.join(a.export_dir, "Chart.csv"), encoding="utf-8-sig")))
            days = [dt.date.fromisoformat(r["Date"]) for r in ch]
            total += emit(cur, tid, mid, sid, [(None, d, d, int(r["Clicks"]), int(r["Impressions"]), {"query_class": "all", "grain": "day"}) for d, r in zip(days, ch)])
            pg = [(r["Top pages"], int(r["Clicks"]), int(r["Impressions"])) for r in csv.DictReader(open(os.path.join(a.export_dir, "Pages.csv"), encoding="utf-8-sig"))]
            total += emit(cur, tid, mid, sid, pages(cur, tid, cache, pg, min(days), max(days), "all", "period"))
        if a.api_dir:
            def rd(n): return list(csv.DictReader(open(os.path.join(a.api_dir, n), encoding="utf-8-sig")))
            tot = [(None, dt.date.fromisoformat(r["date"]), dt.date.fromisoformat(r["date"]), int(r["clicks"]), int(r["impressions"]), {"query_class": "all", "grain": "day"}) for r in rd("gsc_total_por_dia.csv")]
            mar = [(None, dt.date.fromisoformat(r["date"]), dt.date.fromisoformat(r["date"]), int(r["clicks"]), int(r["impressions"]), {"query_class": "brand", "grain": "day"}) for r in rd("gsc_marca_por_dia.csv")]
            by = collections.defaultdict(list)
            for r in rd("gsc_sem_marca_por_dia_pagina.csv"):
                by[dt.date.fromisoformat(r["date"])].append((r["page"], int(float(r["clicks"])), int(float(r["impressions"]))))
            nb = []
            for d, items in by.items(): nb += pages(cur, tid, cache, items, d, d, "nonbrand", "day")
            total += emit(cur, tid, mid, sid, tot + mar + nb)
        con.commit()
        print(f"{total} observações gravadas; {len(cache)} cidades reconhecidas.")
if __name__ == "__main__": main()
