import type { AlertaConfig } from "./config.ts";
import type { Contratacao } from "./pncp.ts";

export interface Alerta {
  contratacao: Contratacao;
  palavras: string[];
}

interface Termo {
  raiz: string;
  prefixo: boolean;
}

interface PalavraChave {
  original: string;
  termos: Termo[];
}

// Minúsculas e sem acento: "INFORMATICA" e "informática" ficam iguais.
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function separarPalavras(texto: string): string[] {
  return normalizar(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((palavra) => palavra !== "");
}

// "inform*" vira o termo { raiz: "inform", prefixo: true }. Hífen e pontuação separam
// termos, como no texto da licitação: "e-mail" vira os termos "e" e "mail".
function compilar(original: string): PalavraChave {
  const termos = normalizar(original)
    .split(/[^\p{L}\p{N}*]+/u)
    .map((pedaco) => ({
      raiz: pedaco.replaceAll("*", ""),
      prefixo: pedaco.endsWith("*"),
    }))
    .filter((termo) => termo.raiz !== "");
  return { original, termos };
}

// Os termos precisam aparecer em sequência, nas palavras do objeto.
function casa(palavras: string[], chave: PalavraChave): boolean {
  const { termos } = chave;
  if (termos.length === 0) return false;
  for (let inicio = 0; inicio + termos.length <= palavras.length; inicio++) {
    const achou = termos.every((termo, i) => {
      const palavra = palavras[inicio + i]!;
      return termo.prefixo ? palavra.startsWith(termo.raiz) : palavra === termo.raiz;
    });
    if (achou) return true;
  }
  return false;
}

export function filtrarContratacoes(itens: Contratacao[], config: AlertaConfig): Alerta[] {
  const chaves = config.palavrasChave.map(compilar);
  const alertas: Alerta[] = [];
  for (const contratacao of itens) {
    if (contratacao.modalidadeId === undefined || !config.modalidades.includes(contratacao.modalidadeId)) {
      continue;
    }
    const palavras = separarPalavras(contratacao.objetoCompra);
    const casadas = chaves.filter((chave) => casa(palavras, chave)).map((chave) => chave.original);
    if (casadas.length > 0) alertas.push({ contratacao, palavras: casadas });
  }
  return alertas;
}
