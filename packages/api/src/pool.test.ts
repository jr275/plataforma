import { afterEach, describe, expect, it } from "vitest";
import { createAppPool, describeConnection } from "./pool";

// O pool só abre conexões quando usado: estes testes não tocam em banco algum.
const ORIGINAL_ENV = process.env.NODE_ENV;
afterEach(() => { (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV; });

describe("createAppPool", () => {
  it("rede: exige TLS e recusa sslmode=disable e URIs inválidas", async () => {
    const p = createAppPool("postgresql://app:senha@db.exemplo.com/plataforma?sslmode=require");
    await p.end();
    expect(() => createAppPool("postgresql://app:senha@db.exemplo.com/plataforma?sslmode=disable")).toThrowError(/TLS/);
    expect(() => createAppPool("isto não é uma URI")).toThrowError(/inválida/);
    expect(() => createAppPool("mysql://a:b@h/db")).toThrowError(/inválida/);
    expect(() => createAppPool("postgresql://app:senha@db.exemplo.com/")).toThrowError(/inválida/);
  });
  it("socket Unix local: aceito fora de produção, sem TLS", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const p = createAppPool("postgresql:///plataforma?host=%2Ftmp%2Fplataforma-pg.abc&port=54329&user=menlo_app");
    await p.end();
  });
  it("socket Unix local: RECUSADO em produção", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    expect(() => createAppPool("postgresql:///plataforma?host=%2Ftmp%2Fx&user=menlo_app")).toThrowError(/produção/);
  });
  it("socket sem diretório absoluto é inválido", () => {
    expect(() => createAppPool("postgresql:///plataforma?host=relativo&user=menlo_app")).toThrowError(/inválida/);
    expect(() => createAppPool("postgresql:///plataforma?user=menlo_app")).toThrowError(/inválida/);
  });
  it("socket sem usuário é inválido", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    expect(() => createAppPool("postgresql:///plataforma?host=%2Ftmp%2Fx")).toThrowError(/inválida/);
  });
  it("a mensagem de erro nunca contém a senha nem a URI", () => {
    try { createAppPool("postgresql://app:SEGREDO123@db.exemplo.com/plataforma?sslmode=disable"); } catch (e) { expect((e as Error).message).not.toMatch(/SEGREDO123|db\.exemplo/); }
  });
});

describe("describeConnection (para a interface; sem segredos)", () => {
  it("diferencia local de remoto e não devolve usuário nem senha", () => {
    expect(describeConnection("postgresql:///plataforma?host=%2Ftmp%2Fx&user=menlo_app")).toEqual({ kind: "local", host: "socket local" });
    const r = describeConnection("postgresql://app:SEGREDO@ep-x.neon.tech/plataforma?sslmode=require")!;
    expect(r).toEqual({ kind: "remote", host: "ep-x.neon.tech" });
    expect(JSON.stringify(r)).not.toMatch(/SEGREDO|app:/);
    expect(describeConnection("lixo")).toBeUndefined();
  });
});
