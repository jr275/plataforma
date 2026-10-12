import { AsyncLocalStorage } from "node:async_hooks";
import {
  ConnectionAcquireTimeoutError,
  NestedTenantContextError,
  TenantAccessDeniedError,
  TenantDbClosedError,
  TransactionNotCommittedError,
  UnsafeConnectionError,
  UnsettledTenantOperationError,
} from "./errors";
import type { VerifiedIdentity } from "./identity";
import { parseTenantId } from "./tenant-id";

/** Resultado mínimo de uma consulta (compatível com `pg` e com o Pool do driver do Neon). */
export interface QueryResultLike<R> {
  rows: R[];
  rowCount: number | null;
  /** Tag do comando que o servidor respondeu (`pg`: "SELECT", "COMMIT", "ROLLBACK"...). Opcional na abstração; o COMMIT a exige. */
  command?: string;
}

export interface ClientLike {
  query(text: string, values?: unknown[]): Promise<QueryResultLike<any>>;
  release(error?: Error | boolean): void;
  /**
   * Opcional (o `pg` os tem, pois o cliente é um EventEmitter). Enquanto withTenant usa o cliente, ele ouve 'error': o servidor
   * pode encerrar a sessão (por exemplo, por idle_in_transaction_session_timeout) e o cliente então emite 'error'; um
   * 'error' sem ouvinte derruba o processo (medido: `uncaughtException`). Dublês sem esses métodos continuam válidos.
   */
  on?(event: "error", listener: (error: Error) => void): unknown;
  removeListener?(event: "error", listener: (error: Error) => void): unknown;
}

export interface PoolLike {
  connect(): Promise<ClientLike>;
}

/**
 * O que o código de negócio enxerga dentro de `withTenant`: só consultas, sempre no contexto do tenant. É uma
 * capacidade COM PRAZO: só funciona enquanto a função passada a `withTenant` executa. Depois disso `query` rejeita com
 * TenantDbClosedError sem enviar nada ao banco, mesmo que o objeto ou o método `query` tenham sido guardados.
 */
export interface TenantDb {
  query<R = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResultLike<R>>;
}

/** Opções de withTenant. Tudo é opcional: sem opções o comportamento é o de sempre. */
export interface WithTenantOptions {
  /**
   * Limite, em milissegundos, para OBTER a conexão do pool (só a espera pela aquisição: não limita a consulta nem a transação).
   * Inteiro entre 1 e 2147483647. Ausente (`undefined`) = SEM limite: a espera é a do pool (ilimitada se o pool não tem
   * `connectionTimeoutMillis`). Qualquer outro valor (0, negativo, NaN, Infinity, não inteiro, texto, `null`) lança TypeError:
   * um valor inválido nunca desliga a proteção em silêncio. Não há valor padrão: quem configura escolhe.
   */
  acquireTimeoutMs?: number;
  /**
   * `statement_timeout` DESTA transação, em milissegundos: o servidor cancela CADA comando que passar do limite (SQLSTATE
   * 57014) e a transação fica abortada. É por comando, não pela transação: N comandos podem somar mais que o limite.
   * Local à transação (set_config com is_local = true): vale do ponto em que é aplicado (antes da função) até o COMMIT/ROLLBACK, e
   * a sessão volta ao valor que tinha. Mesmas regras de validação de `acquireTimeoutMs`; omitido = não configura (não
   * redefine o que a sessão já tem). Não há valor padrão.
   */
  statementTimeoutMs?: number;
  /**
   * `lock_timeout` desta transação, em ms: o servidor encerra a ESPERA por um lock (SQLSTATE 55P03) e a transação fica
   * abortada. Só vale para a espera por locks, não para outras lentidões. Local à transação; mesmas regras.
   */
  lockTimeoutMs?: number;
  /**
   * `idle_in_transaction_session_timeout` desta transação, em ms: se a sessão ficar INATIVA dentro da transação (sem
   * comando em andamento, por exemplo enquanto a função espera algo que não é SQL) por mais que o limite, o servidor
   * ENCERRA a sessão (SQLSTATE 25P03 no servidor; o cliente costuma ver apenas "Connection terminated unexpectedly") e a
   * conexão é descartada. O relógio começa depois da configuração, antes da função. Mesmas regras; local à transação.
   */
  idleInTransactionTimeoutMs?: number;
}

