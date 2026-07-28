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

// ── semanas do fluxo: da segunda desta semana, 13 semanas ──
function segundaISO(d) { const dow = (d.getDay() + 6) % 7; const s = new Date(d); s.setDate(d.getDate() - dow); return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`; }
const SEMANAS = (() => { const arr = []; let s = new Date(now); const dow = (s.getDay() + 6) % 7; s.setDate(s.getDate() - dow); for (let i = 0; i < 13; i++) { const k = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`; arr.push(k); s.setDate(s.getDate() + 7); } return arr; })();
const semLabel = k => { const [y, m, d] = k.split("-"); return `${d}/${m}`; };

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
  // fluxo semanal: SAI = contas a pagar por vencimento (real); ENTRA = projeção pelo ritmo de vendas
  const fluxo = SEMANAS.map(k => ({ k, sai: pagar.porSemana[k] || 0, entra: ritmoDia * 7 }));
  return {
    key, meses, serie26, serie25, iAtual, fatAtual, fatAnt, fat25Atual, ritmoDia,
    buckets, totalDespesa,
    pagarAberto: pagar.abertoValor, pagarAtrasado: pagar.atrasadoValor, pagarAtrasadoQtd: pagar.atrasadoQtd,
    receberAberto: receber.abertoValor, receberAtrasado: receber.atrasadoValor, receberAtrasadoQtd: receber.atrasadoQtd,
    pagarMes, pagarMesAnt, resAtual, resAnt,
    pagarPorMes: pagar.porMes, receberPorMes: receber.porMes,
    topFornecedores: pagar.topContrapartes, topClientes: receber.topContrapartes,
    fluxo, pctMercadoria: pct(buckets.mercadoria, totalDespesa),
  };
}
const M = {}; LOJAS.forEach((l, i) => { M[l.key] = modeloLoja(l.key, i); });

