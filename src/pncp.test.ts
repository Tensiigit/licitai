import { describe, expect, it } from "vitest";
import {
  PncpError,
  buscarPagina,
  buscarPropostas,
  buscarPublicacoes,
  formatarData,
  type Dependencias,
} from "./pncp.ts";

const HTML_429 = "<html><head><title>Limite de Requisições Excedido</title></head></html>";

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function html(corpo: string, status: number): Response {
  return new Response(corpo, { status, headers: { "content-type": "text/html" } });
}

function pagina(numeros: number[], totalPaginas = 1) {
  return {
    data: numeros.map((n) => ({ numeroControlePNCP: `ctrl-${n}`, objetoCompra: `objeto ${n}` })),
    totalPaginas,
  };
}

type Resposta = Response | Error;

// Responde na ordem; a última resposta se repete quando a fila acaba.
function falso(respostas: Resposta[]) {
  const urls: string[] = [];
  const esperas: number[] = [];
  let i = 0;
  const deps: Dependencias = {
    fetch: async (entrada) => {
      urls.push(String(entrada));
      const resposta = respostas[Math.min(i++, respostas.length - 1)]!;
      if (resposta instanceof Error) throw resposta;
      return resposta.clone();
    },
    sleep: async (ms) => {
      esperas.push(ms);
    },
    random: () => 0.5,
  };
  return { deps, urls, esperas };
}

const dataFinal = new Date("2026-10-15T15:00:00Z");

describe("formatarData", () => {
  it("usa o dia de Brasília, não o dia UTC", () => {
    // 02:30Z do dia 16 é 23:30 do dia 15 em Brasília
    expect(formatarData(new Date("2026-10-16T02:30:00Z"))).toBe("20261015");
  });

  it("formata no formato yyyyMMdd", () => {
    expect(formatarData(new Date("2026-01-05T15:00:00Z"))).toBe("20260105");
  });
});

describe("buscarPagina", () => {
  it("repete depois de 429 com corpo HTML e devolve os itens", async () => {
    const { deps, esperas, urls } = falso([html(HTML_429, 429), json(pagina([1, 2]))]);
    const resultado = await buscarPagina("https://exemplo/api", deps);
    expect(resultado.itens).toHaveLength(2);
    expect(urls).toHaveLength(2);
    expect(esperas).toHaveLength(1);
  });

  it("aumenta a espera a cada tentativa e soma o jitter", async () => {
    const { deps, esperas } = falso([
      html(HTML_429, 429),
      html(HTML_429, 429),
      html(HTML_429, 429),
      json(pagina([1])),
    ]);
    await buscarPagina("https://exemplo/api", deps);
    // base 2000 * 2^n mais jitter 0.5 * 1000
    expect(esperas).toEqual([2500, 4500, 8500]);
  });

  it("desiste de 5xx repetido depois de 4 tentativas com PncpError e status", async () => {
    const { deps, urls } = falso([html("erro", 503)]);
    await expect(buscarPagina("https://exemplo/api", deps)).rejects.toMatchObject({
      name: "PncpError",
      status: 503,
    });
    expect(urls).toHaveLength(4);
  });

  it("repete erro de rede e preserva a causa original quando esgota", async () => {
    const rede = new TypeError("fetch failed");
    const { deps, urls } = falso([rede]);
    try {
      await buscarPagina("https://exemplo/api", deps);
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(PncpError);
      expect((erro as PncpError).cause).toBe(rede);
    }
    expect(urls).toHaveLength(4);
  });

  it("repete quando a leitura do corpo trava e vira PncpError com a causa", async () => {
    const travou = new DOMException("The operation timed out", "TimeoutError");
    const travada = new Response("{}", { status: 200 });
    travada.text = async () => {
      throw travou;
    };
    const { deps, urls } = falso([travada]);
    deps.fetch = async (entrada) => {
      urls.push(String(entrada));
      return travada;
    };
    try {
      await buscarPagina("https://exemplo/api", deps);
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(PncpError);
      expect((erro as PncpError).cause).toBe(travou);
    }
    expect(urls).toHaveLength(4);
  });

  it("não repete um 400", async () => {
    const { deps, urls } = falso([html("pedido inválido", 400)]);
    await expect(buscarPagina("https://exemplo/api", deps)).rejects.toMatchObject({ status: 400 });
    expect(urls).toHaveLength(1);
  });

  it("transforma 200 com corpo HTML em PncpError, sem SyntaxError cru", async () => {
    const { deps } = falso([html("<html>manutenção</html>", 200)]);
    try {
      await buscarPagina("https://exemplo/api", deps);
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(PncpError);
      expect((erro as PncpError).status).toBe(200);
    }
  });

  it("devolve lista vazia no 204", async () => {
    const { deps } = falso([new Response(null, { status: 204 })]);
    expect(await buscarPagina("https://exemplo/api", deps)).toEqual({ itens: [], totalPaginas: 0 });
  });
});

