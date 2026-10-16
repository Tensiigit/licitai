import { loadConfig } from "./config.ts";

const config = loadConfig("config/alertas.json");
console.log(
  `Licitaí: ${config.palavrasChave.length} palavras-chave, UF ${config.uf}, modalidades ${config.modalidades.join(", ")}`,
);
