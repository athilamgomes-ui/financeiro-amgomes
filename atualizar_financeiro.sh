#!/bin/bash
# atualizar_financeiro.sh — pipeline DETERMINÍSTICO do Painel Financeiro A.M. Gomes.
# Coleta (Playwright headless) → build (dados embutidos) → commit/push GitHub Pages.
# Exit: 0=ok · 10=coleta falhou (preserva versão anterior) · 20=build falhou (restaura) · 30=lock.
set -u
REPO="/Users/elkgomes/Desktop/claude/financeiro"
SCRIPTS="/Users/elkgomes/Desktop/claude/dashboard-equipe/scripts"
NODE="/opt/homebrew/bin/node"
LOCK="/tmp/financeiro_update.lock"
HTML="$REPO/dashboard_financeiro.html"
log(){ echo "[financeiro $(date +%H:%M:%S)] $*"; }

# ── lock (evita corrida com outra execução) ──
if ! mkdir "$LOCK" 2>/dev/null; then
  # lock velho (>30min) é órfão → remove
  if [ -d "$LOCK" ] && [ "$(find "$LOCK" -maxdepth 0 -mmin +30)" ]; then rm -rf "$LOCK"; mkdir "$LOCK";
  else log "já há execução em andamento (lock) — abortando"; exit 30; fi
fi
trap 'soltar_erp; rm -rf "$LOCK"' EXIT
# ── trava compartilhada do perfil do Microvix (26/08/2026) ──────────────────
# ~20 scripts usam o mesmo ~/.claude/microvix-profile. Duas coletas ao mesmo tempo = a segunda
# não lê o api_token_lma, sai 10 e o painel PARA DE ATUALIZAR EM SILÊNCIO (aconteceu em 25/08
# com vendas e compras, que dispararam no mesmo minuto que a premiação).
source "$HOME/.claude/lib_lock_erp.sh"
travar_erp 12 || exit 30


cd "$SCRIPTS" || exit 20
AAAA=$(date +%Y); ANO_ANT=$((AAAA-1)); MES=$(date +%-m); DIA=$(date +%-d)

# ── 1) Coleta pagar/receber (4 lojas) ──
log "coletando contas a pagar/receber..."
if $NODE coleta_financeiro.mjs > /tmp/fin_raw.json 2>/tmp/fin_raw_err.txt; then
  if [ -s /tmp/fin_raw.json ] && grep -q '"lojas"' /tmp/fin_raw.json; then
    cp /tmp/fin_raw.json "$REPO/financeiro_raw.json"; log "pagar/receber OK"
  else log "ERRO: saída pagar/receber vazia/inválida — PRESERVANDO anterior"; tail -3 /tmp/fin_raw_err.txt; exit 10; fi
else log "ERRO: coleta pagar/receber falhou (rc=$?) — PRESERVANDO anterior"; tail -5 /tmp/fin_raw_err.txt; exit 10; fi

