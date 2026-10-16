import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EstadoError, abrirEstado } from "./estado.ts";
import type { Alerta } from "./filtro.ts";

function alerta(id: string): Alerta {
  return { contratacao: { numeroControlePNCP: id, objetoCompra: `objeto ${id}` }, palavras: ["software"] };
}

const ids = (alertas: Alerta[]) => alertas.map((a) => a.contratacao.numeroControlePNCP);

describe("estado", () => {
  it("banco novo deixa passar todos os alertas", () => {
    const estado = abrirEstado(":memory:");
    expect(ids(estado.filtrarNovos([alerta("a"), alerta("b")]))).toEqual(["a", "b"]);
    estado.fechar();
  });

  it("depois de marcarEnviado, o mesmo alerta some de filtrarNovos", () => {
    const estado = abrirEstado(":memory:");
    estado.marcarEnviado("a");
    expect(estado.filtrarNovos([alerta("a")])).toEqual([]);
    estado.fechar();
  });

  it("marcar um e deixar o outro: só o não enviado continua", () => {
    const estado = abrirEstado(":memory:");
    estado.marcarEnviado("a");
    expect(ids(estado.filtrarNovos([alerta("a"), alerta("b")]))).toEqual(["b"]);
    estado.fechar();
  });

  it("o mesmo identificador duas vezes no mesmo lote aparece uma vez, na ordem original", () => {
    const estado = abrirEstado(":memory:");
    const lote = [alerta("b"), alerta("a"), alerta("b"), alerta("c"), alerta("a")];
    expect(ids(estado.filtrarNovos(lote))).toEqual(["b", "a", "c"]);
    estado.fechar();
  });

  it("marcarEnviado duas vezes com o mesmo identificador não falha nem duplica", () => {
    const estado = abrirEstado(":memory:");
    estado.marcarEnviado("a", new Date("2026-10-15T10:00:00Z"));
    expect(() => estado.marcarEnviado("a", new Date("2026-10-16T10:00:00Z"))).not.toThrow();
    expect(estado.filtrarNovos([alerta("a")])).toEqual([]);
    estado.fechar();
  });

  it("filtrarNovos não marca nada como enviado", () => {
    const estado = abrirEstado(":memory:");
    const lote = [alerta("a")];
    expect(ids(estado.filtrarNovos(lote))).toEqual(["a"]);
    expect(ids(estado.filtrarNovos(lote))).toEqual(["a"]);
    estado.fechar();
  });
});

describe("estado em arquivo", () => {
  let pasta: string | undefined;

  afterEach(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
    pasta = undefined;
  });

  it("sobrevive a fechar e reabrir o arquivo", () => {
    pasta = mkdtempSync(join(tmpdir(), "licitai-estado-"));
    const caminho = join(pasta, "estado.db");

    const primeiro = abrirEstado(caminho);
    primeiro.marcarEnviado("a");
    primeiro.fechar();

    const segundo = abrirEstado(caminho);
    expect(ids(segundo.filtrarNovos([alerta("a"), alerta("b")]))).toEqual(["b"]);
    segundo.fechar();
  });

  it("arquivo que não é banco dá EstadoError e não deixa o arquivo travado", () => {
    pasta = mkdtempSync(join(tmpdir(), "licitai-estado-"));
    const caminho = join(pasta, "estado.db");
    writeFileSync(caminho, "isto é só texto, não um banco SQLite, mas longo o bastante para ser lido como cabeçalho");
    expect(() => abrirEstado(caminho)).toThrow(EstadoError);
    expect(() => rmSync(caminho)).not.toThrow();
  });

  it("caminho impossível dá EstadoError com a causa original", () => {
    pasta = mkdtempSync(join(tmpdir(), "licitai-estado-"));
    try {
      abrirEstado(join(pasta, "nao-existe", "estado.db"));
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(EstadoError);
      expect((erro as EstadoError).cause).toBeInstanceOf(Error);
    }
  });
});
