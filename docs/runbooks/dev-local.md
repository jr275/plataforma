# Runbook: abrir o sistema com dados reais, sem tocar no Neon

Para ver a área **Geração de páginas** com dados reais do IBGE (extrato de SP, 645 municípios) e os 20 rascunhos do piloto, só nesta máquina.

## Pré-requisitos
PostgreSQL 16 instalado (o mesmo dos testes), `pnpm install` feito e o `apps/web/.env.local` com o login do Supabase (`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`), do projeto cujo usuário tem `tenant_ids` com o tenant `remax`.

## Subir
```bash
cd ~/plataforma && pnpm dev:local
```
Ele cria o banco descartável, aplica as 7 migrations (com o gate de segurança), cria o tenant `remax`, importa o IBGE, gera os 20 rascunhos, confere as contagens e liga o aplicativo. Abra `http://localhost:3000`, entre com o seu usuário e clique em **Geração de páginas**.

**Esperado:** 20 rascunhos (São Paulo, Guarulhos, Campinas…), 1 execução "Concluída" com 20 geradas, e cada página abre a pré-visualização, os 6 gates, os fatos com fonte e as versões.

## Encerrar
`Ctrl+C` no terminal: o aplicativo para, o banco local é removido e o arquivo `apps/web/.env.development.local` é apagado. Se ele já existir ao iniciar, o script se recusa a rodar (não sobrescreve arquivo seu).

## Só conferir o preparo, sem abrir o aplicativo
```bash
bash scripts/dev-local.sh --setup-only
```

## Sem login nem banco (só para olhar a tela)
Em desenvolvimento, `/dev/preview` mostra a página com o motor e os gates reais sobre o extrato do IBGE, sem persistir (rotulado na tela). Não existe em produção.

## O que isto NÃO é
Não é o Neon e não prova nada sobre o Neon. Os dados somem ao encerrar. A aplicação das migrations no Neon é um passo à parte, com autorização (ver `docs/audits/MVP_STAGE4_FECHAMENTO_E_UI_2026-10-13.md`, seção D).
