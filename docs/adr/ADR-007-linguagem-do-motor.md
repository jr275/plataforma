# ADR-007: Linguagem do motor
Status: ACCEPTED (2026-10-10)

Contexto: motor, extrator e carregador existentes são Python sobre SQL; a pilha do produto no Blueprint é TypeScript (Next.js, Neon, Drizzle, Zod, Vercel Workflows).

Decisão: fronteira explícita (opção C). TypeScript para o produto: API tipada, compilador de páginas, Quality Gate, workflows e telas. Python para análise e medição: motor de oportunidades, Search Console, estatística do piloto. O Postgres e o esquema SQL são o contrato entre os dois lados.

Alternativas rejeitadas: tudo em TypeScript (reescrita e perda da estatística); tudo em Python (o produto pede TypeScript de qualquer forma).

Consequências: duas linguagens com regra de fronteira; o código Python existente não é reescrito; RLS vale para ambos (`menlo.tenant_id`); falta definir onde o Python roda. Reavaliar se o motor entrar na publicação em tempo real.
