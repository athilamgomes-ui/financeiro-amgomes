#!/usr/bin/env node
/**
 * merge_fat_mensal.mjs — junta o faturamento por loja de DUAS fontes num série 1..MES_FINAL:
 *   • BASE   = meses FECHADOS já armazenados (imutáveis): fat_AAAA.json anterior, ou fat_2025_full.json.
 *   • FRESH  = mês(es) corrente(s) recém-coletado(s) do ERP (parcial): saída do coleta_amgomes_mensal.
 * O mês vindo do FRESH sempre VENCE o da BASE (é o dado mais novo). Serve para o pipeline do
 * Financeiro coletar SÓ o mês em curso e reaproveitar os fechados, sem raspar o ERP 90×/noite.
 *
 * Uso: node merge_fat_mensal.mjs --ano 2026 --mesfinal 9 --base fat_2026.json --fresh /tmp/fresh.json --out fat_2026.json
 * Exit: 0 = merge completo (todos os meses 1..MES_FINAL presentes p/ as 4 lojas).
 *       3 = INCOMPLETO (algum mês fechado faltando na base) → o .sh cai no fallback de coleta completa.
 *       2 = erro de argumento/arquivo.
 */
import fs from "node:fs";
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ANO = parseInt(arg("--ano") || "0", 10);
const MES_FINAL = parseInt(arg("--mesfinal") || "0", 10);
const BASE = arg("--base"), FRESH = arg("--fresh"), OUT = arg("--out");
const LOJAS = ["L1", "L3", "L4", "L5"];
const log = m => process.stderr.write(`[merge-fat] ${m}\n`);
if (!ANO || !MES_FINAL || !FRESH || !OUT) { log("uso: --ano --mesfinal --base --fresh --out"); process.exit(2); }

const rd = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
// mapa mes(1-12) -> valor, por loja, a partir de um objeto {meses:[...], L1:[...], ...}
function toMap(obj) {
  const map = { L1: {}, L3: {}, L4: {}, L5: {} };
  if (!obj || !Array.isArray(obj.meses)) return map;
  obj.meses.forEach((mes, i) => { for (const L of LOJAS) { const v = (obj[L] || [])[i]; if (v != null) map[L][mes] = v; } });
  return map;
}
const base = toMap(rd(BASE));    // pode não existir (primeira vez / fallback)
const fresh = toMap(rd(FRESH));
if (!Object.keys(fresh.L1).length) { log("FRESH vazio — nada coletado"); process.exit(3); }

const out = { ano: ANO, meses: [], L5: [], L4: [], L1: [], L3: [] };
let faltou = null;
for (let m = 1; m <= MES_FINAL; m++) {
  out.meses.push(m);
  for (const L of LOJAS) {
    const v = (fresh[L][m] != null) ? fresh[L][m] : base[L][m];   // fresco vence; senão base
    if (v == null) { faltou = faltou || `${L} mês ${m}`; out[L].push(0); }
    else out[L].push(v);
  }
}
if (faltou) { log(`INCOMPLETO: falta ${faltou} (base não tem o mês fechado) → fallback p/ coleta completa`); process.exit(3); }

fs.writeFileSync(OUT, JSON.stringify(out));
const origem = m => (fresh.L1[m] != null ? "ERP" : "base");
log(`OK ano=${ANO} meses=1..${MES_FINAL} · fresco=${out.meses.filter(m => fresh.L1[m] != null).join(",")} · L1=[${out.L1.join(",")}]`);
process.exit(0);
