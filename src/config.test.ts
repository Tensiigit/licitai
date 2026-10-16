import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseConfig } from "./config.ts";

const valida = {
  palavrasChave: ["software", "notebook"],
  uf: "SP",
  modalidades: [6, 8],
};

function texto(sobrescreve: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...valida, ...sobrescreve });
}

describe("parseConfig", () => {
  it("devolve palavras-chave, UF e modalidades como no arquivo", () => {
    expect(parseConfig(texto())).toEqual(valida);
  });

  it("rejeita UF inexistente", () => {
    expect(() => parseConfig(texto({ uf: "XX" }))).toThrow(ConfigError);
  });

  it("rejeita modalidade não numérica", () => {
    expect(() => parseConfig(texto({ modalidades: [6, "8"] }))).toThrow(ConfigError);
  });

  it("rejeita lista de modalidades vazia", () => {
    expect(() => parseConfig(texto({ modalidades: [] }))).toThrow(ConfigError);
  });

  it("rejeita lista de palavras-chave vazia", () => {
    expect(() => parseConfig(texto({ palavrasChave: [] }))).toThrow(ConfigError);
  });

  it("rejeita palavra-chave em branco", () => {
    expect(() => parseConfig(texto({ palavrasChave: ["software", "   "] }))).toThrow(ConfigError);
  });

  it("rejeita JSON que não é um objeto", () => {
    expect(() => parseConfig("[]")).toThrow(ConfigError);
  });

  it("preserva o erro original quando o JSON é inválido", () => {
    try {
      parseConfig("{ quebrado");
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(ConfigError);
      expect((erro as ConfigError).cause).toBeInstanceOf(SyntaxError);
    }
  });
});

describe("loadConfig", () => {
  it("falha com ConfigError e preserva a causa quando o arquivo não existe", () => {
    try {
      loadConfig("config/nao-existe.json");
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(ConfigError);
      expect((erro as NodeJS.ErrnoException & { cause: NodeJS.ErrnoException }).cause.code).toBe("ENOENT");
    }
  });
});
