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
