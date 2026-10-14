# API de consulta do PNCP: achados da exploração inicial

Medido em 2026-10-14, com `scripts/explore-pncp.mjs`, UF SP, janela de 1 dia.
A amostra é pequena (cerca de 30 chamadas, em um único horário). Tudo que está
marcado como **não verificado** precisa de confirmação antes de virar regra.

Fonte da especificação: OpenAPI oficial em `https://pncp.gov.br/api/consulta/v3/api-docs`.

## Endpoints úteis

| Endpoint | Uso |
|---|---|
| `GET /api/consulta/v1/contratacoes/publicacao` | contratações por **data de publicação**. É o que o desenho inicial do projeto prevê. |
| `GET /api/consulta/v1/contratacoes/proposta` | contratações com **recebimento de propostas aberto**. Candidato melhor para alertas, ver abaixo. |

### Parâmetros de `publicacao`

| Parâmetro | Obrigatório | Observação |
|---|---|---|
| `dataInicial`, `dataFinal` | sim | formato `yyyyMMdd` |
| `codigoModalidadeContratacao` | **sim** | uma modalidade por chamada, então é preciso uma chamada por modalidade |
| `pagina` | sim | começa em 1 |
| `tamanhoPagina` | não | mínimo 10, **máximo 50** |
| `uf` | não | sigla, ex.: `SP` |
| `codigoMunicipioIbge`, `cnpj`, `codigoUnidadeAdministrativa`, `codigoModoDisputa`, `idUsuario` | não | |

`proposta` aceita `dataFinal` (obrigatório), `pagina` (obrigatório) e, **opcionais**,
`codigoModalidadeContratacao`, `uf` e os demais filtros acima. Não tem `dataInicial`.

Não existe parâmetro de palavra-chave, de CNAE nem de objeto em nenhum dos dois.
**Filtro por CNAE não é possível na API.** O filtro por assunto terá de ser nosso,
sobre o campo `objetoCompra`.

## Campos que a mensagem do Telegram precisa

Todos já vêm estruturados. **Não é preciso regex para prazo, valor ou modalidade.**

| Na mensagem | Campo da API | Observações |
|---|---|---|
| objeto | `objetoCompra` | texto livre, pode ter quebra de linha e tabulação |
| órgão | `orgaoEntidade.razaoSocial` e `unidadeOrgao.nomeUnidade` | |
| UF / município | `unidadeOrgao.ufSigla`, `unidadeOrgao.municipioNome` | |
| valor estimado | `valorTotalEstimado` | número; nos 100 itens medidos nunca veio nulo (não garante que nunca será) |
| prazo da proposta | `dataEncerramentoProposta` | ISO sem fuso (`2026-10-29T09:00:00`); **fuso não verificado**, provavelmente horário de Brasília |
| abertura da proposta | `dataAberturaProposta` | |
| modalidade | `modalidadeId`, `modalidadeNome` | 6 = Pregão - Eletrônico, 8 = Dispensa (verificados) |
| identificador único | `numeroControlePNCP` | ex.: `45358058000140-1-000182/2026`; é a chave para o estado de alertas já enviados |
| link | `linkSistemaOrigem` | **nulo em 9 de 50 itens (pregão) e 31 de 50 (dispensa)** |

Consequência para o link: é preciso um plano B quando `linkSistemaOrigem` é nulo.
A página pública do PNCP pode ser montada a partir de `orgaoEntidade.cnpj`,
`anoCompra` e `sequencialCompra`. O formato exato dessa URL **não foi verificado**
neste spike e fica como primeira checagem ao montar a mensagem do Telegram.

Campo sensível: `usuarioNome` traz o nome de uma pessoa ou sistema que publicou.
O script o remove da amostra salva, junto com `linkProcessoEletronico`, que pode
trazer um token de acesso (`infra_hash`, links do SEI). O campo útil para o link
continua sendo `linkSistemaOrigem`.

## `publicacao` ou `proposta`?

