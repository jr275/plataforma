# ADR-012: Versão do Node.js

**Status:** ACCEPTED como runtime pretendido (Fase 2, 2026-10-11), sujeito à verificação de compatibilidade. Alinhamento feito na Fase 3: `.nvmrc` (`24`), `engines.node` = `^24` e `.github/workflows/ci.yml` usando `node-version-file: .nvmrc`. `pnpm check:consistency` impede divergência. A compatibilidade foi verificada localmente em Node 24.9.0 (`pnpm turbo typecheck lint build`); a verificação no CI do GitHub ainda não ocorreu.

## Evidência (estado no momento da proposta, antes do alinhamento da Fase 3)

| Fonte | Valor |
| --- | --- |
| `package.json` (`engines.node`) | `>=24` (definido no scaffold desta sessão; não vem de ADR nem de documento) |
| Máquina local | Node `v24.9.0`, pnpm `12.10.1` |
| `menlo/.github/workflows/ci.yml` | `node-version: 22`; o próprio arquivo diz "ajuste quando o package.json existir" |
| `.nvmrc`, `.node-version`, `.tool-versions`, Volta | não existem em `plataforma` |
| Dependências instaladas (campo `engines`) | `next` 16.4.0 `>=20.9.0`; `vitest` 3.2.7 `^18 \|\| ^20 \|\| >=22`; `typescript`, `zod`, `drizzle-*`, `turbo` sem restrição |
| Contexto de plataforma (Vercel) | Node 24 LTS é o padrão atual; Node 20 é descontinuado em 1º de outubro de 2026; AI SDK 7 exige Node 22 ou superior |

Nenhum ADR ou documento do `menlo` fixa a versão. O "22" do CI é um valor provisório, não uma decisão registrada.

## Decisão

**Node 24 LTS**, uma só versão major em desenvolvimento, CI e deploy. Motivos: é a versão local, está dentro de todas as exigências de dependências, é o padrão da Vercel, e o suporte de 22 termina antes (abril de 2027 contra abril de 2028 para o 24).

## Arquivos alterados e pendências

Feitos na Fase 3 (neste repositório):

1. `plataforma/.nvmrc` (novo): `24`.
2. `plataforma/package.json`: `engines.node` restrito a `^24`.
3. `plataforma/.github/workflows/ci.yml`: `node-version-file: .nvmrc`.

Pendentes, fora deste repositório e não verificados aqui:

4. `menlo/.github/workflows/ci.yml`: remover ou atualizar para 24 (esse workflow não pertence ao repo de documentação).
5. `menlo/docs/dev-setup.md`: citar Node 24.
6. Projeto na Vercel (futuro): Node.js version = 24.x.

## Condição para reabrir

Se o dono do produto tiver razão para fixar 22 (por exemplo, restrição do cliente ou do ambiente de deploy), a decisão pode ser reaberta; a evidência atual não a mostra.
