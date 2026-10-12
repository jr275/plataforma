#!/usr/bin/env python3
"""Extrai do Google Search Console (API) as series do piloto Menlo OS.

Gera 3 CSVs na pasta 'saida':
  gsc_sem_marca_por_dia_pagina.csv  date,page,clicks,impressions   (consultas SEM marca)
  gsc_total_por_dia.csv             date,clicks,impressions        (sem filtro, para conferencia)
  gsc_marca_por_dia.csv             date,clicks,impressions        (so consultas de marca)

Uso: python gsc_semanal.py [--site URL] [--dias 480] [--pais BRA]
Login: abre o navegador na primeira vez (conta Google que tem acesso ao Search Console).
"""
import argparse, csv, os, sys, time, datetime as dt

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
# Lista de marca: PROPOSTA, precisa ser aprovada pela RE/MAX. Sintaxe RE2.
MARCA_REGEX = r"(?i)(re\s?-?max|remax|reimax|remaz|remex|rimax|remmax)"
LIMITE = 25000
AQUI = os.path.dirname(os.path.abspath(__file__))


def autenticar():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    tok = os.path.join(AQUI, "token.json")
    cred = None
    if os.path.exists(tok):
        cred = Credentials.from_authorized_user_file(tok, SCOPES)
    if not cred or not cred.valid:
        if cred and cred.expired and cred.refresh_token:
            cred.refresh(Request())
        else:
            seg = os.path.join(AQUI, "client_secret.json")
            if not os.path.exists(seg):
                sys.exit("Falta o arquivo client_secret.json nesta pasta. Veja o passo 4 do LEIA-ME.")
            cred = InstalledAppFlow.from_client_secrets_file(seg, SCOPES).run_local_server(port=0)
        with open(tok, "w") as f:
            f.write(cred.to_json())
    from googleapiclient.discovery import build
    return build("searchconsole", "v1", credentials=cred, cache_discovery=False)


def escolher_site(svc, site):
    sites = svc.sites().list().execute().get("siteEntry", [])
    if site:
        return site
    if not sites:
        sys.exit("Esta conta Google nao enxerga nenhuma propriedade do Search Console.")
    print("\nPropriedades disponiveis:")
    for i, s in enumerate(sites, 1):
        print(f"  {i}. {s['siteUrl']}  ({s['permissionLevel']})")
    n = int(input("\nDigite o numero da propriedade da RE/MAX: ").strip())
    return sites[n - 1]["siteUrl"]


def consultar(svc, site, ini, fim, dims, filtros, pais, rotulo=""):
    fl = list(filtros)
    if pais:
        fl.append({"dimension": "country", "operator": "equals", "expression": pais.lower()})
    corpo = {"startDate": ini, "endDate": fim, "dimensions": dims,
             "type": "web", "rowLimit": LIMITE, "dataState": "final"}
    if fl:
        corpo["dimensionFilterGroups"] = [{"groupType": "and", "filters": fl}]
    inicio, linhas = 0, []
    while True:
        corpo["startRow"] = inicio
        for tent in range(6):
            try:
                r = svc.searchanalytics().query(siteUrl=site, body=corpo).execute()
                break
            except Exception as e:  # limite de cota / erro transitorio
                if tent == 5:
                    raise
                time.sleep(2 ** tent * 2)
        rows = r.get("rows", [])
        linhas += rows
        print(f"   {rotulo} {len(linhas)} linhas", end="\r", flush=True)
        if len(rows) < LIMITE:
            break
        inicio += LIMITE
    print()
    return linhas


def salvar(caminho, linhas, dims):
    tmp = caminho + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(dims + ["clicks", "impressions"])
        for r in sorted(linhas, key=lambda x: x["keys"]):
            w.writerow(r["keys"] + [int(r["clicks"]), int(r["impressions"])])
    os.replace(tmp, caminho)  # so aparece o arquivo quando esta completo


def meses(ini, fim):
    """Divide [ini, fim] em blocos mensais (datas date)."""
    atual = ini
    while atual <= fim:
        prox = (atual.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
        yield atual, min(prox - dt.timedelta(days=1), fim)
        atual = prox


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site")
    ap.add_argument("--dias", type=int, default=365)
    ap.add_argument("--pais", default="BRA", help="codigo ISO-3 (BRA). Use '' para todos")
    a = ap.parse_args()
    svc = autenticar()
    site = escolher_site(svc, a.site)
    fim = dt.date.today() - dt.timedelta(days=3)
    ini = fim - dt.timedelta(days=a.dias)
    print(f"\nPropriedade: {site}\nPeriodo: {ini} a {fim}  pais: {a.pais or 'todos'}\n")
    out = os.path.join(AQUI, "saida")
    partes = os.path.join(out, "partes")
    os.makedirs(partes, exist_ok=True)
    f_sem = [{"dimension": "query", "operator": "excludingRegex", "expression": MARCA_REGEX}]
    f_com = [{"dimension": "query", "operator": "includingRegex", "expression": MARCA_REGEX}]

    # Passos pequenos primeiro
    for n, (nome, filtros, txt) in enumerate([
            ("gsc_total_por_dia.csv", [], "Total sem filtro, por dia"),
            ("gsc_marca_por_dia.csv", f_com, "So marca, por dia")], 1):
        dest = os.path.join(out, nome)
        if os.path.exists(dest):
            print(f"{n}/3 {txt}: ja feito, pulando.")
            continue
        print(f"{n}/3 {txt}...")
        salvar(dest, consultar(svc, site, ini.isoformat(), fim.isoformat(), ["date"], filtros, a.pais), ["date"])

    # Passo grande: um arquivo por mes, retoma de onde parou
    print("3/3 Sem marca, por dia e pagina (um mes por vez; pode parar e rodar de novo).")
    blocos = list(meses(ini, fim))
    for i, (m_ini, m_fim) in enumerate(blocos, 1):
        dest = os.path.join(partes, m_ini.strftime("%Y-%m") + ".csv")
        if os.path.exists(dest):
            print(f"   mes {i}/{len(blocos)} {m_ini:%Y-%m}: ja feito.")
            continue
        linhas = consultar(svc, site, m_ini.isoformat(), m_fim.isoformat(),
                           ["date", "page"], f_sem, a.pais, f"mes {i}/{len(blocos)} {m_ini:%Y-%m}")
        salvar(dest, linhas, ["date", "page"])
        print(f"   mes {i}/{len(blocos)} {m_ini:%Y-%m}: {len(linhas)} linhas salvas.")

    final = os.path.join(out, "gsc_sem_marca_por_dia_pagina.csv")
    with open(final, "w", newline="", encoding="utf-8") as g:
        g.write("date,page,clicks,impressions\n")
        for m_ini, _ in blocos:
            with open(os.path.join(partes, m_ini.strftime("%Y-%m") + ".csv"), encoding="utf-8") as p:
                next(p)
                g.writelines(p)
    print(f"\nPronto. Envie os 3 arquivos da pasta (nao precisa da subpasta 'partes'):\n  {out}")


if __name__ == "__main__":
    main()
