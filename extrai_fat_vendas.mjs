#!/usr/bin/env node
/**
 * extrai_fat_vendas.mjs — FONTE ÚNICA do faturamento mensal (unificação 30/09/2026).
 *
 * PROBLEMA: o financeiro coletava o faturamento do ERP por conta própria (coleta_amgomes_mensal),
 * enquanto o dashboard de VENDAS coleta o MESMO número. Como cada um fotografa o mês corrente em
 * horário diferente, o mês em curso divergia entre os painéis (fechados sempre batiam). Não era erro
 * de método — era timing de dois coletores independentes.
 *
 * FIX: o Vendas já publica `const fatMensal = {...}` no dashboard_amgomes.html (atual=2026, anterior=2025,
 * Venda Líquida líquida do cliente 8). Este script LÊ esse literal (arquivo local, mesma máquina) e grava
 * fat_2026.json / fat_2025.json no formato que o build_financeiro espera. Assim os dois painéis mostram
 * EXATAMENTE o mesmo faturamento (fonte única) e o financeiro não raspa mais o ERP p/ isso.
 *
 * Uso: node extrai_fat_vendas.mjs
 * Exit: 0 = fat_2026.json + fat_2025.json gravados e validados.
 *       3 = não deu p/ extrair/validar → o .sh cai no FALLBACK (coleta_amgomes_mensal incremental).
 *
 * OBS: a SAZONALIDADE (curva 2025 out-dez) continua vindo de fat_2025_full.json (12 meses); o fatMensal
 * do Vendas só tem os meses decorridos do ano. Este script NÃO toca fat_2025_full.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const VENDAS_HTML = "/Users/elkgomes/Desktop/claude/dashboard-equipe/dashboard_amgomes.html";
const LOJAS = ["L1", "L3", "L4", "L5"];
const log = m => process.stderr.write(`[extrai-fat] ${m}\n`);

function arrOf(bloco, loja) {
  const m = bloco.match(new RegExp(loja + "\\s*:\\s*\\[([-0-9,\\s]+)\\]"));
  if (!m) return null;
  return m[1].split(",").map(s => s.trim()).filter(s => s !== "").map(Number);
}
function subbloco(txt, chave) {
  // pega o {...} de atual: / anterior: (até o fechamento do objeto — o próximo "}" seguido de , ou })
  const i = txt.indexOf(chave);
  if (i < 0) return null;
  const abre = txt.indexOf("{", i);
  if (abre < 0) return null;
  let depth = 0;
  for (let j = abre; j < txt.length; j++) {
    if (txt[j] === "{") depth++;
    else if (txt[j] === "}") { depth--; if (depth === 0) return txt.slice(abre, j + 1); }
  }
  return null;
}

try {
  const html = fs.readFileSync(VENDAS_HTML, "utf8");
  const m = html.match(/const\s+fatMensal\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!m) { log("literal fatMensal não encontrado no dashboard_amgomes.html"); process.exit(3); }
  const obj = m[1];
  const anoAtual = Number((obj.match(/anoAtual\s*:\s*(\d{4})/) || [])[1]);
  const anoAnt = Number((obj.match(/anoAnterior\s*:\s*(\d{4})/) || [])[1]);
  const bAtual = subbloco(obj, "atual:");
  const bAnt = subbloco(obj, "anterior:");
  if (!anoAtual || !anoAnt || !bAtual || !bAnt) { log("cabeçalho/blocos atual|anterior incompletos"); process.exit(3); }

  function montar(bloco, ano) {
    const out = { ano, meses: null, L5: null, L4: null, L1: null, L3: null };
    let n = null;
    for (const L of LOJAS) {
      const a = arrOf(bloco, L);
      if (!a || !a.length) { log(`${ano}: loja ${L} sem array`); return null; }
      if (n === null) n = a.length; else if (a.length !== n) { log(`${ano}: ${L} tem ${a.length} meses, esperado ${n}`); return null; }
      out[L] = a;
    }
    out.meses = Array.from({ length: n }, (_, i) => i + 1);
    // validação de sanidade: todo mês fechado > 0 (o corrente pode ser pequeno mas > 0)
    for (const L of LOJAS) if (out[L].some((v, i) => !(v > 0))) { log(`${ano}: ${L} tem mês <=0 (${out[L].join(",")})`); return null; }
    return out;
  }

  const f26 = montar(bAtual, anoAtual);
  const f25 = montar(bAnt, anoAnt);
  if (!f26 || !f25) process.exit(3);
  if (f26.meses.length !== f25.meses.length) { log("atual e anterior com nº de meses diferente"); process.exit(3); }

  fs.writeFileSync(path.join(DIR, `fat_${anoAtual}.json`), JSON.stringify(f26));
  fs.writeFileSync(path.join(DIR, `fat_${anoAnt}.json`), JSON.stringify(f25));
  log(`OK: fat_${anoAtual}.json (${f26.meses.length}m, set L1=${f26.L1[8] ?? "?"}) + fat_${anoAnt}.json — fonte ÚNICA = Vendas`);
  process.exit(0);
} catch (e) {
  log("FALHA: " + (e.message || e));
  process.exit(3);
}
