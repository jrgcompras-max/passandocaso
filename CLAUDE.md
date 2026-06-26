@AGENTS.md

# PASSANDO O CASO — Fonte de verdade do produto

> Estas seções são PERMANENTES. Não alterar formatos nem regras sem instrução
> explícita do produto. A geração de texto SEMPRE importa os arquivos em
> `backend/templates/` — nunca gera livre.

---

## FORMATOS IMUTÁVEIS

### Evolução Médica (texto puro — vai para o Tasy)

Texto puro: apenas `-`, `*`, `|`, `/`, espaços e quebras de linha. Nenhum emoji,
nenhuma marcação especial. Compatível com qualquer campo de texto hospitalar.
Fonte de verdade: `backend/templates/evolucao-medica.template.js`.

```
                    Evolução Médica

- Atual: [diagnóstico principal]
         [outros problemas ativos — um por linha]

- Antibióticos: [nome, dose, via, frequência, D+]
- Culturais: [resultado ou ---]

* Comorbidades: [lista ou "nega"]
* MUC: [medicações com dose ou "nega"]
* Alergias: [ou --]

*HDA: [história da doença atual em texto corrido]

*S: [nível de consciência + queixas do dia]

SSVV: PA 120/80 | FC 80 | FR 18 | SatO2 96% | Tax 36,5

*O: REG, LOC, MUC, AAA
Glasgow 15, PIRF, sem déficits focais
AC RR 2T BNF SS
AP MV+ bilat simétrico sem RA
Abdome flácido, indolor, RHA+, SSIP
MMII sem edema, sem empastamento
Extremidades aquecidas, TEC<3s

Exames laboratoriais:
25/06: Hb X / Ht X / LT X / Plaq X
       Na X / K X / Ur X / Cr X
23/06: Hb X / Ht X / LT X / Plaq X

Exames de imagem:
TC de Crânio: [laudo resumido]
RX de Tórax: [laudo resumido]

*A: [diagnóstico 1]
    [diagnóstico 2]

*P: [conduta 1]
    [conduta 2]
```

Regras:
- "Evolução Médica" centralizado no topo, sem negrito.
- Sem identificação do paciente dentro do texto. Sem assinatura.
- Comorbidades e MUC em blocos separados.
- ATB só aparece se houver cadastrado; senão `--`.
- SSVV só aparece se preenchido.
- Labs separados por data (mais recente → mais antiga): cada data em linha
  `DD/MM: ` + labs do dia em ordem clínica, separados por `/`, quebrando a cada
  ~4 labs com indentação. Só exames com valor naquela data.
- Imagem: cada exame em linha própria.
- Sem linhas separadoras entre seções. Sem títulos em maiúsculas.
- Sem "Checo exames"/"Checo TC".

### Passar o Caso (visual rico — fica no app, NÃO é copiado)

Componentes React Native. Não vai para sistemas externos. Sem botão "Copiar".
Subtítulo automático: `Nome abreviado · Idade · Leito · D+`.
Fonte de verdade: `backend/templates/passar-o-caso.template.js`.

Estrutura e ordem:
1. Atual — problemas ativos ("ativo"/"resolvendo"), um por linha.
2. Comorbidades (chips).
3. MUC (chips, separado de Comorbidades).
4. HDA — uma linha de contexto resumida.
5. Sinais vitais alterados — só os fora do normal, em badges vermelhos.
6. Exame físico — só os chips marcados; não exibe seções vazias.
7. Labs alterados — só fora do normal, com seta ↑/↓.
8. Antibióticos — badge "ATB" + nome + D+; só se houver ATB.
9. Avaliação — hipóteses diagnósticas (• azul por item).
10. Conduta proposta — numerada (1. 2. 3.). Sempre "Conduta proposta", nunca só "Conduta".
11. Escores — só se o toggle estiver ativado (default deste botão: OFF).

Visual:
- Cards brancos, border 0.5px por seção; espaçamento 6px entre cards.
- Section label: 11px, uppercase, cinza, acima do conteúdo.
- Atual/Avaliação: ponto azul (•) antes de cada item.
- SSVV alterados: badge vermelho (fundo #FCEBEB, texto #A32D2D) com label + valor.
- Labs: nome à esquerda; valor + seta à direita; vermelho = alto, azul = baixo.
- ATBs: badge "ATB" coral + nome + detalhe D+.
- Comorbidades/MUC/Exame físico: chips (pill tags).

---

## REGRAS PERMANENTES DO PRODUTO

- Nunca usar a palavra "IA" em texto visível no app (botões, labels, subtítulos,
  tooltips, erros, onboarding). Use "automático/automaticamente", "Sugestão".
- HDA (História da Doença Atual) — nunca HMA / "História Médica Atual".
- Comorbidades e MUC são seções SEPARADAS (extração e exibição).
- Evolução Médica: texto puro compatível com Tasy (sem emojis, sem markdown, só
  caracteres universais).
- Passar o Caso: fica no app, não é copiado para fora.
- "Conduta proposta" — nunca só "Conduta" — no Passar o Caso.
- Geração de texto SEMPRE importa os arquivos em `backend/templates/` — nunca
  gera livre. Mudança de formato = editar o template, não a conversa.

---

## ARQUITETURA DE DADOS

- Interações medicamentosas: OpenFDA (CC0) + Anthropic API → cache em
  `interacoes_medicamentosas` (complementa as curadas; cache negativo via
  `ativo=false`). Resolução nome→INN (PT→EN) em `backend/interacoesFda.js`.
- Escores clínicos: toggle em `usuarios.features_ativas` (JSONB), default
  ATIVADO. Cálculo/persistência em `backend/escores.js` (+ tabela
  `escores_clinicos`). Desligado: oculta seção e remove do Passar o Caso.
- Chips de evolução: `chips_evolucao_global` + `chips_evolucao_pessoal` +
  `texto_livre_log`. Pessoal a partir de 3 usos; candidato global ≥5 médicos OU
  ≥20 usos; aprovação no admin web (`backend/chips.js`).
- Parsing de JSON da Anthropic: sempre via `backend/iaJson.js` (tolera cercas
  markdown e texto ao redor; loga o bruto em falha).
- Anti-misrouting do scan: `ontologia.sanitizarSecao/sanitizarEstruturado`
  removem itens que pertencem a outra seção (ex.: comorbidade na Prescrição).
