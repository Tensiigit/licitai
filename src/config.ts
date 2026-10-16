import { readFileSync } from "node:fs";

export interface AlertaConfig {
  palavrasChave: string[];
  uf: string;
  modalidades: number[];
}

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

const UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

export function parseConfig(texto: string): AlertaConfig {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch (erro) {
    throw new ConfigError("config não é um JSON válido", { cause: erro });
  }
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    throw new ConfigError("config deve ser um objeto JSON");
  }
  const { palavrasChave, uf, modalidades } = bruto as Record<string, unknown>;

  if (
    !Array.isArray(palavrasChave) ||
    palavrasChave.length === 0 ||
    !palavrasChave.every((p) => typeof p === "string" && p.trim() !== "")
  ) {
    throw new ConfigError("palavrasChave deve ser uma lista não vazia de textos não vazios");
  }
  if (typeof uf !== "string" || !UFS.has(uf)) {
    throw new ConfigError(`uf inválida: ${String(uf)}`);
  }
  if (
    !Array.isArray(modalidades) ||
    modalidades.length === 0 ||
    !modalidades.every((m) => Number.isInteger(m))
  ) {
    throw new ConfigError("modalidades deve ser uma lista não vazia de números inteiros");
  }

  return { palavrasChave, uf, modalidades };
}

export function loadConfig(caminho: string): AlertaConfig {
  let texto: string;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch (erro) {
    throw new ConfigError(`não foi possível ler ${caminho}`, { cause: erro });
  }
  return parseConfig(texto);
}