/**
 * Maior valor aceito: o teto do setTimeout do Node (acima dele o timer dispararia quase na hora) e também o teto
 * (INT_MAX ms) de statement_timeout, lock_timeout e idle_in_transaction_session_timeout no PostgreSQL.
 */
const MAX_MS = 2_147_483_647;

function validateMs(name: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_MS) {
    throw new TypeError(`${name} inválido: esperado um inteiro entre 1 e ${MAX_MS}; omita a opção para não configurar`);
  }
  return value;
}

/** Limites do PostgreSQL aplicados por transação. Os NOMES são constantes do código; os valores vão como parâmetros. */
const TRANSACTION_LIMITS = [
  ["statementTimeoutMs", "statement_timeout"],
  ["lockTimeoutMs", "lock_timeout"],
  ["idleInTransactionTimeoutMs", "idle_in_transaction_session_timeout"],
] as const;

/** Um único SELECT com um set_config local (is_local = true) por limite configurado; sem nenhum limite, não há SQL extra. */
function limitsStatement(options: WithTenantOptions | undefined): { text: string; values: string[] } | undefined {
  const calls: string[] = [];
  const values: string[] = [];
  for (const [option, guc] of TRANSACTION_LIMITS) {
    const value = validateMs(option, options?.[option]);
    if (value === undefined) continue;
    values.push(String(value));
    calls.push(`set_config('${guc}', $${values.length}, true)`);
  }
  return calls.length > 0 ? { text: `SELECT ${calls.join(", ")}`, values } : undefined;
}

/**
 * Obtém a conexão com um limite OPCIONAL, com propriedade única. A decisão "quem fica com a conexão" é tomada uma só vez,
 * pelo primeiro evento entre o timer e o `pool.connect()`: estado `waiting` → `settled`.
 *  - conexão chega primeiro: o chamador a recebe e o timer é desligado;
 *  - timer primeiro: o chamador recebe ConnectionAcquireTimeoutError; se a conexão chegar depois, ela é devolvida ao pool
 *    (release exatamente uma vez, sem SQL) e nunca chega ao fluxo de withTenant;
 *  - `connect()` rejeita primeiro: o erro original é propagado; se rejeitar depois do timeout, é absorvido aqui (os dois
 *    handlers do `.then` impedem rejeição não tratada).
 * Não cancela o pedido no pool (PoolLike não tem cancelamento): o pedido abandonado continua na fila do pool até receber uma
 * conexão, que então é devolvida. Sem limite configurado, é só `pool.connect()`.
 */
function acquireClient(pool: PoolLike, acquireTimeoutMs: number | undefined): Promise<ClientLike> {
  if (acquireTimeoutMs === undefined) return pool.connect();
  return new Promise<ClientLike>((resolve, reject) => {
    let state: "waiting" | "settled" = "waiting";
    const timer = setTimeout(() => {
      if (state !== "waiting") return;
      state = "settled";
      reject(new ConnectionAcquireTimeoutError(acquireTimeoutMs));
    }, acquireTimeoutMs);
    let attempt: Promise<ClientLike>;
    try {
      attempt = pool.connect();
    } catch (error) {
      state = "settled";
      clearTimeout(timer);
      reject(error);
      return;
    }
    attempt.then(
      (client) => {
        if (state === "waiting") {
          state = "settled";
          clearTimeout(timer);
          resolve(client);
          return;
        }
        try {
          client.release(); // chegada tardia: o chamador já recebeu o timeout; devolve sem executar SQL
        } catch {
          // o release de uma conexão que ninguém usou não pode virar uma rejeição não tratada
        }
      },
      (error) => {
        if (state === "waiting") {
          state = "settled";
          clearTimeout(timer);
          reject(error);
        }
      },
    );
  });
}

