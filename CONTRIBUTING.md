# Como contribuir

1. Leia o documento mestre (link em `docs/README.md`), aba "Guia para engenheiros", e o `CLAUDE.md`.
2. Trabalhe em ramo ou worktree separado. PR pequeno, uma fatia vertical que roda de ponta a ponta.
3. Decisão de arquitetura nova vira um ADR curto em `docs/adr/` antes do código.
4. O PR só fecha com tipos, lint e testes verdes. Se mexeu em gate, juiz, prompt ou template, rode `pnpm eval:gate`.
5. Tabela nova do data plane traz `tenant_id`, RLS e o teste de isolamento entre dois tenants.
6. Se mudou algo que o documento mestre descreve, atualize o documento no mesmo trabalho e reexporte a aba em `docs/menlo-os/`.
7. Nunca commite segredos (`client_secret.json`, `token.json`, `.env`). Se um segredo vazar, revogue primeiro e avise o dono do produto.
8. Termine cada entrega com: o que mudou, como verificar, o que ficou pendente.
9. Migrations, alterações de banco e integração de branches seguem `docs/POLITICA_DE_ENGENHARIA.md`.
