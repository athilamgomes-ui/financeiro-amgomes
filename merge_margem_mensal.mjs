#!/usr/bin/env node
/**
 * merge_margem_mensal.mjs — junta a margem/CMV por loja de DUAS fontes numa série 1..MES_FINAL:
 *   • BASE  = meses FECHADOS já armazenados (imutáveis): margem_AAAA.json.
 *   • FRESH = mês(es) corrente(s) recém-coletado(s) do ERP (parcial): saída do coleta_margem_mensal.
 * O mês vindo do FRESH sempre VENCE o da BASE. Igual ao merge_fat_mensal, mas as células são
 * OBJETOS {fat,custo,custoRaw,margem,margemRaw,anomalias}, não escalares.
 *
 * Uso: node merge_margem_mensal.mjs --ano 2026 --mesfinal 10 --base margem_2026.json --fresh /tmp/fresh.json --out margem_2026.json
 * Exit: 0 = merge completo (todos os meses 1..MES_FINAL presentes p/ as 4 lojas).
 *       3 = INCOMPLETO (mês fechado faltando na base) → o .sh cai no fallback de coleta completa.
 *       2 = erro de argumento/arquivo.
 */
import fs from "node:fs";
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ANO = parseInt(arg("--ano") || "0", 10);
const MES_FINAL = parseInt(arg("--mesfinal") || "0", 10);
const BASE = arg("--base"), FRESH = arg("--fresh"), OUT = arg("--out");
const LOJAS = ["L1", "L3", "L4", "L5"];
const log = m => process.stderr.write(`[merge-margem] ${m}\n`);
if (!ANO || !MES_FINAL || !FRESH || !OUT) { log("uso: --ano --mesfinal --base --fresh --out"); process.exit(2); }

const rd = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
function toMap(obj) {
  const map = { L1: {}, L3: {}, L4: {}, L5: {} };
  if (!obj || !Array.isArray(obj.meses)) return map;
  obj.meses.forEach((mes, i) => { for (const L of LOJAS) { const v = (obj[L] || [])[i]; if (v != null) map[L][mes] = v; } });
  return map;
}
const base = toMap(rd(BASE));
const fresh = toMap(rd(FRESH));
// "vazio" = célula sem venda; conta como presente (não força fallback), mas não vence um valor real da base.
const temVenda = c => c && typeof c === "object" && (c.fat > 0);
if (!Object.keys(fresh.L1).length) { log("FRESH vazio — nada coletado"); process.exit(3); }

const out = { ano: ANO, meses: [], L1: [], L3: [], L4: [], L5: [] };
let faltou = null;
for (let m = 1; m <= MES_FINAL; m++) {
  out.meses.push(m);
  for (const L of LOJAS) {
    const f = fresh[L][m], b = base[L][m];
    // fresco com venda vence; senão base; senão fresco (mesmo vazio); senão falta
    const v = temVenda(f) ? f : (b != null ? b : (f != null ? f : null));
    if (v == null) { faltou = faltou || `${L} mês ${m}`; out[L].push({ fat: 0, custo: 0, custoRaw: 0, margem: 0, margemRaw: 0, anomalias: [] }); }
    else out[L].push(v);
  }
}
if (faltou) { log(`INCOMPLETO: falta ${faltou} (base não tem o mês fechado) → fallback`); process.exit(3); }

fs.writeFileSync(OUT, JSON.stringify(out));
log(`OK ano=${ANO} meses=1..${MES_FINAL} · fresco=${out.meses.filter(m => temVenda(fresh.L1[m])).join(",")} · L1 margem=[${out.L1.map(c => c.margem).join(",")}]`);
process.exit(0);