/**
 * Ciclo de vida de UM escopo de withTenant. Dois estados e uma única transição: ACTIVE (criado logo antes de a função ser
 * chamada) → CLOSED (assim que a função termina ou lança, ANTES do COMMIT/ROLLBACK e de a conexão voltar ao pool; também
 * no `finally`). Nunca volta a ACTIVE. Cada chamada cria o seu próprio objeto: nada é compartilhado entre escopos.
 * Dele dependem DUAS decisões: o `db` do escopo (query rejeita depois de CLOSED) e a recusa de chamada aninhada.
 */
interface ScopeState {
  active: boolean;
}

/**
 * Transporta o escopo ATUAL no contexto assíncrono (por chamada; não é estado global do tenant). Uma continuação criada
 * dentro da função herda o objeto mesmo depois de o escopo terminar; por isso a recusa de aninhamento olha `active`, não
 * a mera presença do objeto: um escopo CLOSED não torna ninguém "aninhado".
 */
const currentScope = new AsyncLocalStorage<ScopeState>();

/**
 * Capacidade de banco com prazo. A conexão fica só dentro das closures (não há propriedade nem método que a exponha) e o
 * objeto é congelado; `query` não usa `this`, então um método guardado e chamado solto passa pela mesma verificação.
 * A verificação e o envio acontecem no mesmo passo síncrono: depois de `close()`, nenhuma consulta nova chega ao cliente.
 */
function scopedDb(client: ClientLike) {
  const state: ScopeState = { active: true };
  let pending = 0;
  const db: TenantDb = Object.freeze({
    async query<R = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResultLike<R>> {
      if (!state.active) throw new TenantDbClosedError();
      pending += 1;
      try {
        return await client.query(text, values ? [...values] : undefined);
      } finally {
        pending -= 1;
      }
    },
  });
  return { db, state, close: () => void (state.active = false), pending: () => pending };
}

/**
 * Emite o COMMIT e só retorna se o servidor confirmou. Um COMMIT em transação abortada NÃO falha: o servidor o executa como
 * ROLLBACK e responde com a tag ROLLBACK (o `pg` resolve normalmente). Por isso o resultado é conferido; qualquer resposta
 * diferente de "COMMIT" (inclusive ausente ou de formato inesperado) falha fechada. Uma rejeição do COMMIT vira
 * "unknown": pode ter sido o servidor ou o transporte, e o resultado gravado não é conhecido. Sem nova tentativa.
 */
async function commit(client: ClientLike): Promise<void> {
  let outcome: QueryResultLike<unknown>;
  try {
    outcome = await client.query("COMMIT");
  } catch (cause) {
    throw new TransactionNotCommittedError("unknown", { cause });
  }
  if (outcome?.command !== "COMMIT") {
    throw new TransactionNotCommittedError(outcome?.command === "ROLLBACK" ? "rolled_back" : "unknown");
  }
}