# ── 2) Faturamento mensal — FONTE ÚNICA = Vendas (fallback: coleta incremental do ERP) ──
# Desde 30/09/2026 o faturamento vem do `fatMensal` do dashboard de VENDAS (ver invocação abaixo).
# A função coletar_fat() abaixo é só o FALLBACK: coleta incremental (só o mês corrente + merge dos
# fechados de fat_$ANO.json / fat_${ANO_ANT}_full.json), usada se a extração do Vendas falhar.
coletar_fat(){ # $1=ano  $2=arquivo-base(fechados)  $3=mes_inicial [FALLBACK]
  local ano="$1" base="$2" mi="$3" fresh="/tmp/fin_fat_${1}_fresh.json" tmp="/tmp/fin_fat_${1}.json"
  if $NODE coleta_amgomes_mensal.mjs "$ano" "$MES" "$DIA" "$mi" > "$fresh" 2>"/tmp/fin_fat_${1}_err.txt" && [ -s "$fresh" ]; then
    if $NODE "$REPO/merge_fat_mensal.mjs" --ano "$ano" --mesfinal "$MES" --base "$base" --fresh "$fresh" --out "$tmp"; then
      cp "$tmp" "$REPO/fat_$ano.json"; log "faturamento $ano OK (incremental: mês $mi..$MES do ERP + fechados do arquivo)"; return 0
    fi
    log "merge $ano incompleto → coleta COMPLETA (fallback)"
  else
    log "AVISO: coleta parcial $ano falhou — tentando coleta completa"; tail -2 "/tmp/fin_fat_${1}_err.txt" 2>/dev/null
  fi
  if $NODE coleta_amgomes_mensal.mjs "$ano" "$MES" "$DIA" > "$tmp" 2>>"/tmp/fin_fat_${1}_err.txt" && [ -s "$tmp" ]; then
    cp "$tmp" "$REPO/fat_$ano.json"; log "faturamento $ano OK (coleta completa)"; return 0
  fi
  log "AVISO: faturamento $ano falhou — mantém anterior"; return 1
}
# FONTE ÚNICA (30/09/2026): o faturamento vem do `fatMensal` já publicado pelo dashboard de VENDAS
# (mesmo número, Venda Líquida líquida do cliente 8) → os dois painéis NUNCA divergem no mês corrente,
# que era a única inconsistência que sobrava (timing de dois coletores). Também tira a coleta pesada de
# faturamento do financeiro. Se a extração falhar (Vendas não rodou hoje / formato do literal mudou),
# cai no FALLBACK incremental de coleta do ERP (coletar_fat, acima) — mesma robustez de antes.
if $NODE "$REPO/extrai_fat_vendas.mjs"; then
  log "faturamento OK (fonte ÚNICA = Vendas/fatMensal — sem tocar o ERP)"
else
  log "AVISO: extração do Vendas falhou → fallback: coleta incremental do ERP"
  MES_INI26=$MES; if [ "$DIA" -le 3 ] && [ "$MES" -gt 1 ]; then MES_INI26=$((MES-1)); fi
  coletar_fat "$AAAA"    "$REPO/fat_$AAAA.json"            "$MES_INI26"
  coletar_fat "$ANO_ANT" "$REPO/fat_${ANO_ANT}_full.json" "$MES"
fi

# ── 2.5) Refresh do "em trânsito" (pedidos_comprometido) ANTES do build ──
# Abre o planejamento.html headless → persistirComprometido() regrava o snapshot fresco.
# Não-bloqueante: se falhar, o build usa o snapshot que existir e a guarda de idade avisa.
log "atualizando em trânsito (pedidos_comprometido)..."
if $NODE refresh_comprometido.mjs 2>/tmp/fin_transito_err.txt; then log "em trânsito OK"; else log "AVISO: refresh do em trânsito falhou — build segue com o snapshot atual"; tail -3 /tmp/fin_transito_err.txt; fi

# ── 3) Build ──
cd "$REPO" || exit 20
cp -f "$HTML" /tmp/fin_html_bak.html 2>/dev/null
log "build..."
if ! $NODE build_financeiro.mjs 2>/tmp/fin_build_err.txt; then
  log "ERRO no build — restaurando versão anterior"; cat /tmp/fin_build_err.txt | tail -5
  [ -f /tmp/fin_html_bak.html ] && cp -f /tmp/fin_html_bak.html "$HTML"
  exit 20
fi

# ── 4) Commit + push ──
if git diff --quiet -- dashboard_financeiro.html index.html; then
  log "sem mudanças no dashboard — nada a commitar."
else
  # SÓ o HTML cifrado vai pro repo público. Os JSONs de dados (texto puro) ficam locais (.gitignore).
  git add dashboard_financeiro.html index.html
  git commit -q -m "financeiro: atualização $(date +%d/%m) $(date +%H:%M)"
  if git push origin main 2>/tmp/fin_push_err.txt; then log "push OK."
  else log "ERRO no push:"; tail -5 /tmp/fin_push_err.txt; exit 20; fi
fi
log "concluído."
