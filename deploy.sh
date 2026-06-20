#!/bin/bash
MSG="${1:-update}"
cd "$(dirname "$0")"
git add .
# Só commita se houver mudanças staged (evita falha em commit vazio).
git diff --cached --quiet || git commit -m "$MSG"
git push
eas update --branch production --message "$MSG" --environment production --non-interactive
echo "✅ Deploy concluído: $MSG"
