import { describe, expect, it } from "vitest";
import type { AlertaConfig } from "./config.ts";
import { filtrarContratacoes } from "./filtro.ts";
import type { Contratacao } from "./pncp.ts";

function contratacao(objetoCompra: string, modalidadeId: number | null = 6): Contratacao {
  const base: Contratacao = { numeroControlePNCP: `ctrl-${objetoCompra}`, objetoCompra };
  return modalidadeId === null ? base : { ...base, modalidadeId };
}

function config(palavrasChave: string[], modalidades = [6, 8]): AlertaConfig {
  return { palavrasChave, uf: "SP", modalidades };
}

// Devolve só os objetos que passaram, para os testes lerem fácil.
function passam(objetos: string[], palavrasChave: string[]): string[] {
  return filtrarContratacoes(objetos.map((o) => contratacao(o)), config(palavrasChave)).map(
    (a) => a.contratacao.objetoCompra,
  );
}

describe("filtrarContratacoes: texto", () => {
  it("casa MANUTENCAO DE EQUIPAMENTOS DE INFORMATICA com a palavra 'informática'", () => {
    const objeto = "MANUTENCAO DE EQUIPAMENTOS DE INFORMATICA";
    expect(passam([objeto], ["informática"])).toEqual([objeto]);
  });

  it("'inform*' casa 'informática' e 'informatizado' por prefixo", () => {
    const objetos = ["Suprimentos de informática", "Licença de sistema informatizado", "Merenda escolar"];
    expect(passam(objetos, ["inform*"])).toEqual([objetos[0], objetos[1]]);
  });

  it("'ti' não casa dentro de 'gestão' nem de 'projetos'", () => {
    expect(passam(["Gestão de projetos", "Serviço de TI"], ["ti"])).toEqual(["Serviço de TI"]);
  });

  it("'notebook' sem * não casa 'notebooks'", () => {
    expect(passam(["Compra de notebooks"], ["notebook"])).toEqual([]);
    expect(passam(["Compra de notebook"], ["notebook"])).toEqual(["Compra de notebook"]);
  });

  it("palavra-chave com várias palavras casa só consecutivas e na ordem", () => {
    const palavra = ["licença de software"];
    expect(passam(["Aquisição de licença de software para a prefeitura"], palavra)).toHaveLength(1);
    expect(passam(["Software com licença de uso"], palavra)).toEqual([]);
    expect(passam(["Licença e de software"], palavra)).toEqual([]);
  });

  it("pontuação colada não impede o casamento", () => {
    expect(passam(["Aquisição de software, instalação e suporte"], ["software"])).toHaveLength(1);
    expect(passam(["Contratação (software) de gestão"], ["software"])).toHaveLength(1);
  });

  it("palavra-chave com hífen casa o texto com hífen", () => {
    const objeto = "Serviço de e-mail corporativo e Wi-Fi";
    expect(passam([objeto], ["e-mail"])).toEqual([objeto]);
    expect(passam([objeto], ["wi-fi"])).toEqual([objeto]);
  });

  it("palavra-chave só com * não casa nada", () => {
    expect(passam(["Qualquer objeto"], ["*"])).toEqual([]);
  });
});

describe("filtrarContratacoes: modalidade e resultado", () => {
  it("exclui modalidade fora da lista ou ausente, mesmo com palavra-chave presente", () => {
    const itens = [
      contratacao("Compra de software", 6),
      contratacao("Compra de software", 99),
      contratacao("Compra de software", null),
    ];
    const resultado = filtrarContratacoes(itens, config(["software"]));
    expect(resultado.map((a) => a.contratacao.modalidadeId)).toEqual([6]);
  });

  it("traz as palavras-chave que casaram, na forma escrita na config", () => {
    const itens = [contratacao("Licença de software e suprimentos de informática")];
    const [alerta] = filtrarContratacoes(itens, config(["Software", "inform*", "servidor"]));
    expect(alerta!.palavras).toEqual(["Software", "inform*"]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(filtrarContratacoes([], config(["software"]))).toEqual([]);
  });
});
