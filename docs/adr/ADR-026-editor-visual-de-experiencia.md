# ADR-026: Editor visual da experiência de página (React Flow + ELK) com rascunho persistido

**Status:** ACCEPTED (2026-10-14) por pedido expresso do dono ("Visual Page Experience Editor"). A migration `0010` **não foi aplicada** no Neon (só em bancos descartáveis).

## Contexto
O grafo de `/opportunities/[id]/blueprint` era somente leitura e derivado. O dono quer um editor funcional de experiências de páginas programáticas, com alterações persistidas em rascunho e refletidas na prévia, sem virar um editor genérico desconectado do domínio e sem afirmar capacidades que não existem.

## Decisão
1. **Separação explícita em sete partes.**
   - *Modelo de domínio* (`packages/api/src/draft`, puro): `PageDraft` (nós tipados, arestas, posições, base do blueprint), contratos por tipo (`contracts.ts`), operações puras (`model.ts`: adicionar, remover, editar, conectar, desconectar, `parseDraft`, `diffDrafts`), assinatura de conteúdo (`sig.ts`).
   - *Adaptador de grafo* (`apps/web/src/lib/editor/graph-adapter.ts`): domínio → nós/arestas do React Flow. O grafo é projeção; nunca fonte de fatos.
   - *Layout* (`lib/editor/elk.ts`): ELK só calcula posições, por ação explícita ("Organizar") ou na primeira abertura, para nós sem posição. Nunca sobrescreve posições existentes.
   - *Estado do editor* (`lib/editor/state.ts`, sem React): seleção, histórico de desfazer/refazer (conteúdo; posições ficam fora), avaliação do servidor, estado de salvamento.
   - *Persistência* (`engine/page-draft-store.ts`, migration `0010_page_draft`): versões imutáveis por oportunidade, únicas por conteúdo, concorrência otimista, RLS forçada, autoria e horário, validação e resultado dos gates gravados, resumo das mudanças relevantes.
   - *Validador* (`draft/validate.ts`): topologia, configuração por contrato, dependências e pré-requisitos de publicação. O MESMO código roda no navegador (feedback imediato) e no servidor (autoridade).
   - *Prévia* (`pages/preview-draft.ts`): o motor real de páginas renderiza o rascunho (seções, ordem, títulos, links configurados) com os fatos reais; sem dados, a seção some.
2. **Doze tipos de nó**: oportunidade, intenção de busca, entidade, fonte de dados, requisito de evidência, template, seção, link interno, metadados SEO, dados estruturados, quality gate e decisão de publicação. Cada contrato declara o que é editável, o que é derivado, se pode ser criado/removido e se é único. Só se adicionam fontes **implementadas**, templates **do registro** e seções **do template**. Nenhum nó afirma executar capacidade inexistente: `not_evaluated`, `blocked` e `unavailable` continuam explícitos.
3. **Conexões** só entre tipos compatíveis (tabela `ALLOWED_EDGES`), sem ciclo e sem duplicata; as ligações obrigatórias (gate → publicação, saídas da oportunidade) não são removíveis.
4. **Execução separada da configuração.** Alterar um nó invalida os resultados de gate dependentes (`not_evaluated: invalidado`) até "Validar no servidor". Editar, salvar ou validar **não gera, indexa nem publica**. A publicação continua bloqueada (sem mecanismo; saúde do índice não medida) e nunca é autorizada por rascunho válido nem por gates.
5. **Servidor é a autoridade.** O cliente envia o modelo; o servidor lê de forma defensiva (esquema, limites, chaves desconhecidas), revalida, reavalia os gates sobre o rascunho e grava. Tenant e autor vêm da sessão. O contexto (fatos, fontes disponíveis, caminhos) é montado no servidor.
6. **Bancada de desenvolvimento** (`scripts/dev-editor.sh`, `/dev/editor`): banco descartável com todas as migrations, respostas reais capturadas das fontes e o MESMO serviço de produção, sem login. Só fora de produção e só com variáveis próprias; não toca o banco do aplicativo.
7. **Acessibilidade**: alternativa em lista com o mesmo conteúdo (nós, estados, conexões, ações por teclado); em telas pequenas a lista é o caminho recomendado.

## Alternativas rejeitadas
- Persistir em `localStorage`: não é multi-tenant, não é auditável e não sobrevive à troca de aparelho.
- Deixar o React Flow como fonte do estado: esconderia regras de negócio no canvas.
- Fundir o rascunho ao blueprint gravado: o blueprint é histórico imutável de uma avaliação; o rascunho é trabalho em andamento.

## Consequências
- O primeiro salvamento cria a versão 1; o histórico mostra o que a pessoa mudou em relação ao rascunho derivado do blueprint.
- Posições salvas cada vez que mudam geram versão (sem "mudanças relevantes"); o histórico as identifica como "só posições".
- Sem a migration `0010`, o editor mostra a indisponibilidade e o resto da página continua.