Para um alerta, o que importa é a licitação **ainda aceitar proposta**. O endpoint
`proposta` já devolve só isso e permite filtrar por UF sem exigir modalidade, o que
reduz o número de chamadas (e o risco do rate limit abaixo). Já `publicacao` com
janela por data é o que o desenho inicial descreve e é melhor para "o que saiu na última hora".

Decisão a tomar ao escrever o cliente HTTP, não aqui. Os dois funcionam com a mesma resposta.

## Erros e limites observados

- **429 com corpo HTML**, título "Limite de Requisições Excedido". Não é 5xx.
  Aconteceu a partir da 4ª rodada de uma rajada de 2 chamadas a cada 3 s
  (cerca de 10 chamadas em ~30 s). Sem cabeçalho `Retry-After`. A API voltou a
  responder 200 em poucos segundos (menos de ~20 s, medido de forma grosseira).
- Consequência para o cliente HTTP: tratar **429 como erro transitório**, com
  espera crescente e jitter, e **não assumir que o corpo é JSON**. O primeiro
  rascunho deste script quebrou exatamente assim: tentou ler HTML como JSON e
  perdeu o status HTTP. Resposta com `content-type` não JSON deve ser classificada
  pelo status, nunca descartada.
- **5xx: nenhum observado** nesta amostra. Isso não prova que não ocorrem; o
  briefing do projeto os trata como risco real. A taxa só aparece com o uso
  diário do workflow agendado, por isso o cliente mantém retry para 5xx.
- Latência: 100 a 1100 ms por chamada, tipicamente abaixo de 600 ms.
- `204` sem corpo é possível pela especificação (resposta sem resultados).
  Não ocorreu na amostra.

Orçamento de chamadas para o workflow horário, com a UF de teste e as modalidades
de interesse: poucas chamadas por rodada, espaçadas (por exemplo 1 a 2 s), mais
paginação quando `totalPaginas` > 1. Uma UF grande já tem várias páginas por dia
(SP: 362 pregões e 850 dispensas publicados em um dia, páginas de 50).

## Relevância para TI (nicho escolhido)

Em 100 itens (50 pregões + 50 dispensas, SP, 1 dia), **7 casaram** com uma lista
simples de termos de informática. Algo em torno de 7%, em um único dia.

Exemplos reais que o filtro precisa pegar, com o termo que os revela:

- "equipamentos de processamento, rede e armazenamento ... infraestrutura **computacional**"
  (não contém "TI" nem "informática")
- "serviço de uso de **software** para o gerenciamento ..."
- "suprimentos de **informática** (Teclado para Microcomputador ...)"
- "licença de sistema informatizado ... SAAS"
- "**Switches** PoE e Fontes PoE ..."
- "MANUTENCAO DE EQUIPAMENTOS DE **INFORMATICA**" (sem acento, caixa alta)

Lições para o filtro por palavra-chave: comparar sem acento e sem diferença de maiúscula; usar radicais
(`comput`, `inform`) e não só palavras inteiras; esperar falso positivo (ex.:
"impressora 3D industrial" casa com "impressora" mas é pesquisa científica).
A taxa de 7% é uma medida de um dia, não uma estimativa confiável.

## Respostas às perguntas abertas do desenho inicial

| Pergunta | Resposta |
|---|---|
| Prazo, valor e modalidade já vêm estruturados? | **Sim.** Regex só seria necessário para detalhes que estão apenas no texto do edital, que a API não traz. |
| Dá para filtrar por CNAE? | **Não.** Filtro por palavra-chave sobre `objetoCompra`. |
| Há link direto para o edital? | **Às vezes.** `linkSistemaOrigem` vem nulo em parte dos itens. Plano B pela página do PNCP, formato a verificar. |
| Tamanho máximo de página? | **50.** |
| O PNCP devolve 5xx? | **Não observado.** Observado **429**, com HTML. Ambos precisam de tratamento. |

Efeito no escopo: o "resumo do edital por regex" do briefing perde quase todo o
sentido, porque os dados já são estruturados. Sugestão: documentar
como decisão de design: "sem LLM e sem regex para campos que a API já entrega".
