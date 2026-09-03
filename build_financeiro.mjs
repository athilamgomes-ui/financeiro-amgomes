#!/usr/bin/env node
/**
 * build_financeiro.mjs — ÚNICO escritor do dashboard_financeiro.html.
 * Lê financeiro_raw.json (pagar/receber por loja) + fat_2026.json + fat_2025.json
 * e renderiza o painel com dados EMBUTIDOS (sem Supabase; padrão vendas/compras).
 *
 * Uso: node build_financeiro.mjs
 * Exit: 0 ok · 20 build falhou (o .sh restaura a versão anterior).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ── senha do painel (NUNCA vai pro repo): env ou Keychain (amgomes-financeiro / financeiro-web) ──
function getSenha() {
  if (process.env.FINANCEIRO_SENHA) return process.env.FINANCEIRO_SENHA;
  try { return execSync('security find-generic-password -a financeiro-web -s amgomes-financeiro -w', { stdio: ["ignore", "pipe", "ignore"] }).toString().replace(/\n$/, ""); }
  catch { return null; }
}
const ITERS = 200000;
function cifrar(plain, senha) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(senha, salt, ITERS, 32, "sha256");
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return { salt: salt.toString("base64"), iv: iv.toString("base64"), data: Buffer.concat([ct, tag]).toString("base64"), iters: ITERS };
}
const rd = f => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const fin = rd("financeiro_raw.json");
const fat26 = rd("fat_2026.json");
const fat25 = rd("fat_2025.json");
const r2c = n => Math.round((n || 0) * 100) / 100;

// ── EM TRÂNSITO: pedidos ENVIADO/FATURADO ainda NÃO lançados no ERP (caixa já comprometido) ──
// Espelho da tela de pedidos: ela grava o comprometido (já com anti-duplicação _noERP) em
// pedidos_comprometido; aqui só lemos e mapeamos as praças p/ loja (Altamira ÷2 entre L1 e L4).
const SB_URL = "https://valhewbvjwdkkvuejrxa.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhbGhld2J2andka2t2dWVqcnhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MzEwMTgsImV4cCI6MjA5NzMwNzAxOH0.DhQaFpQ1Ca-W8Od6jl3KatGai_shXOoc14Fqk7P3lK4";
async function fetchEmTransito() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pedidos_comprometido?id=eq.1&select=dados,atualizado_em`,
      { headers: { apikey: SB_ANON, Authorization: "Bearer " + SB_ANON }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const row = (await r.json())[0];
    const plm = row && row.dados && row.dados.porLojaMes;
    if (!plm) return null;
    const out = { L1: {}, L3: {}, L4: {}, L5: {} };
    const add = (dst, obj, f = 1) => { for (const [mk, v] of Object.entries(obj || {})) dst[mk] = r2c((dst[mk] || 0) + v * f); };
    add(out.L1, plm.ALTAMIRA, 0.5); add(out.L4, plm.ALTAMIRA, 0.5);  // Altamira = L1+L4 (½ cada)
    add(out.L3, plm.ITAITUBA, 1); add(out.L5, plm.SANTAREM, 1);
    return { porLoja: out, atualizadoEm: row.atualizado_em || null };
  } catch { return null; }
}
const emTransito = await fetchEmTransito();
const transitoEmBR = (emTransito && emTransito.atualizadoEm) ? new Date(emTransito.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

// ── util ──
const pad = n => String(n).padStart(2, "0");
const now = new Date();
const HOJE = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const MES_ATUAL = HOJE.slice(0, 7);
const MES_ANT = (() => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();
const MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const r0 = n => Math.round(n || 0);
const fmt = n => (n < 0 ? "-" : "") + "R$ " + r0(Math.abs(n)).toLocaleString("pt-BR");
const fmtK = n => { const a = Math.abs(n); const s = n < 0 ? "-" : ""; if (a >= 1000) return s + "R$ " + (a / 1000).toLocaleString("pt-BR", { maximumFractionDigits: a >= 10000 ? 0 : 1 }) + "k"; return s + "R$ " + r0(a); };
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const fmtPct = (n, d = 1) => (n >= 0 ? "" : "-") + Math.abs(n).toFixed(d).replace(".", ",") + "%";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LOJAS = [
  { key: "L1", nome: "Casa da Beleza", cidade: "Altamira", cor: "#6366f1" },
  { key: "L3", nome: "Casa da Beleza", cidade: "Itaituba", cor: "#0ea5e9" },
  { key: "L4", nome: "MissBeleza", cidade: "Altamira", cor: "#8b5cf6" },
  { key: "L5", nome: "MissBeleza", cidade: "Santarém", cor: "#ec4899" },
];

// ── mapeamento categoria (Conta Débito) → bucket do DRE ──
function bucketOf(nome) {
  const n = nome.toUpperCase();
  if (/MERCADORIA|REVENDA|FORNECEDORES DIVERSOS/.test(n)) return "mercadoria";
  if (/SAL[ÁA]RIO|FGTS|INSS|VALE|F[ÉE]RIAS|13|RESCIS|PRO.?LABORE|COMISS|FOLHA|PESSOAL/.test(n)) return "pessoal";
  if (/IMPOSTO|ICMS|PIS|COFINS|SIMPLES|ISS|IRPJ|CSLL|TRIBUT|IPI|IRRF|DAS\b|TAXA/.test(n)) return "impostos";
  if (/ALUGU|CONDOM|ENERGIA|[ÁA]GUA|SANEAMENTO|INTERNET|TELEFON|SISTEMA|SOFTWARE|SEGURAN|LIMPEZA|MANUTEN|ESCRIT[ÓO]RIO/.test(n)) return "estrutura";
  if (/FINANCIAMENTO|EMPR[ÉE]STIMO|JUROS|ENCARGO|BANC[ÁA]RI/.test(n)) return "financiamento";
  return "outros"; // assessoria contábil, publicidade, serviços profissionais, fretes...
}
const BUCKETS = [
  { key: "mercadoria", label: "Mercadoria (compras)", cor: "#6366f1" },
  { key: "pessoal", label: "Pessoal (folha, encargos)", cor: "#ec4899" },
  { key: "estrutura", label: "Estrutura (aluguel, energia, sistemas)", cor: "#f59e0b" },
  { key: "impostos", label: "Impostos", cor: "#ef4444" },
  { key: "financiamento", label: "Financiamento", cor: "#14b8a6" },
  { key: "outros", label: "Serviços & outros", cor: "#94a3b8" },
];
// custo fixo = folha + ocupação/estrutura + serviços (NÃO mercadoria, NÃO impostos variáveis, NÃO financiamento)
const FIXO_BUCKETS = new Set(["pessoal", "estrutura", "outros"]);

// ── config SENSÍVEL (fora do repo público; ver financeiro_config.example.json) ──
// Este script vai pro GitHub público, então valores privados (parcela de financiamento,
// dívida entre lojas) NÃO ficam aqui — vêm de financeiro_config.json (gitignored).
const CFG = (() => { try { return rd("financeiro_config.json"); } catch { return {}; } })();

// ── ENTRADA LÍQUIDA: desconto de cartão ──────────────────────────────────────
// O grupo antecipa 100% em D+1, mas a maquininha cobra taxa. Fonte da taxa: dashboard
// de Conferência de Caixa, bloco "Taxa efetiva por plano" (média ponderada real).
const TAXA_CARTAO = CFG.taxaCartao ?? 0.0268;    // taxa efetiva média ponderada (default 2,68%)
const SHARE_CARTAO = CFG.shareCartao ?? 0.45;    // fatia do faturamento em cartão (default 45%)
const CORTE_CARTAO = SHARE_CARTAO * TAXA_CARTAO; // ≈ 1,2% sobre o faturamento total
const liquido = bruto => bruto * (1 - CORTE_CARTAO);

// ── compromissos que o ERP NÃO enxerga (valores só no config gitignored) ─────
// Financiamento Caixa Econômica de Altamira (L1+L4), pago por fora do ERP, dia fixo.
const CAIXA_PARCELA = CFG.caixaParcela || null;  // { valor, dia, lojas:[...] } ou null (desliga)
// Dívida entre lojas (única vencida do grupo). Não aparece no ERP.
const DIVIDA_INTERNA = CFG.dividaInterna || null; // { devedor, credor, total, vencido, desde } ou null

// ── faturamento mensal COMPLETO de 2025 (12 meses) p/ sazonalidade do Q4 ──────
// Arquivo de dado (gitignored). Se ausente, a projeção cai no ritmo achatado (fallback honesto).
const fat25full = (() => { try { return rd("fat_2025_full.json"); } catch { return null; } })();
const TEM_SAZONAL = !!(fat25full && fat25full.L1 && fat25full.L1.length >= 12);
const somaN = (arr, n) => (arr || []).slice(0, n).reduce((s, v) => s + (v || 0), 0);
// crescimento YTD por loja (meses fechados Jan–Jul: índices 0..6) = 2026 / 2025
function crescLoja(key) {
  if (!TEM_SAZONAL) return 1;
  const a = somaN(fat26[key], 7), b = somaN(fat25full[key], 7);
  return b > 0 ? a / b : 1;
}
// projeção de faturamento de um mês futuro de 2026 = faturamento 2025 daquele mês × crescimento
function projMesLoja(key, mes1a12) {
  if (!TEM_SAZONAL) return 0;
  return (fat25full[key][mes1a12 - 1] || 0) * crescLoja(key);
}
const diasNoMes = (y, m) => new Date(y, m, 0).getDate(); // m 1-12
function diasDaSemana(k) { const [y, m, d] = k.split("-").map(Number); const out = []; let dt = new Date(y, m - 1, d); for (let i = 0; i < 7; i++) { out.push(dt); dt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1); } return out; }
// entrada BRUTA projetada da semana p/ uma loja: mês corrente = ritmo real; meses à frente = projeção sazonal
function entradaBrutaSemanaLoja(key, k, ritmoDia) {
  let g = 0;
  for (const dt of diasDaSemana(k)) {
    const ym = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
    if (ym < MES_ATUAL) continue;                    // dia já passado
    if (ym === MES_ATUAL || !TEM_SAZONAL) { g += ritmoDia; continue; } // mês em curso (ou sem base 2025): ritmo real
    const mesN = dt.getMonth() + 1;
    g += projMesLoja(key, mesN) / diasNoMes(dt.getFullYear(), mesN);   // futuro: run-rate sazonal
  }
  return g;
}
// metade da parcela da Caixa (L1+L4) se o dia 16 cai nesta semana e a loja participa
function caixaSemanaLoja(key, k) {
  if (!CAIXA_PARCELA || !CAIXA_PARCELA.lojas.includes(key)) return 0;
  return diasDaSemana(k).some(dt => dt.getDate() === CAIXA_PARCELA.dia) ? CAIXA_PARCELA.valor / CAIXA_PARCELA.lojas.length : 0;
}

// ── semanas do fluxo: da segunda desta semana, 13 semanas ──
function segundaISO(d) { const dow = (d.getDay() + 6) % 7; const s = new Date(d); s.setDate(d.getDate() - dow); return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`; }
// da segunda desta semana até a semana que contém 31/dez (alcança o Q4 inteiro)
const SEMANAS = (() => { const arr = []; let s = new Date(now); const dow = (s.getDay() + 6) % 7; s.setDate(s.getDate() - dow); const fim = new Date(now.getFullYear(), 11, 31); while (s <= fim) { arr.push(`${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`); s.setDate(s.getDate() + 7); } return arr; })();
const semLabel = k => { const [y, m, d] = k.split("-"); return `${d}/${m}`; };
// meses do fluxo: do mês corrente até dez/ano-corrente
const MESES_FLUXO = (() => { const arr = []; for (let mo = now.getMonth() + 1; mo <= 12; mo++) arr.push(`${now.getFullYear()}-${pad(mo)}`); return arr; })();
const mesLabelYM = ym => { const [y, m] = ym.split("-"); return `${MESES_PT[+m - 1]}/${y.slice(2)}`; };

// ── modelo por loja ──
function modeloLoja(key, idx) {
  const raw = fin.lojas[key] || {};
  const pagar = raw.pagar || { categorias: [], porMes: {}, porSemana: {}, topContrapartes: [], abertoValor: 0, atrasadoValor: 0, atrasadoQtd: 0 };
  const receber = raw.receber || { porMes: {}, porSemana: {}, topContrapartes: [], abertoValor: 0, atrasadoValor: 0, atrasadoQtd: 0 };
  const meses = fat26.meses;
  const serie26 = fat26[key] || [], serie25 = fat25[key] || [];
  const iAtual = meses.length - 1;
  const fatAtual = serie26[iAtual] || 0, fatAnt = serie26[iAtual - 1] || 0;
  const fat25Atual = serie25[iAtual] || 0;
  const diaAtual = now.getDate();
  const ritmoDia = diaAtual ? fatAtual / diaAtual : 0; // ritmo de vendas do mês em curso
  // DRE buckets (janela)
  const buckets = {}; for (const b of BUCKETS) buckets[b.key] = 0;
  let totalDespesa = 0;
  for (const c of pagar.categorias) { buckets[bucketOf(c.nome)] += c.valor; totalDespesa += c.valor; }
  // resultado de caixa por mês (fat − contas a pagar por vencimento no mês)
  const pagarMes = (pagar.porMes[MES_ATUAL] || {}).total || 0;
  const pagarMesAnt = (pagar.porMes[MES_ANT] || {}).total || 0;
  const resAtual = fatAtual - pagarMes;
  const resAnt = fatAnt - pagarMesAnt;
  // FATURAS PAGAS (saída real de caixa) por mês de pagamento
  const pagoPorMes = (raw.pago && raw.pago.porMes) || {};
  const pagoMesAtual = pagoPorMes[MES_ATUAL] || 0;
  const pagoMesAnt = pagoPorMes[MES_ANT] || 0;
  // CUSTO FIXO por mês = valor A VENCER com Centro de Custo = "Custo Fixo" (cc) do ERP.
  // É EXATAMENTE o relatório Faturas a Pagar → Centro de Custo = Custo Fixo (o que o usuário confere).
  // Meses já pagos não têm "a vencer" (o relatório não mostra pagas) → aparecem em "Já pago", não aqui.
  const cfAberto = (raw.custoFixoAberto && raw.custoFixoAberto.porMes) || {};
  const custoFixoPorMes = {};
  for (const [mk, v] of Object.entries(cfAberto)) custoFixoPorMes[mk] = r0(v);
  // fluxo semanal: ENTRA = faturamento projetado (sazonal) LÍQUIDO de cartão; SAI = a-pagar por vencimento + parcela Caixa
  const fluxo = SEMANAS.map(k => {
    const saiErp = pagar.porSemana[k] || 0;
    const caixa = caixaSemanaLoja(key, k);
    const entraBruta = entradaBrutaSemanaLoja(key, k, ritmoDia);
    const entra = liquido(entraBruta);
    return { k, sai: saiErp + caixa, saiErp, caixa, entraBruta, entra };
  });
  // ── modelo MENSAL (mês corrente → dez): entrada líquida vs compromisso, com custo fixo RESERVADO ──
  // Piso = maior custo fixo (cc) já lançado entre os meses conhecidos — proxy do custo fixo mensal cheio.
  // Meses distantes têm só o recorrente lançado (falta folha etc.); reservar o piso evita superestimar a sobra.
  const baseFixo = Math.max(0, ...Object.values(custoFixoPorMes));
  const caixaMes = (CAIXA_PARCELA && CAIXA_PARCELA.lojas.includes(key)) ? CAIXA_PARCELA.valor / CAIXA_PARCELA.lojas.length : 0;
  // em trânsito (pedidos não lançados no ERP) desta loja, por mês
  const transitoPorMes = (emTransito && emTransito.porLoja[key]) || {};
  const transitoTotal = Object.values(transitoPorMes).reduce((s, v) => s + v, 0);
  const mensal = MESES_FLUXO.map(ym => {
    const y = +ym.slice(0, 4), mesN = +ym.slice(5);
    const emCurso = ym === MES_ATUAL;
    const entraBruta = (emCurso || !TEM_SAZONAL) ? ritmoDia * diasNoMes(y, mesN) : projMesLoja(key, mesN);
    const entra = liquido(entraBruta);
    const fixoLanc = custoFixoPorMes[ym] || 0;
    const fixoEsp = Math.max(fixoLanc, baseFixo);          // reserva o piso p/ meses incompletos
    const totalPagar = (pagar.porMes[ym] || {}).total || 0;
    const outros = Math.max(0, totalPagar - fixoLanc);     // variável já lançado (mercadoria, impostos…)
    const transito = transitoPorMes[ym] || 0;              // pedidos em trânsito (comprometido, fora do ERP)
    const compromisso = fixoEsp + outros + caixaMes + transito;
    return { ym, emCurso, entra, fixoEsp, fixoLanc, outros, caixa: caixaMes, transito, compromisso, cabe: entra - compromisso };
  });
  return {
    mensal, baseFixo, transitoPorMes, transitoTotal,
    key, meses, serie26, serie25, iAtual, fatAtual, fatAnt, fat25Atual, ritmoDia,
    buckets, totalDespesa,
    pagarAberto: pagar.abertoValor, pagarAtrasado: pagar.atrasadoValor, pagarAtrasadoQtd: pagar.atrasadoQtd,
    receberAberto: receber.abertoValor, receberAtrasado: receber.atrasadoValor, receberAtrasadoQtd: receber.atrasadoQtd,
    pagarMes, pagarMesAnt, resAtual, resAnt,
    pagoPorMes, pagoMesAtual, pagoMesAnt, custoFixoPorMes,
    pagarPorMes: pagar.porMes, receberPorMes: receber.porMes,
    topFornecedores: pagar.topContrapartes, topClientes: receber.topContrapartes,
    fluxo, pctMercadoria: pct(buckets.mercadoria, totalDespesa),
  };
}
const M = {}; LOJAS.forEach((l, i) => { M[l.key] = modeloLoja(l.key, i); });

// grupo consolidado
function modeloGrupo() {
  const g = { buckets: {}, fluxo: SEMANAS.map(k => ({ k, sai: 0, saiErp: 0, caixa: 0, entra: 0, entraBruta: 0 })), mensal: MESES_FLUXO.map(ym => ({ ym, emCurso: ym === MES_ATUAL, entra: 0, fixoEsp: 0, fixoLanc: 0, outros: 0, caixa: 0, transito: 0, compromisso: 0, cabe: 0 })), pagarPorMes: {}, receberPorMes: {}, pagoPorMes: {}, custoFixoPorMes: {}, transitoPorMes: {} };
  for (const b of BUCKETS) g.buckets[b.key] = 0;
  let fatAtual = 0, fatAnt = 0, fat25Atual = 0, pagarAberto = 0, pagarAtrasado = 0, pagarAtrasadoQtd = 0,
    receberAberto = 0, receberAtrasado = 0, receberAtrasadoQtd = 0, pagarMes = 0, pagarMesAnt = 0, totalDespesa = 0,
    pagoMesAtual = 0, pagoMesAnt = 0;
  const serie26 = fat26.meses.map(() => 0), serie25 = fat26.meses.map(() => 0);
  let ritmoDia = 0;
  for (const l of LOJAS) {
    const m = M[l.key];
    fatAtual += m.fatAtual; fatAnt += m.fatAnt; fat25Atual += m.fat25Atual; ritmoDia += m.ritmoDia;
    pagarAberto += m.pagarAberto; pagarAtrasado += m.pagarAtrasado; pagarAtrasadoQtd += m.pagarAtrasadoQtd;
    receberAberto += m.receberAberto; receberAtrasado += m.receberAtrasado; receberAtrasadoQtd += m.receberAtrasadoQtd;
    pagarMes += m.pagarMes; pagarMesAnt += m.pagarMesAnt; totalDespesa += m.totalDespesa;
    pagoMesAtual += m.pagoMesAtual; pagoMesAnt += m.pagoMesAnt;
    for (const [k, v] of Object.entries(m.pagoPorMes)) g.pagoPorMes[k] = (g.pagoPorMes[k] || 0) + (v || 0);
    for (const [k, v] of Object.entries(m.custoFixoPorMes)) g.custoFixoPorMes[k] = (g.custoFixoPorMes[k] || 0) + (v || 0);
    for (const [k, v] of Object.entries(m.transitoPorMes)) g.transitoPorMes[k] = r2c((g.transitoPorMes[k] || 0) + (v || 0));
    for (const b of BUCKETS) g.buckets[b.key] += m.buckets[b.key];
    m.serie26.forEach((v, i) => serie26[i] += v);
    m.serie25.forEach((v, i) => serie25[i] += v);
    m.fluxo.forEach((f, i) => { g.fluxo[i].sai += f.sai; g.fluxo[i].saiErp += f.saiErp; g.fluxo[i].caixa += f.caixa; g.fluxo[i].entra += f.entra; g.fluxo[i].entraBruta += f.entraBruta; });
    m.mensal.forEach((mm, i) => { g.mensal[i].entra += mm.entra; g.mensal[i].fixoEsp += mm.fixoEsp; g.mensal[i].fixoLanc += mm.fixoLanc; g.mensal[i].outros += mm.outros; g.mensal[i].caixa += mm.caixa; g.mensal[i].transito += (mm.transito || 0); g.mensal[i].compromisso += mm.compromisso; g.mensal[i].cabe += mm.cabe; });
    for (const [k, v] of Object.entries(m.pagarPorMes)) { g.pagarPorMes[k] = g.pagarPorMes[k] || { total: 0 }; g.pagarPorMes[k].total += v.total; }
    for (const [k, v] of Object.entries(m.receberPorMes)) { g.receberPorMes[k] = g.receberPorMes[k] || { total: 0 }; g.receberPorMes[k].total += v.total; }
  }
  // maiores contrapartes do grupo = soma por nome entre as lojas
  const mergeTop = sel => {
    const acc = {};
    for (const l of LOJAS) for (const it of (M[l.key][sel] || [])) acc[it.nome] = (acc[it.nome] || 0) + it.valor;
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nome, valor]) => ({ nome, valor: Math.round(valor) }));
  };
  const topForn = mergeTop("topFornecedores"), topCli = mergeTop("topClientes");
  return {
    mensal: g.mensal, transitoPorMes: g.transitoPorMes, transitoTotal: Object.values(g.transitoPorMes).reduce((s, v) => s + v, 0),
    key: "GRUPO", meses: fat26.meses, serie26, serie25, iAtual: fat26.meses.length - 1, ritmoDia,
    fatAtual, fatAnt, fat25Atual, buckets: g.buckets, totalDespesa,
    pagarAberto, pagarAtrasado, pagarAtrasadoQtd, receberAberto, receberAtrasado, receberAtrasadoQtd,
    pagarMes, pagarMesAnt, resAtual: fatAtual - pagarMes, resAnt: fatAnt - pagarMesAnt,
    pagoMesAtual, pagoMesAnt, pagoPorMes: g.pagoPorMes, custoFixoPorMes: g.custoFixoPorMes,
    pagarPorMes: g.pagarPorMes, receberPorMes: g.receberPorMes,
    topFornecedores: topForn, topClientes: topCli, fluxo: g.fluxo, pctMercadoria: pct(g.buckets.mercadoria, totalDespesa),
  };
}
const G = modeloGrupo();

// ═══════════════ RENDER ═══════════════
const mesNome = k => { const [y, m] = k.split("-"); return `${MESES_PT[+m - 1]}/${y.slice(2)}`; };

function svgFluxo(fluxo, id) {
  const W = 860, H = 240, padL = 8, padR = 8, padT = 16, padB = 34;
  const n = fluxo.length, bw = (W - padL - padR) / n;
  const max = Math.max(1, ...fluxo.map(f => Math.max(f.sai, f.entra)));
  const chartH = H - padT - padB;
  const y = v => padT + chartH * (1 - v / max);
  let bars = "", labels = "", sacc = 0, linePts = [];
  fluxo.forEach((f, i) => {
    const x = padL + i * bw;
    const w2 = bw * 0.32;
    const hE = chartH * (f.entra / max), hS = chartH * (f.sai / max);
    bars += `<rect x="${(x + bw * 0.14).toFixed(1)}" y="${y(f.entra).toFixed(1)}" width="${w2.toFixed(1)}" height="${hE.toFixed(1)}" rx="2" fill="#10b981"><title>Entra ${semLabel(f.k)}: ${fmt(f.entra)}</title></rect>`;
    bars += `<rect x="${(x + bw * 0.52).toFixed(1)}" y="${y(f.sai).toFixed(1)}" width="${w2.toFixed(1)}" height="${hS.toFixed(1)}" rx="2" fill="#ef4444"><title>Sai ${semLabel(f.k)}: ${fmt(f.sai)}</title></rect>`;
    const aperto = f.sai > f.entra;
    labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="10" fill="${aperto ? "#dc2626" : "#94a3b8"}" font-weight="${aperto ? 700 : 400}">${semLabel(f.k)}</text>`;
    sacc += f.entra - f.sai; linePts.push([x + bw / 2, sacc]);
  });
  // linha saldo acumulado (normalizada à parte positiva/negativa)
  const accVals = linePts.map(p => p[1]); const accMax = Math.max(1, ...accVals.map(Math.abs));
  const yAcc = v => padT + chartH / 2 * (1 - v / accMax);
  const poly = linePts.map(p => `${p[0].toFixed(1)},${yAcc(p[1]).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet" role="img">
    <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="#e2e8f0"/>
    ${bars}
    <polyline points="${poly}" fill="none" stroke="#334155" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.55"/>
    ${labels}
  </svg>`;
}

// fluxo MENSAL: entra líq. vs compromisso (c/ custo fixo reservado); rótulo de cima = cabe comprar; linha = caixa acum.
function svgFluxoMensal(mensal, id) {
  const W = 860, H = 240, padL = 8, padR = 8, padT = 24, padB = 34;
  const n = mensal.length, bw = (W - padL - padR) / n;
  const max = Math.max(1, ...mensal.map(m => Math.max(m.entra, m.compromisso)));
  const chartH = H - padT - padB;
  const y = v => padT + chartH * (1 - v / max);
  let bars = "", labels = "", sacc = 0, linePts = [];
  mensal.forEach((m, i) => {
    const x = padL + i * bw;
    const w2 = bw * 0.30;
    const hE = chartH * (m.entra / max), hC = chartH * (m.compromisso / max);
    bars += `<rect x="${(x + bw * 0.16).toFixed(1)}" y="${y(m.entra).toFixed(1)}" width="${w2.toFixed(1)}" height="${hE.toFixed(1)}" rx="3" fill="#10b981"><title>Entra ${mesLabelYM(m.ym)}: ${fmt(m.entra)}</title></rect>`;
    bars += `<rect x="${(x + bw * 0.54).toFixed(1)}" y="${y(m.compromisso).toFixed(1)}" width="${w2.toFixed(1)}" height="${hC.toFixed(1)}" rx="3" fill="#ef4444"><title>Compromisso ${mesLabelYM(m.ym)}: ${fmt(m.compromisso)}</title></rect>`;
    labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${padT - 9}" text-anchor="middle" font-size="10.5" fill="${m.cabe < 0 ? "#dc2626" : "#059669"}" font-weight="700"><title>sobra de caixa</title>${fmtK(m.cabe)}</text>`;
    const aperto = m.compromisso > m.entra;
    labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle" font-size="11" fill="${aperto ? "#dc2626" : "#64748b"}" font-weight="${aperto ? 700 : 500}">${mesLabelYM(m.ym)}</text>`;
    sacc += m.cabe; linePts.push([x + bw / 2, sacc]);
  });
  const accMax = Math.max(1, ...linePts.map(p => Math.abs(p[1])));
  const yAcc = v => padT + chartH / 2 * (1 - v / accMax);
  const poly = linePts.map(p => `${p[0].toFixed(1)},${yAcc(p[1]).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet" role="img">
    <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="#e2e8f0"/>
    ${bars}
    <polyline points="${poly}" fill="none" stroke="#334155" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.5"/>
    ${labels}
  </svg>`;
}

function barrasDRE(m) {
  const total = m.totalDespesa || 1;
  return BUCKETS.map(b => {
    const v = m.buckets[b.key]; if (v <= 0) return "";
    const p = pct(v, total);
    return `<div class="dre-row">
      <div class="dre-lbl">${b.label}</div>
      <div class="dre-bar-wrap"><div class="dre-bar" style="width:${p.toFixed(1)}%;background:${b.cor}"></div></div>
      <div class="dre-val">${fmt(v)}</div><div class="dre-pct">${p.toFixed(0)}%</div>
    </div>`;
  }).join("");
}

function serieMini(m) {
  // mini barras faturamento 2026 (últimos meses) com YoY
  const s = m.serie26, s25 = m.serie25, meses = m.meses;
  const max = Math.max(1, ...s, ...s25);
  return `<div class="spark">${meses.map((mi, i) => {
    const h = 100 * s[i] / max, h25 = 100 * (s25[i] || 0) / max;
    const yo = s25[i] ? pct(s[i] - s25[i], s25[i]) : 0;
    return `<div class="spark-col" title="${MESES_PT[mi - 1]}: ${fmt(s[i])} · 2025: ${fmt(s25[i] || 0)} (${fmtPct(yo)})">
      <div class="spark-bars"><span class="sb25" style="height:${h25.toFixed(0)}%"></span><span class="sb26" style="height:${h.toFixed(0)}%"></span></div>
      <div class="spark-lbl">${MESES_PT[mi - 1]}</div></div>`;
  }).join("")}</div>`;
}

function listaTop(items, tipo) {
  if (!items || !items.length) return `<div class="muted small">Consolidado — veja por loja.</div>`;
  const max = Math.max(1, ...items.map(i => i.valor));
  return items.slice(0, 8).map(i => `<div class="top-row">
    <div class="top-nome" title="${esc(i.nome)}">${esc(i.nome.length > 34 ? i.nome.slice(0, 33) + "…" : i.nome)}</div>
    <div class="top-bar-wrap"><div class="top-bar ${tipo}" style="width:${(100 * i.valor / max).toFixed(1)}%"></div></div>
    <div class="top-val">${fmt(i.valor)}</div></div>`).join("");
}

function kpiCards(m) {
  const yo = m.fat25Atual ? pct(m.fatAtual - m.fat25Atual, m.fat25Atual) : 0;
  const projMes = m.ritmoDia * 30;
  return `<div class="kpis">
    <div class="kpi">
      <div class="kpi-t">Faturamento ${mesNome(MES_ATUAL)} <span class="tag">parcial</span></div>
      <div class="kpi-v">${fmt(m.fatAtual)}</div>
      <div class="kpi-s ${yo >= 0 ? "up" : "down"}">${yo >= 0 ? "▲" : "▼"} ${fmtPct(yo)} vs ${mesNome(MES_ATUAL.replace(/^\d{4}/, String(+MES_ATUAL.slice(0, 4) - 1)))}</div>
    </div>
    <div class="kpi">
      <div class="kpi-t">Ritmo de vendas / dia</div>
      <div class="kpi-v">${fmt(m.ritmoDia)}</div>
      <div class="kpi-s muted">projeção do mês ≈ ${fmtK(projMes)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-t">Contas a pagar</div>
      <div class="kpi-v">${fmt(m.pagarAberto)} <span style="font-size:12px;font-weight:600;color:var(--muted)">a vencer</span></div>
      <div class="kpi-s ${m.pagarAtrasado > 0 ? "down" : "muted"}">${m.pagarAtrasado > 0 ? `⚠ ${fmt(m.pagarAtrasado)} vencido (${m.pagarAtrasadoQtd})` : "nada vencido"}</div>
      ${m.transitoTotal > 0 ? `<div class="kpi-s" style="color:#7c3aed;margin-top:4px">＋ ${fmt(m.transitoTotal)} em trânsito (pedidos)</div>` : ""}
      <div class="kpi-s ok" style="margin-top:4px">✓ ${fmt(m.pagoMesAtual)} já pago em ${mesNome(MES_ATUAL)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-t">Mercadoria / total a pagar</div>
      <div class="kpi-v">${m.pctMercadoria.toFixed(0)}%</div>
      <div class="kpi-s muted">peso da compra no que sai</div>
    </div>
  </div>`;
}

function vencMesTable(m) {
  const tr = m.transitoPorMes || {};
  const temTransito = Object.values(tr).some(v => v > 0);
  // meses = união dos que têm pago (passado), a pagar (futuro) e em trânsito
  const keys = [...new Set([...Object.keys(m.pagoPorMes || {}), ...Object.keys(m.pagarPorMes), ...Object.keys(tr)])].sort();
  const cf = m.custoFixoPorMes || {};
  const thTransito = temTransito ? `<th class="num">Em trânsito</th>` : "";
  return `<table class="tbl"><thead><tr><th>Mês</th><th class="num">Custo fixo</th><th class="num">Já pago</th><th class="num">A vencer</th>${thTransito}<th class="num">Total</th></tr></thead><tbody>
    ${keys.map(k => {
    const fixo = cf[k] || 0;
    const pg = (m.pagoPorMes || {})[k] || 0;
    const s = (m.pagarPorMes[k] || {}).total || 0;
    const t = tr[k] || 0;
    const tot = pg + s + t;
    const cur = k === MES_ATUAL ? ' class="cur"' : "";
    const tdTransito = temTransito ? `<td class="num" style="color:#7c3aed">${t > 0 ? fmt(t) : "—"}</td>` : "";
    return `<tr${cur}><td>${mesNome(k)}${k === MES_ATUAL ? " <span class='tag'>atual</span>" : ""}</td><td class="num" style="color:var(--warn)">${fixo > 0 ? fmt(fixo) : "—"}</td><td class="num ok">${pg > 0 ? fmt(pg) : "—"}</td><td class="num crit">${s > 0 ? fmt(s) : "—"}</td>${tdTransito}<td class="num"><b>${tot > 0 ? fmt(tot) : "—"}</b></td></tr>`;
  }).join("")}
  </tbody></table>`;
}

// ── alerta da dívida interna L3 → L5 (única vencida do grupo) ──
function dividaCallout(key) {
  const d = DIVIDA_INTERNA;
  if (!d) return "";
  let txt = "";
  if (key === "GRUPO") txt = `<b>${d.devedor} deve ${fmt(d.total)} à ${d.credor}</b> — ${fmt(d.vencido)} vencido desde ${d.desde}. É a única dívida vencida do grupo e não aparece no ERP.`;
  else if (key === d.devedor) txt = `Esta loja <b>deve ${fmt(d.total)} à ${d.credor}</b> (Santarém) — ${fmt(d.vencido)} já vencido desde ${d.desde}. Dívida entre lojas, fora do ERP.`;
  else if (key === d.credor) txt = `Esta loja tem <b>${fmt(d.total)} a receber da ${d.devedor}</b> (Itaituba) — ${fmt(d.vencido)} vencido desde ${d.desde}. Não aparece no ERP.`;
  else return "";
  return `<div class="callout"><span class="callout-i">⚠️</span><div>${txt}</div></div>`;
}

function tabContent(m, isGrupo) {
  const apertos = m.fluxo.filter(f => f.sai > f.entra).length;
  return `
  ${dividaCallout(m.key)}
  ${kpiCards(m)}

  <div class="grid2">
    <section class="card wide">
      <div class="card-h"><h3>Fluxo de caixa — estimativa futura</h3>
        <span class="toggle"><button class="tg on" onclick="fluxoView('${m.key}','sem',this)">Semana</button><button class="tg" onclick="fluxoView('${m.key}','mes',this)">Mês</button></span></div>
      <div id="fx-sem-${m.key}">
        <div class="legend legend-row"><i class="dot g"></i>Entra (venda líq. de cartão) <i class="dot r"></i>Sai (a pagar) <i class="dash"></i>saldo acumulado</div>
        ${svgFluxo(m.fluxo, m.key)}
        <div class="note">${apertos > 0 ? `<b class="crit">${apertos} semana(s)</b> com compromissos acima da entrada líquida — semanas de aperto.` : "Em nenhuma semana os compromissos superam a entrada líquida — caixa folgado."} <b>Entra</b> = faturamento projetado ${TEM_SAZONAL ? "com <b>sazonalidade</b> (mês em curso pelo ritmo real; Set–Dez pela curva de 2025 × crescimento do ano)" : "pelo ritmo de vendas"}, <b>líquido da taxa de cartão</b> (−${fmtPct(CORTE_CARTAO * 100, 1)}); <b>Sai</b> = contas a pagar por vencimento (só o já lançado) + parcela da Caixa.</div>
      </div>
      <div id="fx-mes-${m.key}" style="display:none">
        <div class="legend legend-row"><i class="dot g"></i>Entra líquida <i class="dot r"></i>Compromisso (custo fixo reservado) <i class="dash"></i>caixa acumulado · <b>nº acima da barra = sobra de caixa</b></div>
        ${svgFluxoMensal(m.mensal, m.key)}
        <div class="note"><b>Visão mensal</b> — a diferença barra verde − vermelha é a <b>sobra de caixa</b> do mês (repetida acima de cada barra), já reservando o <b>custo fixo cheio</b> dos meses à frente (aluguel, folha, energia). <b>Compromisso</b> = custo fixo + contas já lançadas no ERP + parcela da Caixa${m.transitoTotal > 0 ? ` + <b style="color:#7c3aed">pedidos em trânsito</b> (comprometido fora do ERP)` : ""}. Compare com o <b>Faturamento mensal</b> ao lado: aquele é o realizado; este é a estimativa futura.</div>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h3>Faturamento mensal 2026</h3><span class="legend"><i class="dot faint"></i>2025 <i class="dot ind"></i>2026</span></div>
      ${serieMini(m)}
    </section>
  </div>

  <div class="grid2">
    <section class="card">
      <div class="card-h"><h3>Onde vai o dinheiro (estrutura de custos)</h3><span class="muted small">janela ${fin.janela.ini}–${fin.janela.fim}</span></div>
      ${barrasDRE(m)}
      <div class="dre-tot">Total a pagar na janela: <b>${fmt(m.totalDespesa)}</b></div>
    </section>

    <section class="card">
      <div class="card-h"><h3>Contas a pagar por mês</h3></div>
      ${vencMesTable(m)}
      <div class="note small"><b>Custo fixo</b> = relatório <i>Faturas a Pagar → Centro de Custo = Custo Fixo</i> do ERP, valor <b>a vencer</b> por mês (bate 1:1 com o ERP; aluguel, folha, energia, sistemas…). Mês já pago não tem "a vencer" — aparece em "Já pago". <b>Já pago</b> = saída real de caixa. <b>A vencer</b> = em aberto no ERP por vencimento. ${m.transitoTotal > 0 ? `<b style="color:#7c3aed">Em trânsito</b> = pedidos ENVIADO/FATURADO ainda não lançados no ERP (caixa já comprometido) — mesmo número da tela de pedidos${transitoEmBR ? `, sincronizado em ${transitoEmBR}` : ""}. ` : ""}<b>Total</b> = já pago + a vencer${m.transitoTotal > 0 ? " + em trânsito (comprometido)" : ""}.</div>
    </section>
  </div>

  <section class="card">
    <div class="card-h"><h3>Maiores contas a pagar</h3>${m.pagarAtrasado > 0 ? `<span class="pill crit">${fmt(m.pagarAtrasado)} vencido</span>` : ""}</div>
    ${listaTop(m.topFornecedores, "r")}
  </section>`;
}

const TABS = [{ key: "GRUPO", label: "Grupo", sub: "consolidado", m: G }, ...LOJAS.map(l => ({ key: l.key, label: `${l.key} · ${l.cidade}`, sub: l.nome, m: M[l.key] }))];
const BUILD = Date.now();

// conteúdo SENSÍVEL (cifrado no build, injetado no navegador só após a senha correta)
const CONTEUDO = `
  <div class="page-header">
    <div><h1>💰 Painel Financeiro — Grupo A.M. Gomes</h1>
      <div class="subtitle">Contas a pagar, fluxo de caixa e estrutura de custos por loja · fonte: Microvix (ERP)</div></div>
    <div class="hstamp">Dados coletados em<br><b>${fin.geradoEmBR}</b>
      <br><a class="btn small" href="#" onclick="atualizarAgora(event)">⚡ Atualizar agora</a></div>
  </div>
  <div class="tabs">
    ${TABS.map((t, i) => `<div class="tab${i === 0 ? " active" : ""}" data-tab="${t.key}" onclick="showTab('${t.key}')">${t.label}<small>${t.sub}</small></div>`).join("")}
  </div>
  ${TABS.map((t, i) => `<div class="tabpane" id="pane-${t.key}" style="display:${i === 0 ? "block" : "none"}">${tabContent(t.m, t.key === "GRUPO")}</div>`).join("")}
  <div class="foot">Build ${new Date(BUILD).toLocaleString("pt-BR")} · gerado por build_financeiro.mjs · dados protegidos</div>`;

const SENHA = getSenha();
const PAYLOAD = SENHA ? cifrar(CONTEUDO, SENHA) : null;

const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>`;
const htmlFull = `${html}
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Painel Financeiro — Grupo A.M. Gomes</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  :root{--bg:#eef2f7;--card:#fff;--card2:#f8fafc;--border:#e2e8f0;--text:#0f172a;--text2:#334155;--muted:#64748b;--muted2:#94a3b8;--accent:#6366f1;--ok:#059669;--warn:#d97706;--crit:#dc2626;--shadow:0 1px 3px rgba(15,23,42,.06),0 4px 16px rgba(15,23,42,.04);}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);padding:20px;font-size:13.5px;line-height:1.5}
  .wrap{max-width:1180px;margin:0 auto}
  .page-header{display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--card);border:1px solid var(--border);border-top:3px solid var(--accent);border-radius:16px;padding:18px 24px;margin-bottom:16px;box-shadow:var(--shadow);flex-wrap:wrap}
  h1{font-size:20px;font-weight:800;letter-spacing:-.5px}
  .subtitle{color:var(--muted);font-size:12.5px;margin-top:4px}
  .hstamp{text-align:right;font-size:12px;color:var(--muted)}
  .hstamp b{color:var(--text2)}
  .btn{display:inline-block;margin-top:6px;padding:7px 14px;border-radius:9px;background:var(--accent);color:#fff;font-weight:600;font-size:12.5px;border:none;cursor:pointer;text-decoration:none}
  .btn:hover{background:#4f46e5}
  .btn.small{padding:5px 10px;font-size:12px}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
  .tab{padding:9px 15px;border-radius:11px;background:var(--card);border:1px solid var(--border);cursor:pointer;font-weight:600;font-size:13px;color:var(--text2);box-shadow:var(--shadow);transition:.15s}
  .tab small{display:block;font-weight:400;font-size:10.5px;color:var(--muted2)}
  .tab:hover{border-color:#c7d2fe}
  .tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
  .tab.active small{color:#e0e7ff}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin-bottom:16px}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 16px;box-shadow:var(--shadow)}
  .kpi-t{font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.3px}
  .kpi-v{font-size:22px;font-weight:800;margin:6px 0 2px;letter-spacing:-.5px}
  .kpi-v.ok{color:var(--ok)}.kpi-v.crit{color:var(--crit)}
  .kpi-s{font-size:11.5px;color:var(--muted)}
  .kpi-s.up{color:var(--ok)}.kpi-s.down{color:var(--crit)}
  .tag{display:inline-block;font-size:9.5px;background:#f1f5f9;color:var(--muted);padding:1px 6px;border-radius:5px;font-weight:600;vertical-align:middle}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 18px;box-shadow:var(--shadow)}
  .card.wide{grid-column:auto}
  .card-h{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  h3{font-size:14px;font-weight:700}
  .legend{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .dot{width:9px;height:9px;border-radius:2px;display:inline-block;margin-right:2px}
  .dot.g{background:#10b981}.dot.r{background:#ef4444}.dot.ind{background:var(--accent)}.dot.faint{background:#cbd5e1}
  .dash{width:14px;border-top:2px dashed #334155;display:inline-block;opacity:.5}
  .chart{width:100%;height:auto;display:block}
  .note{font-size:11.5px;color:var(--muted);margin-top:10px;line-height:1.45}
  .note.small{font-size:11px}
  .crit{color:var(--crit)}.ok{color:var(--ok)}.muted{color:var(--muted)}.small{font-size:11.5px}
  .dre-row{display:grid;grid-template-columns:1fr 80px 90px 34px;align-items:center;gap:8px;margin-bottom:7px;font-size:12px}
  .dre-lbl{color:var(--text2)}
  .dre-bar-wrap{background:#f1f5f9;border-radius:5px;height:10px;overflow:hidden}
  .dre-bar{height:100%;border-radius:5px}
  .dre-val{text-align:right;font-variant-numeric:tabular-nums;color:var(--text2)}
  .dre-pct{text-align:right;color:var(--muted2);font-size:11px}
  .dre-tot{margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12.5px;color:var(--muted)}
  .spark{display:flex;gap:6px;align-items:flex-end;height:150px;padding-top:8px}
  .spark-col{flex:1;display:flex;flex-direction:column;align-items:center;height:100%}
  .spark-bars{flex:1;display:flex;align-items:flex-end;gap:2px;width:100%;justify-content:center}
  .spark-bars span{width:38%;border-radius:3px 3px 0 0}
  .sb25{background:#cbd5e1}.sb26{background:var(--accent)}
  .spark-lbl{font-size:10px;color:var(--muted2);margin-top:4px}
  .tbl{width:100%;border-collapse:collapse;font-size:12px}
  .tbl th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.3px;padding:6px 8px;border-bottom:1px solid var(--border)}
  .tbl th.num{text-align:right}
  .tbl td{padding:6px 8px;border-bottom:1px solid #f1f5f9}
  .tbl td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .tbl tr.cur{background:#eef2ff}
  .top-row{display:grid;grid-template-columns:1fr 90px 92px;align-items:center;gap:8px;margin-bottom:6px;font-size:12px}
  .top-nome{color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .top-bar-wrap{background:#f1f5f9;border-radius:5px;height:9px;overflow:hidden}
  .top-bar{height:100%}.top-bar.r{background:#ef4444}.top-bar.g{background:#10b981}
  .top-val{text-align:right;font-variant-numeric:tabular-nums;color:var(--text2)}
  .pill{font-size:10.5px;padding:2px 8px;border-radius:6px;font-weight:600}
  .pill.crit{background:#fef2f2;color:var(--crit)}.pill.warn{background:#fffbeb;color:var(--warn)}
  .callout{display:flex;gap:10px;align-items:flex-start;background:#fef2f2;border:1px solid #fecaca;border-left:3px solid var(--crit);border-radius:12px;padding:11px 15px;margin-bottom:16px;font-size:12.5px;color:#7f1d1d;box-shadow:var(--shadow)}
  .callout-i{font-size:15px;line-height:1.3}
  .cc-lead{font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5}
  .toggle{display:inline-flex;background:#f1f5f9;border-radius:9px;padding:2px;gap:2px}
  .tg{border:none;background:none;padding:5px 12px;border-radius:7px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;font-family:inherit}
  .tg.on{background:var(--card);color:var(--accent);box-shadow:0 1px 2px rgba(15,23,42,.08)}
  .legend-row{margin-bottom:8px}
  .rsv{display:inline-block;font-size:9px;background:#fffbeb;color:var(--warn);padding:0 5px;border-radius:4px;font-weight:700;vertical-align:middle}
  .tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .cc-tbl td{white-space:nowrap}
  .cc-tbl tr.div td{border-top:2px solid var(--border)}
  .cc-tbl tr.cc-neg{background:#fef2f2}
  .foot{text-align:center;color:var(--muted2);font-size:11px;margin:18px 0 6px}
  .lock{max-width:380px;margin:60px auto;background:var(--card);border:1px solid var(--border);border-top:3px solid var(--accent);border-radius:16px;padding:30px 28px;box-shadow:var(--shadow);text-align:center}
  .lock h2{font-size:17px;font-weight:800;margin-bottom:6px}
  .lock p{color:var(--muted);font-size:12.5px;margin-bottom:16px}
  .lock input{width:100%;padding:11px 14px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;margin-bottom:10px;text-align:center}
  .lock input:focus{outline:none;border-color:var(--accent)}
  .lock button{width:100%;padding:11px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;font-size:14px;cursor:pointer}
  .lock button:hover{background:#4f46e5}
  .lock .err{color:var(--crit);font-size:12px;min-height:16px;margin-top:8px}
  @media(max-width:820px){.grid2{grid-template-columns:1fr}body{padding:12px}}
</style></head>
<body>
  <div id="lock" class="lock">
    <div style="font-size:30px">🔒</div>
    <h2>Painel Financeiro</h2>
    <p>Grupo A.M. Gomes · dados protegidos.<br>Digite a senha para visualizar.</p>
    <form onsubmit="return tentarSenha(event)">
      <input id="senha" type="password" placeholder="senha" autocomplete="current-password" autofocus/>
      <button type="submit">Entrar</button>
      <div id="lockerr" class="err"></div>
    </form>
  </div>
  <div id="app" class="wrap" style="display:none"></div>
<script>
  const PAYLOAD = ${JSON.stringify(PAYLOAD)};
  function b64(s){const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
  async function decifrar(pass){
    const salt=b64(PAYLOAD.salt),iv=b64(PAYLOAD.iv),data=b64(PAYLOAD.data);
    const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:PAYLOAD.iters,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data));
  }
  async function abrir(pass){
    const html=await decifrar(pass);
    const app=document.getElementById('app'); app.innerHTML=html; app.style.display='block';
    document.getElementById('lock').style.display='none';
    try{sessionStorage.setItem('fin_ok',pass);}catch(e){}
  }
  async function tentarSenha(e){e.preventDefault();
    const err=document.getElementById('lockerr'); err.textContent='…';
    try{await abrir(document.getElementById('senha').value); err.textContent='';}
    catch(_){err.textContent='Senha incorreta.';}
    return false;
  }
  function showTab(k){
    document.querySelectorAll('.tabpane').forEach(p=>p.style.display='none');
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.getElementById('pane-'+k).style.display='block';
    document.querySelector('.tab[data-tab="'+k+'"]').classList.add('active');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function fluxoView(key,modo,btn){
    document.getElementById('fx-sem-'+key).style.display = modo==='sem'?'block':'none';
    document.getElementById('fx-mes-'+key).style.display = modo==='mes'?'block':'none';
    const wrap=btn.parentElement; wrap.querySelectorAll('.tg').forEach(b=>b.classList.remove('on')); btn.classList.add('on');
  }
  async function atualizarAgora(e){e.preventDefault();
    const U="https://valhewbvjwdkkvuejrxa.supabase.co";
    const K="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhbGhld2J2andka2t2dWVqcnhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MzEwMTgsImV4cCI6MjA5NzMwNzAxOH0.DhQaFpQ1Ca-W8Od6jl3KatGai_shXOoc14Fqk7P3lK4";
    if(!confirm('Buscar os dados mais recentes do ERP agora? Leva ~5 minutos.')) return;
    try{
      const r=await fetch(U+"/rest/v1/financeiro_trigger?id=eq.1",{method:"PATCH",headers:{apikey:K,Authorization:"Bearer "+K,"Content-Type":"application/json"},body:JSON.stringify({solicitado_em:new Date().toISOString()})});
      if(r.ok) alert('⚡ Pedido enviado! O painel vai coletar do ERP e se atualizar em ~5 minutos. Recarregue a página daqui a pouco.\\n\\n(Se o ERP estiver ocupado, tenta de novo sozinho.)');
      else alert('Não consegui enviar o pedido agora (erro '+r.status+'). Tente de novo, ou aguarde a atualização automática das 19:55.');
    }catch(err){ alert('Sem conexão pra enviar o pedido agora. Tente de novo. (O painel atualiza sozinho todo dia às 19:55.)'); }
  }
  (function(){try{const s=sessionStorage.getItem('fin_ok'); if(s) abrir(s).catch(()=>{});}catch(e){}})();
</script>
</body></html>`;

if (!SENHA) {
  console.error("[build] ⚠️ SEM SENHA (Keychain amgomes-financeiro / env FINANCEIRO_SENHA). Gerando só preview local /tmp/fin_preview.html — NÃO gero os arquivos públicos.");
  fs.writeFileSync("/tmp/fin_preview.html", htmlFull);
  process.exit(0);
}
fs.writeFileSync(path.join(DIR, "dashboard_financeiro.html"), htmlFull);
fs.writeFileSync(path.join(DIR, "index.html"), htmlFull); // URL raiz do GitHub Pages
console.error(`[build] dashboard_financeiro.html + index.html escritos e CIFRADOS (${(htmlFull.length / 1024).toFixed(0)} KB) · build ${BUILD}`);