describe("buscarPropostas", () => {
  it("junta todas as páginas até totalPaginas", async () => {
    const { deps, urls } = falso([
      json(pagina([1, 2], 3)),
      json(pagina([3, 4], 3)),
      json(pagina([5], 3)),
    ]);
    const resultado = await buscarPropostas({ uf: "SP", dataFinal }, deps);
    expect(resultado.itens.map((i) => i.numeroControlePNCP)).toEqual([
      "ctrl-1",
      "ctrl-2",
      "ctrl-3",
      "ctrl-4",
      "ctrl-5",
    ]);
    expect(resultado.falhas).toEqual([]);
    expect(urls).toHaveLength(3);
  });

  it("monta a URL com dataFinal e uf, sem dataInicial", async () => {
    const { deps, urls } = falso([json(pagina([1]))]);
    await buscarPropostas({ uf: "SP", dataFinal }, deps);
    const url = new URL(urls[0]!);
    expect(url.pathname).toBe("/api/consulta/v1/contratacoes/proposta");
    expect(url.searchParams.get("dataFinal")).toBe("20261015");
    expect(url.searchParams.get("uf")).toBe("SP");
    expect(url.searchParams.get("pagina")).toBe("1");
    expect(url.searchParams.get("tamanhoPagina")).toBe("50");
    expect(url.searchParams.has("dataInicial")).toBe(false);
  });

  it("guarda a página que falha de vez em falhas e devolve as outras", async () => {
    const { deps } = falso([json(pagina([1], 3)), html("erro", 400), json(pagina([3], 3))]);
    const resultado = await buscarPropostas({ uf: "SP", dataFinal }, deps);
    expect(resultado.itens.map((i) => i.numeroControlePNCP)).toEqual(["ctrl-1", "ctrl-3"]);
    expect(resultado.falhas).toHaveLength(1);
    expect(resultado.falhas[0]!.descricao).toContain("pagina 2");
    expect(resultado.falhas[0]!.erro).toBeInstanceOf(PncpError);
  });

  it("espera entre as chamadas para respeitar o limite da API", async () => {
    const { deps, esperas } = falso([json(pagina([1], 2)), json(pagina([2], 2))]);
    await buscarPropostas({ uf: "SP", dataFinal }, deps);
    expect(esperas).toEqual([1500]);
  });
});

describe("buscarPublicacoes", () => {
  const filtro = {
    uf: "SP",
    modalidades: [6, 8],
    dataInicial: new Date("2026-10-14T15:00:00Z"),
    dataFinal,
  };

  it("faz uma busca por modalidade e junta os itens", async () => {
    const { deps, urls } = falso([json(pagina([1])), json(pagina([2]))]);
    const resultado = await buscarPublicacoes(filtro, deps);
    expect(resultado.itens.map((i) => i.numeroControlePNCP)).toEqual(["ctrl-1", "ctrl-2"]);
    const primeira = new URL(urls[0]!);
    expect(primeira.pathname).toBe("/api/consulta/v1/contratacoes/publicacao");
    expect(primeira.searchParams.get("dataInicial")).toBe("20261014");
    expect(primeira.searchParams.get("dataFinal")).toBe("20261015");
    expect(primeira.searchParams.get("codigoModalidadeContratacao")).toBe("6");
    expect(new URL(urls[1]!).searchParams.get("codigoModalidadeContratacao")).toBe("8");
  });

  it("uma modalidade que falha não derruba a outra", async () => {
    const { deps } = falso([html("erro", 400), json(pagina([2]))]);
    const resultado = await buscarPublicacoes(filtro, deps);
    expect(resultado.itens).toHaveLength(1);
    expect(resultado.falhas).toHaveLength(1);
    expect(resultado.falhas[0]!.descricao).toContain("modalidade 6");
  });
});
