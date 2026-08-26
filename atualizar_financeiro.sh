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

# ── 2) Faturamento mensal (atual + anterior, janela simétrica) ──
log "coletando faturamento $AAAA e $ANO_ANT (até $DIA/$MES)..."
$NODE coleta_amgomes_mensal.mjs "$AAAA"    "$MES" "$DIA" > /tmp/fin_fat26.json 2>/tmp/fin_fat26_err.txt; RC26=$?
$NODE coleta_amgomes_mensal.mjs "$ANO_ANT" "$MES" "$DIA" > /tmp/fin_fat25.json 2>/tmp/fin_fat25_err.txt; RC25=$?
if [ $RC26 -eq 0 ] && [ -s /tmp/fin_fat26.json ]; then cp /tmp/fin_fat26.json "$REPO/fat_$AAAA.json"; else log "AVISO: faturamento $AAAA falhou (rc=$RC26) — mantém anterior"; fi
if [ $RC25 -eq 0 ] && [ -s /tmp/fin_fat25.json ]; then cp /tmp/fin_fat25.json "$REPO/fat_$ANO_ANT.json"; else log "AVISO: faturamento $ANO_ANT falhou (rc=$RC25) — mantém anterior"; fi

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
