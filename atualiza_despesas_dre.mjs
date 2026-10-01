#!/usr/bin/env node
/**
 * atualiza_despesas_dre.mjs — mantém o cache dre_despesas_2026.json (despesas por CAIXA, p/ o DRE).
 *
 * Regime = CAIXA (faturas PAGAS por mês de pagamento), escolha do Athila (01/10/2026). O
 * coleta_financeiro.mjs já coleta as faturas pagas agrupadas por Conta Débito do MÊS CORRENTE +
 * ANTERIOR e grava em financeiro_raw.json (lojas[Lx].pago.{porMes,catPorMes}). Este script, SEM
 * tocar o ERP, dobra esses 1-2 meses no cache acumulado — os meses fechados ficam congelados, o
 * corrente/anterior são re-sobrescritos a cada noite.
 *
 * Os meses de 2026 ANTERIORES ao que o financeiro coleta vêm do backfill (backfill_despesas_dre.mjs,
 * que puxa o mesmo relatório do ERP mês a mês, uma vez só).
 *
 * O cache guarda as CATEGORIAS CRUAS por mês (sem bucketizar) — o build_financeiro.mjs é a FONTE
 * ÚNICA do mapeamento categoria→bucket (mercadoria/pessoal/estrutura/impostos/financiamento/outros).
 *
 * Formato: { ano, atualizadoEm, L1:{"2026-09":{total, cats:[{nome,valor}]}, ...}, L3, L4, L5 }
 *
 * Uso: node atualiza_despesas_dre.mjs           (lê financeiro_raw.json do REPO, merge no cache)
 * Exit: 0 ok · 1 falha (financeiro_raw.json ausente/sem pago)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(DIR, "financeiro_raw.json");
const CACHE = path.join(DIR, "dre_despesas_2026.json");
const LOJAS = ["L1", "L3", "L4", "L5"];
const log = m => process.stderr.write(`[despesas-dre] ${m}\n`);

let raw; try { raw = JSON.parse(fs.readFileSync(RAW, "utf8")); } catch (e) { log("financeiro_raw.json ausente — " + e.message); process.exit(1); }
const ANO = new Date().getFullYear();
let cache; try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { cache = { ano: ANO, L1: {}, L3: {}, L4: {}, L5: {} }; }
for (const L of LOJAS) if (!cache[L]) cache[L] = {};

let n = 0;
for (const L of LOJAS) {
  const pago = raw.lojas && raw.lojas[L] && raw.lojas[L].pago;
  if (!pago || !pago.catPorMes) continue;
  for (const [mk, cats] of Object.entries(pago.catPorMes)) {
    if (!Array.isArray(cats)) continue;
    const total = (pago.porMes && pago.porMes[mk]) || cats.reduce((s, c) => s + (c.valor || 0), 0);
    cache[L][mk] = { total: Math.round(total * 100) / 100, cats: cats.map(c => ({ nome: c.nome, valor: c.valor })) };
    n++;
  }
}
cache.ano = ANO;
cache.atualizadoEm = new Date().toISOString();
fs.writeFileSync(CACHE, JSON.stringify(cache));
log(`OK: ${n} loja×mês atualizados · meses L1=[${Object.keys(cache.L1).sort().join(",")}]`);
process.exit(0);