// grupo consolidado
function modeloGrupo() {
  const g = { buckets: {}, fluxo: SEMANAS.map(k => ({ k, sai: 0, entra: 0 })), pagarPorMes: {}, receberPorMes: {} };
  for (const b of BUCKETS) g.buckets[b.key] = 0;
  let fatAtual = 0, fatAnt = 0, fat25Atual = 0, pagarAberto = 0, pagarAtrasado = 0, pagarAtrasadoQtd = 0,
    receberAberto = 0, receberAtrasado = 0, receberAtrasadoQtd = 0, pagarMes = 0, pagarMesAnt = 0, totalDespesa = 0;
  const serie26 = fat26.meses.map(() => 0), serie25 = fat26.meses.map(() => 0);
  let ritmoDia = 0;
  for (const l of LOJAS) {
    const m = M[l.key];
    fatAtual += m.fatAtual; fatAnt += m.fatAnt; fat25Atual += m.fat25Atual; ritmoDia += m.ritmoDia;
    pagarAberto += m.pagarAberto; pagarAtrasado += m.pagarAtrasado; pagarAtrasadoQtd += m.pagarAtrasadoQtd;
    receberAberto += m.receberAberto; receberAtrasado += m.receberAtrasado; receberAtrasadoQtd += m.receberAtrasadoQtd;
    pagarMes += m.pagarMes; pagarMesAnt += m.pagarMesAnt; totalDespesa += m.totalDespesa;
    for (const b of BUCKETS) g.buckets[b.key] += m.buckets[b.key];
    m.serie26.forEach((v, i) => serie26[i] += v);
    m.serie25.forEach((v, i) => serie25[i] += v);
    m.fluxo.forEach((f, i) => { g.fluxo[i].sai += f.sai; g.fluxo[i].entra += f.entra; });
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
    key: "GRUPO", meses: fat26.meses, serie26, serie25, iAtual: fat26.meses.length - 1, ritmoDia,
    fatAtual, fatAnt, fat25Atual, buckets: g.buckets, totalDespesa,
    pagarAberto, pagarAtrasado, pagarAtrasadoQtd, receberAberto, receberAtrasado, receberAtrasadoQtd,
    pagarMes, pagarMesAnt, resAtual: fatAtual - pagarMes, resAnt: fatAnt - pagarMesAnt,
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
  const saldoLiq = m.receberAberto - m.pagarAberto;
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
      <div class="kpi-t">A pagar (em aberto)</div>
      <div class="kpi-v">${fmt(m.pagarAberto)}</div>
      <div class="kpi-s ${m.pagarAtrasado > 0 ? "down" : "muted"}">${m.pagarAtrasado > 0 ? `⚠ ${fmt(m.pagarAtrasado)} vencido (${m.pagarAtrasadoQtd})` : "nada vencido"}</div>
    </div>
    <div class="kpi">
      <div class="kpi-t">A receber (em aberto)</div>
      <div class="kpi-v">${fmt(m.receberAberto)}</div>
      <div class="kpi-s muted">cartão + crediário a compensar</div>
    </div>
    <div class="kpi">
      <div class="kpi-t">Saldo a receber − a pagar</div>
      <div class="kpi-v ${saldoLiq >= 0 ? "ok" : "crit"}">${fmt(saldoLiq)}</div>
      <div class="kpi-s muted">posição líquida em aberto</div>
    </div>
    <div class="kpi">
      <div class="kpi-t">Mercadoria / total a pagar</div>
      <div class="kpi-v">${m.pctMercadoria.toFixed(0)}%</div>
      <div class="kpi-s muted">peso da compra no que sai</div>
    </div>
  </div>`;
}

function vencMesTable(m) {
  // meses ordenados presentes em pagar/receber
  const keys = [...new Set([...Object.keys(m.pagarPorMes), ...Object.keys(m.receberPorMes)])].sort();
  return `<table class="tbl"><thead><tr><th>Mês (vencimento)</th><th>Recebíveis agendados</th><th>A pagar</th><th>Saldo agendado</th></tr></thead><tbody>
    ${keys.map(k => {
    const e = (m.receberPorMes[k] || {}).total || 0, s = (m.pagarPorMes[k] || {}).total || 0; const sal = e - s;
    const cur = k === MES_ATUAL ? ' class="cur"' : "";
    return `<tr${cur}><td>${mesNome(k)}${k === MES_ATUAL ? " <span class='tag'>atual</span>" : ""}</td><td class="num ok">${fmt(e)}</td><td class="num crit">${fmt(s)}</td><td class="num ${sal >= 0 ? "ok" : "crit"}">${fmt(sal)}</td></tr>`;
  }).join("")}
  </tbody></table>`;
}

function tabContent(m, isGrupo) {
  const apertos = m.fluxo.filter(f => f.sai > f.entra).length;
  return `
  ${kpiCards(m)}

  <div class="grid2">
    <section class="card wide">
      <div class="card-h"><h3>Fluxo de caixa — próximas 13 semanas</h3>
        <span class="legend"><i class="dot g"></i>Entra (ritmo de vendas) <i class="dot r"></i>Sai (a pagar) <i class="dash"></i>saldo acumulado</span></div>
      ${svgFluxo(m.fluxo, m.key)}
      <div class="note">${apertos > 0 ? `<b class="crit">${apertos} semana(s)</b> com contas a pagar acima do ritmo de vendas — semanas de aperto.` : "Em nenhuma semana as contas a pagar superam o ritmo de vendas — caixa folgado."} <b>Entra</b> = projeção pelo ritmo de vendas (${fmt(m.ritmoDia)}/dia); <b>Sai</b> = contas a pagar por data de vencimento (real). Recebíveis de cartão/crediário a compensar estão no painel "Maiores a receber".</div>
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
      <div class="card-h"><h3>Calendário de vencimentos por mês</h3></div>
      ${vencMesTable(m)}
      <div class="note small">Só o que já está <b>agendado</b> no ERP. Recebíveis dos próximos meses crescem conforme novas vendas acontecem — por isso o saldo agendado futuro aparece negativo.</div>
    </section>
  </div>

  <div class="grid2">
    <section class="card">
      <div class="card-h"><h3>Maiores contas a pagar</h3>${m.pagarAtrasado > 0 ? `<span class="pill crit">${fmt(m.pagarAtrasado)} vencido</span>` : ""}</div>
      ${listaTop(m.topFornecedores, "r")}
    </section>
    <section class="card">
      <div class="card-h"><h3>Maiores a receber</h3>${m.receberAtrasado > 0 ? `<span class="pill warn">${fmt(m.receberAtrasado)} vencido/a compensar</span>` : ""}</div>
      ${listaTop(m.topClientes, "g")}
      <div class="note small">A maior parte é recebível de cartão (operadoras). "Vencido" aqui inclui parcelas ainda não baixadas no ERP — não é necessariamente inadimplência de cliente.</div>
    </section>
  </div>`;
}

const TABS = [{ key: "GRUPO", label: "Grupo", sub: "consolidado", m: G }, ...LOJAS.map(l => ({ key: l.key, label: `${l.key} · ${l.cidade}`, sub: l.nome, m: M[l.key] }))];
const BUILD = Date.now();

// conteúdo SENSÍVEL (cifrado no build, injetado no navegador só após a senha correta)
const CONTEUDO = `
  <div class="page-header">
    <div><h1>💰 Painel Financeiro — Grupo A.M. Gomes</h1>
      <div class="subtitle">Contas a pagar, a receber, fluxo de caixa e resultado por loja · fonte: Microvix (ERP)</div></div>
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
  function atualizarAgora(e){e.preventDefault();
    alert('Atualização sob demanda: peça ao Claude para rodar o pipeline, ou aguarde o horário fixo.');
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
