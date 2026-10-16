const BASE = "https://pncp.gov.br/api/consulta/v1/contratacoes";
const TAMANHO_PAGINA = 50;
const MAX_TENTATIVAS = 4;
const ESPERA_BASE_MS = 2000;
const JITTER_MS = 1000;
const INTERVALO_ENTRE_CHAMADAS_MS = 1500;
const TIMEOUT_MS = 30_000;

export interface Contratacao {
  numeroControlePNCP: string;
  objetoCompra: string;
  valorTotalEstimado?: number | null;
  dataEncerramentoProposta?: string | null;
  linkSistemaOrigem?: string | null;
  modalidadeId?: number;
  modalidadeNome?: string;
  [campo: string]: unknown;
}

export class PncpError extends Error {
  status: number | undefined;

  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options);
    this.name = "PncpError";
    this.status = options?.status;
  }
}

export interface Falha {
  descricao: string;
  erro: PncpError;
}

export interface Resultado {
  itens: Contratacao[];
  falhas: Falha[];
}

export interface Dependencias {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A API trabalha com a data de Brasília; toISOString daria o dia UTC.
export function formatarData(data: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(data)
    .replaceAll("-", "");
}

const transitorio = (status: number) => status === 429 || status >= 500;

export async function buscarPagina(
  url: string,
  deps: Dependencias = {},
): Promise<{ itens: Contratacao[]; totalPaginas: number }> {
  const chamar = deps.fetch ?? fetch;
  const esperar = deps.sleep ?? dormir;
  const sorteio = deps.random ?? Math.random;

  let ultimoErro: PncpError | undefined;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    if (tentativa > 1) {
      await esperar(ESPERA_BASE_MS * 2 ** (tentativa - 2) + sorteio() * JITTER_MS);
    }

    // O corpo é lido como texto: nem toda resposta do PNCP é JSON. A leitura fica
    // no mesmo try porque o timeout também cobre o corpo e é uma falha de rede.
    let resposta: Response;
    let texto: string;
    try {
      resposta = await chamar(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      texto = await resposta.text();
    } catch (erro) {
      ultimoErro = new PncpError("falha de rede ao chamar o PNCP", { cause: erro });
      continue;
    }

    if (resposta.status === 204) return { itens: [], totalPaginas: 0 };
    if (transitorio(resposta.status)) {
      ultimoErro = new PncpError(`PNCP respondeu ${resposta.status}`, { status: resposta.status });
      continue;
    }
    if (!resposta.ok) {
      throw new PncpError(`PNCP respondeu ${resposta.status}`, { status: resposta.status });
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch (erro) {
      throw new PncpError("PNCP devolveu um corpo que não é JSON", {
        status: resposta.status,
        cause: erro,
      });
    }
    const { data, totalPaginas } = (corpo ?? {}) as { data?: unknown; totalPaginas?: unknown };
    if (!Array.isArray(data) || typeof totalPaginas !== "number") {
      throw new PncpError("resposta do PNCP sem data e totalPaginas", { status: resposta.status });
    }
    return { itens: data as Contratacao[], totalPaginas };
  }
  throw ultimoErro;
}

async function buscarTodas(
  descricao: string,
  endpoint: string,
  parametros: URLSearchParams,
  deps: Dependencias,
  primeiraChamada: boolean,
): Promise<Resultado> {
  const esperar = deps.sleep ?? dormir;
  const resultado: Resultado = { itens: [], falhas: [] };
  let totalPaginas = 1;

  for (let pagina = 1; pagina <= totalPaginas; pagina++) {
    if (pagina > 1 || !primeiraChamada) await esperar(INTERVALO_ENTRE_CHAMADAS_MS);
    const consulta = new URLSearchParams(parametros);
    consulta.set("pagina", String(pagina));
    consulta.set("tamanhoPagina", String(TAMANHO_PAGINA));
    try {
      const lida = await buscarPagina(`${BASE}/${endpoint}?${consulta}`, deps);
      resultado.itens.push(...lida.itens);
      totalPaginas = lida.totalPaginas;
    } catch (erro) {
      resultado.falhas.push({ descricao: `${descricao}, pagina ${pagina}`, erro: erro as PncpError });
      // Sem a primeira página não se sabe quantas existem.
      if (pagina === 1) break;
    }
  }
  return resultado;
}

export function buscarPropostas(
  filtro: { uf: string; dataFinal: Date },
  deps: Dependencias = {},
): Promise<Resultado> {
  const parametros = new URLSearchParams({ dataFinal: formatarData(filtro.dataFinal), uf: filtro.uf });
  return buscarTodas(`proposta ${filtro.uf}`, "proposta", parametros, deps, true);
}

export async function buscarPublicacoes(
  filtro: { uf: string; modalidades: number[]; dataInicial: Date; dataFinal: Date },
  deps: Dependencias = {},
): Promise<Resultado> {
  const total: Resultado = { itens: [], falhas: [] };
  for (const [i, modalidade] of filtro.modalidades.entries()) {
    const parametros = new URLSearchParams({
      dataInicial: formatarData(filtro.dataInicial),
      dataFinal: formatarData(filtro.dataFinal),
      codigoModalidadeContratacao: String(modalidade),
      uf: filtro.uf,
    });
    const parcial = await buscarTodas(`modalidade ${modalidade}`, "publicacao", parametros, deps, i === 0);
    total.itens.push(...parcial.itens);
    total.falhas.push(...parcial.falhas);
  }
  return total;
}
