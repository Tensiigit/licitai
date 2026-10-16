import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Alerta } from "./filtro.ts";

export class EstadoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EstadoError";
  }
}

export class Estado {
  #banco: DatabaseSync;
  #buscar: StatementSync;
  #gravar: StatementSync;

  constructor(banco: DatabaseSync) {
    this.#banco = banco;
    this.#buscar = banco.prepare("SELECT 1 FROM enviados WHERE numero_controle = ?");
    this.#gravar = banco.prepare("INSERT OR IGNORE INTO enviados (numero_controle, enviado_em) VALUES (?, ?)");
  }

  // Tira os já enviados e os repetidos dentro do lote (proposta e publicacao podem
  // devolver a mesma licitação). Não marca nada: quem envia marca depois do envio.
  filtrarNovos(alertas: Alerta[]): Alerta[] {
    const vistos = new Set<string>();
    return alertas.filter(({ contratacao }) => {
      const id = contratacao.numeroControlePNCP;
      if (vistos.has(id)) return false;
      vistos.add(id);
      return this.#buscar.get(id) === undefined;
    });
  }

  marcarEnviado(numeroControle: string, agora: Date = new Date()): void {
    this.#gravar.run(numeroControle, agora.toISOString());
  }

  fechar(): void {
    this.#banco.close();
  }
}

export function abrirEstado(caminho: string): Estado {
  let banco: DatabaseSync | undefined;
  try {
    banco = new DatabaseSync(caminho);
    banco.exec(
      "CREATE TABLE IF NOT EXISTS enviados (numero_controle TEXT PRIMARY KEY, enviado_em TEXT NOT NULL)",
    );
    return new Estado(banco);
  } catch (erro) {
    // Sem fechar, o arquivo fica travado (no Windows nem dá para apagar).
    banco?.close();
    throw new EstadoError(`não foi possível abrir o estado em ${caminho}`, { cause: erro });
  }
}
