export class InvalidTenantIdError extends Error {
  constructor() {
    super("identificador de tenant inválido (esperado um UUID)");
    this.name = "InvalidTenantIdError";
  }
}

export class TenantAccessDeniedError extends Error {
  constructor() {
    super("a identidade verificada não pertence ao tenant solicitado");
    this.name = "TenantAccessDeniedError";
  }
}

export class UnsafeConnectionError extends Error {
  constructor() {
    super("conexão recusada: o papel do banco é superusuário, tem BYPASSRLS ou não pôde ser verificado");
    this.name = "UnsafeConnectionError";
  }
}

// Erros de ciclo de vida do contexto de tenant. O `code` é um texto estável que nunca coincide com um SQLSTATE do
// PostgreSQL (cinco caracteres), então não se confundem com erros de consulta.

/** O `db` entregue a `withTenant` foi usado depois que a execução autorizada terminou. Nada foi enviado ao banco. */
export class TenantDbClosedError extends Error {
  readonly code = "TENANT_DB_CLOSED";
  constructor() {
    super("o acesso ao banco deste tenant já foi encerrado: o db só vale dentro da função passada a withTenant");
    this.name = "TenantDbClosedError";
  }
}

/** A função retornou com consultas ainda em andamento (não aguardadas): a transação é desfeita, nunca confirmada. */
export class UnsettledTenantOperationError extends Error {
  readonly code = "TENANT_UNSETTLED_OPERATION";
  constructor() {
    super("a função retornou com consultas ainda em andamento; a transação foi desfeita (aguarde cada consulta)");
    this.name = "UnsettledTenantOperationError";
  }
}

/** withTenant dentro de withTenant: não suportado, recusado antes de abrir outra conexão. */
export class NestedTenantContextError extends Error {
  readonly code = "TENANT_NESTED_CONTEXT";
  constructor() {
    super("withTenant aninhado não é suportado: use o db da chamada externa");
    this.name = "NestedTenantContextError";
  }
}

/**
 * O COMMIT não resultou em confirmação: `withTenant` NUNCA devolve o valor da função nesse caso.
 * `outcome` diz o que se sabe sobre o estado da transação:
 *  - "rolled_back": o servidor respondeu ao COMMIT com a tag ROLLBACK (a transação já estava abortada, por exemplo porque a
 *    função capturou o erro de uma consulta e retornou normalmente). Nada foi gravado.
 *  - "unknown": o COMMIT foi rejeitado (erro do servidor ou falha de transporte) ou a resposta não pôde ser reconhecida.
 *    Se foi falha de transporte, o servidor pode ter confirmado antes de a conexão cair: o resultado real é desconhecido.
 *    Não há nova tentativa automática. O erro original fica em `cause`.
 * O `code` nunca coincide com um SQLSTATE do PostgreSQL.
 */
export class TransactionNotCommittedError extends Error {
  readonly code = "TENANT_TRANSACTION_NOT_COMMITTED";
  readonly outcome: "rolled_back" | "unknown";
  constructor(outcome: "rolled_back" | "unknown", options?: { cause?: unknown }) {
    super(
      outcome === "rolled_back"
        ? "a transação não foi confirmada: o servidor a desfez (ROLLBACK) ao receber o COMMIT; nada foi gravado"
        : "a transação não foi confirmada: o COMMIT falhou ou teve resposta desconhecida; o estado gravado é incerto",
      options,
    );
    this.name = "TransactionNotCommittedError";
    this.outcome = outcome;
  }
}

/**
 * A conexão não foi obtida do pool dentro do limite `acquireTimeoutMs`. A aquisição vem ANTES do BEGIN: nenhuma transação
 * foi iniciada e nenhum SQL foi enviado por esta chamada (não há nada a desfazer). Sem efeito colateral, mas o limite não
 * prova qual era o motivo da espera (pool saturado, espera circular, carga legítima). Não há nova tentativa automática. Se a
 * conexão chegar depois, ela é devolvida ao pool sem executar SQL. O `code` nunca coincide com um SQLSTATE.
 */
export class ConnectionAcquireTimeoutError extends Error {
  readonly code = "TENANT_CONNECTION_ACQUIRE_TIMEOUT";
  readonly acquireTimeoutMs: number;
  constructor(acquireTimeoutMs: number) {
    super(
      `a conexão não foi obtida do pool em ${acquireTimeoutMs} ms; nenhuma transação foi iniciada e nenhum SQL foi enviado`,
    );
    this.name = "ConnectionAcquireTimeoutError";
    this.acquireTimeoutMs = acquireTimeoutMs;
  }
}

/**
 * A transação FOI confirmada (o COMMIT respondeu COMMIT), mas a limpeza da conexão depois dela falhou (remover o ouvinte
 * de 'error' ou devolver a conexão ao pool lançou). A conexão é descartada. Só é lançado quando não houve falha primária: com
 * uma falha primária, o erro dela prevalece e a falha de limpeza fica em `cleanupError`. O `code` nunca coincide com um
 * SQLSTATE. Quem recebe este erro NÃO deve repetir a operação: ela já foi gravada.
 */
export class ConnectionCleanupError extends Error {
  readonly code = "TENANT_CONNECTION_CLEANUP";
  readonly committed = true;
  constructor(cause: unknown) {
    super("a transação foi CONFIRMADA, mas a limpeza da conexão falhou (a conexão foi descartada); não repita a operação", { cause });
    this.name = "ConnectionCleanupError";
  }
}

export type AuthFailureReason = "malformed" | "signature" | "expired" | "not_yet_valid" | "claims" | "tenant_claim" | "key_unavailable";

/** O token foi recusado. A mensagem nunca contém o token nem as claims; `reason` diz a categoria (sem detalhes úteis a um atacante). */
export class AuthenticationError extends Error {
  readonly code = "AUTH_INVALID_TOKEN";
  readonly reason: AuthFailureReason;
  constructor(reason: AuthFailureReason, options?: { cause?: unknown }) {
    super(`autenticação recusada (${reason})`, options);
    this.name = "AuthenticationError";
    this.reason = reason;
  }
}
