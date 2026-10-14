import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeResponse, parseBody, redact } from "./explore-pncp.mjs";

test("429 em HTML: parseBody nao lanca, devolve trecho do corpo e o status segue em summarizeResponse", () => {
  const html = "<html>\n <head><title>Limite de Requisições Excedido</title></head>\n</html>";
  const { body, notJson } = parseBody(html);
  assert.equal(body, null);
  assert.match(notJson, /Limite de Requisições Excedido/);
  assert.equal(summarizeResponse(429, body).status, 429);
});

test("parseBody: JSON valido vira objeto e corpo vazio vira null, sem notJson", () => {
  assert.deepEqual(parseBody('{"data":[]}'), { body: { data: [] } });
  assert.deepEqual(parseBody(""), { body: null });
});

test("redact remove usuarioNome e linkProcessoEletronico e preserva o resto", () => {
  const item = { objetoCompra: "x", usuarioNome: "Fulano", linkProcessoEletronico: "https://sei/?infra_hash=abc", linkSistemaOrigem: "https://origem" };
  assert.deepEqual(redact(item), { objetoCompra: "x", linkSistemaOrigem: "https://origem" });
});

test("resposta com itens: status, quantidade, total e chaves do primeiro item", () => {
  const body = { totalRegistros: 120, data: [{ objetoCompra: "x", valorTotalEstimado: 1 }, { objetoCompra: "y" }] };
  assert.deepEqual(summarizeResponse(200, body), {
    status: 200,
    items: 2,
    totalRegistros: 120,
    firstItemKeys: ["objetoCompra", "valorTotalEstimado"],
  });
});

test("resposta vazia (204, sem corpo) devolve zero itens sem lancar erro", () => {
  assert.deepEqual(summarizeResponse(204, null), { status: 204, items: 0, totalRegistros: 0, firstItemKeys: [] });
});

test("corpo sem o campo data devolve zero itens sem lancar erro", () => {
  assert.deepEqual(summarizeResponse(500, { message: "erro" }), { status: 500, items: 0, totalRegistros: 0, firstItemKeys: [] });
});
