// Spike: explora a API de consulta do PNCP e imprime status, tempo e forma da resposta.
// Descartavel: o cliente de producao sera um modulo separado. Sem dependencias, Node 18+.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = "https://pncp.gov.br/api/consulta";

const HELP = `uso: node scripts/explore-pncp.mjs [opcoes]
  --endpoint publicacao|proposta   (padrao: publicacao)
  --uf SP                          filtra por UF (opcional)
  --modalidades 6,8                codigos de modalidade (padrao: 6,8; publicacao exige um)
  --dias 1                         janela de publicacao, em dias para tras (padrao: 1)
  --repeat 1 --delay 2000          repete a rodada N vezes, esperando delay ms entre elas
  --save docs/samples/x.json       salva uma amostra reduzida da primeira resposta com itens
  --help`;

export function summarizeResponse(status, body) {
  const data = Array.isArray(body?.data) ? body.data : [];
  return {
    status,
    items: data.length,
    totalRegistros: body?.totalRegistros ?? 0,
    firstItemKeys: data.length > 0 ? Object.keys(data[0]) : [],
  };
}

// Corpo que nao e JSON (ex.: a pagina HTML do 429) nao pode derrubar a leitura nem apagar o status.
export function parseBody(text) {
  if (!text) return { body: null };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: null, notJson: text.replace(/\s+/g, " ").slice(0, 160) };
  }
}

function parseArgs(argv) {
  const args = { endpoint: "publicacao", modalidades: "6,8", dias: 1, repeat: 1, delay: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    args[key] = key === "help" ? true : argv[++i];
  }
  return args;
}

const yyyymmdd = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");

function buildUrl(args, modalidade) {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - Number(args.dias) * 86400000);
  const q = new URLSearchParams({ pagina: "1", tamanhoPagina: "50" });
  if (args.endpoint === "proposta") {
    q.set("dataFinal", yyyymmdd(hoje));
  } else {
    q.set("dataInicial", yyyymmdd(inicio));
    q.set("dataFinal", yyyymmdd(hoje));
  }
  q.set("codigoModalidadeContratacao", modalidade);
  if (args.uf) q.set("uf", args.uf);
  return `${BASE}/v1/contratacoes/${args.endpoint}?${q}`;
}

// Amostra publica reduzida: usuarioNome e nome de pessoa; linkProcessoEletronico pode trazer token (infra_hash).
export function redact(item) {
  const { usuarioNome, linkProcessoEletronico, ...rest } = item;
  return rest;
}

async function callOnce(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    const { body, notJson } = parseBody(text);
    return { ms: Date.now() - t0, summary: summarizeResponse(res.status, body), body, contentType, notJson, retryAfter: res.headers.get("retry-after") };
  } catch (cause) {
    return { ms: Date.now() - t0, error: cause.cause?.code ?? cause.name, message: cause.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  let saved = false;
  for (let round = 1; round <= Number(args.repeat); round++) {
    for (const modalidade of args.modalidades.split(",")) {
      const url = buildUrl(args, modalidade);
      const r = await callOnce(url);
      const when = new Date().toISOString();
      if (r.error) {
        console.log(`${when} rodada=${round} modalidade=${modalidade} ERRO=${r.error} ${r.ms}ms ${r.message}`);
        continue;
      }
      const s = r.summary;
      if (r.notJson !== undefined) {
        console.log(`${when} rodada=${round} modalidade=${modalidade} status=${s.status} NAO-JSON content-type="${r.contentType}" retry-after=${r.retryAfter} ${r.ms}ms corpo="${r.notJson}"`);
        continue;
      }
      console.log(`${when} rodada=${round} modalidade=${modalidade} status=${s.status} itens=${s.items} total=${s.totalRegistros} ${r.ms}ms`);
      if (args.save && !saved && s.items > 0) {
        const sample = { ...r.body, data: r.body.data.slice(0, 5).map(redact) };
        writeFileSync(args.save, JSON.stringify(sample, null, 2));
        saved = true;
        console.log(`amostra salva em ${args.save}`);
      }
    }
    if (round < Number(args.repeat)) await new Promise((ok) => setTimeout(ok, Number(args.delay)));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