/**
 * ÚNICO ponto do repositório que estabelece o contexto de tenant (ADR-013, opção A endurecida):
 *  1. recusa a chamada aninhada (withTenant dentro de um escopo AINDA ATIVO, na linhagem assíncrona dele) antes de qualquer
 *     outra coisa: ela abriria uma segunda conexão e travaria num pool de tamanho 1; use o db da chamada externa. Depois que o
 *     escopo terminou, uma continuação dele que chame withTenant é uma chamada independente e é aceita. Não cobre um
 *     listener emitido de FORA do contexto assíncrono (a detecção usa AsyncLocalStorage): esse caso segue em aberto;
 *  2. valida as opções, o tenant e confere que a identidade verificada pertence a ele, ANTES de abrir qualquer conexão;
 *     com `acquireTimeoutMs` a espera pela conexão é limitada (ConnectionAcquireTimeoutError, antes do BEGIN);
 *  3. abre uma transação e define app.tenant_id só para ela (terceiro argumento `true`: some no COMMIT/ROLLBACK);
 *  4. recusa uma conexão de superusuário ou com BYPASSRLS (falha fechada se o papel não puder ser verificado); em seguida
 *     aplica, se configurados, statement_timeout, lock_timeout e idle_in_transaction_session_timeout, locais à transação
 *     (nomes constantes, valores como parâmetros), antes da função;
 *  5. executa a função com um `db` de prazo limitado; ao terminar (ou lançar) o `db` é encerrado ANTES do COMMIT/ROLLBACK
 *     e, portanto, antes de a conexão voltar ao pool;
 *  6. se a função retornou com consultas feitas pelo `db` ainda em andamento (não aguardadas), a transação é DESFEITA e
 *     UnsettledTenantOperationError é lançado: nada é confirmado. A conexão processa os comandos em ordem, então essas
 *     consultas terminam dentro da transação, antes do ROLLBACK, e nunca depois de a conexão ser reutilizada;
 *  7. confirma (o valor da função só é devolvido se o servidor respondeu COMMIT: resposta ROLLBACK ou COMMIT rejeitado lança
 *     TransactionNotCommittedError) ou desfaz, e devolve a conexão ao pool (descartada se o ROLLBACK falhar). Depois de um
 *     COMMIT que não confirmou, o ROLLBACK de limpeza é emitido mesmo assim (inofensivo se já não há transação).
 * A ordem "consultas pendentes terminam antes do ROLLBACK" vem da fila em ordem do driver `pg` (verificada no `pg` 8.23.1);
 * com outro driver (Neon, pooler externo) isso não foi verificado.
 * Limites documentados: o RLS só aplica o valor de app.tenant_id; SQL arbitrário dentro da função ainda pode trocar o
 * tenant (L1 do harness de RLS). O encerramento só vale para o `db` fornecido aqui: código que obtenha uma conexão por
 * outro caminho não é coberto. Um teste estático impede qualquer outro arquivo de definir o contexto.
 */
export async function withTenant<T>(
  pool: PoolLike,
  identity: VerifiedIdentity,
  requestedTenantId: string,
  fn: (db: TenantDb) => Promise<T>,
  options?: WithTenantOptions,
): Promise<T> {
  if (currentScope.getStore()?.active) throw new NestedTenantContextError();
  const acquireTimeoutMs = validateMs("acquireTimeoutMs", options?.acquireTimeoutMs);
  const limits = limitsStatement(options); // valida os limites SQL antes de qualquer conexão
  const tenantId = parseTenantId(requestedTenantId);
  if (!identity.tenantIds.includes(tenantId)) throw new TenantAccessDeniedError();

  const client = await acquireClient(pool, acquireTimeoutMs);
  let broken = false;
  let scope: ReturnType<typeof scopedDb> | undefined;
  // Sessão encerrada pelo servidor durante o uso: o 'error' do cliente não pode ficar sem ouvinte (derruba o processo). O
  // erro não se perde: o próximo comando rejeita ("not queryable"), o ROLLBACK de limpeza falha e a conexão é descartada.
  const onClientError = (_error: Error): void => undefined;
  client.on?.("error", onClientError);
  try {
    await client.query("BEGIN");
    const ctx = await client.query(
      "SELECT set_config('app.tenant_id', $1, true) AS ctx, " +
        "(SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user) AS privileged",
      [tenantId],
    );
    if (ctx.rows[0]?.privileged !== false) throw new UnsafeConnectionError();
    // Limites locais da transação, depois da autorização e do contexto e ANTES da função. Se a configuração falhar, o erro
    // sobe e a função não roda. Parâmetro omitido não é tocado.
    if (limits) await client.query(limits.text, limits.values);
    const opened = scopedDb(client);
    scope = opened;
    const result = await currentScope.run(opened.state, () => fn(opened.db));
    opened.close();
    if (opened.pending() > 0) throw new UnsettledTenantOperationError();
    await commit(client);
    return result;
  } catch (error) {
    scope?.close();
    try {
      await client.query("ROLLBACK");
    } catch {
      broken = true; // a conexão não pôde desfazer: é descartada em vez de voltar ao pool
    }
    throw error;
  } finally {
    scope?.close();
    client.removeListener?.("error", onClientError);
    client.release(broken);
  }
}
