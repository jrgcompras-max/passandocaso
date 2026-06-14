import {
  type Pendencia,
  type Problema,
  type Paciente,
  type SecaoClinica,
  type SecaoId,
} from "@/types/paciente";

/**
 * Pacientes hipotéticos para testar todas as funcionalidades da Fase 1.
 * Gerados em runtime para que as datas de entrada caiam no dia de internação
 * desejado (D-N) relativo à data atual do dispositivo.
 */

/** Data ISO (YYYY-MM-DD) de `n` dias atrás — para o paciente nascer no dia "D(n+1)". */
function diasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Monta o JSON de blocos no formato esperado pelo conteúdo extraído das seções. */
function blocos(...grupos: { titulo: string; itens: string[] }[]): string {
  return JSON.stringify(grupos.map((g) => ({ titulo: g.titulo, itens: g.itens })));
}

/** Conveniência para criar uma seção só com conteúdo extraído. */
function secao(extraido: string): SecaoClinica {
  return { anotacoes: [], extraido };
}

let seq = 1;
const pid = () => `ex-${seq++}`;

function problema(p: Omit<Problema, "id">): Problema {
  return { id: pid(), ...p };
}

function pendencia(p: Omit<Pendencia, "id">): Pendencia {
  return { id: pid(), ...p };
}

type SecoesExemplo = Partial<Record<SecaoId, SecaoClinica>>;

/** Cria os 6 pacientes de exemplo (datas relativas ao dia atual). */
export function gerarPacientesExemplo(): Paciente[] {
  const hoje = diasAtras(0);

  const base = (
    extras: Partial<Paciente> & {
      id: string;
      nomeCompleto: string;
      idade: number;
      leito: string;
      setor: string;
      status: Paciente["status"];
      diaInternacao: number;
      secoes: SecoesExemplo;
    },
  ): Paciente => {
    const { diaInternacao, ...resto } = extras;
    return {
      ...resto,
      numeroProntuario: extras.id,
      dataEntrada: diasAtras(diaInternacao - 1),
      diasAcompanhamento: [hoje],
      dadosClinicos: null,
    };
  };

  return [
    base({
      id: "1042371",
      nomeCompleto: "Maria Goretti Brasil Ribeiro",
      idade: 72,
      leito: "306-4",
      setor: "Unidade 09 – São Francisco",
      status: "visitado",
      statusClinico: "melhora",
      diagnosticoPrincipal: "Pneumonia comunitária",
      motivoInternacao:
        "Tosse produtiva, febre e dispneia há 4 dias, com queda do estado geral.",
      diaInternacao: 8,
      problemas: [
        problema({
          titulo: "Pneumonia comunitária",
          status: "resolvendo",
          prioridade: "alta",
          observacao: "Consolidação em base direita; melhora da dispneia.",
          conduta: "Ceftriaxona + azitromicina (D5/7). Manter O2 conforme SatO2.",
        }),
        problema({
          titulo: "Hipertensão arterial sistêmica",
          status: "ativo",
          prioridade: "media",
          observacao: "PA controlada na internação.",
          conduta: "Manter losartana 50 mg/dia.",
        }),
      ],
      pendencias: [
        pendencia({
          descricao: "Coletar hemograma e PCR de controle",
          prioridade: "alta",
          feito: false,
        }),
        pendencia({
          descricao: "Solicitar avaliação da fisioterapia respiratória",
          prioridade: "media",
          feito: false,
        }),
        pendencia({
          descricao: "Ajustar dieta para hipossódica",
          prioridade: "baixa",
          feito: true,
        }),
      ],
      secoes: {
        comorbidadesMedicacoes: secao(
          blocos(
            { titulo: "Comorbidades", itens: ["HAS", "DM2", "Dislipidemia"] },
            {
              titulo: "Medicações de uso contínuo",
              itens: ["Losartana 50 mg/dia", "Metformina 850 mg 2x/dia", "Sinvastatina 20 mg/noite"],
            },
          ),
        ),
        examesLaboratoriais: secao(
          blocos(
            { titulo: "Hemograma", itens: ["Hb 11,2 g/dL", "Leucócitos 14.300/mm³", "Plaquetas 280.000/mm³"] },
            { titulo: "Inflamatórios", itens: ["PCR 96 mg/L"] },
            { titulo: "Função renal", itens: ["Ureia 48 mg/dL", "Creatinina 0,9 mg/dL"] },
          ),
        ),
        prescricaoHospitalar: secao(
          blocos({
            titulo: "Antibióticos",
            itens: ["Ceftriaxona 1 g IV 12/12h", "Azitromicina 500 mg VO 1x/dia"],
          }),
        ),
      },
    }),

    base({
      id: "1058902",
      nomeCompleto: "João Carlos Mendes",
      idade: 58,
      leito: "UTI-3",
      setor: "UTI Geral",
      status: "naoVisitado",
      statusClinico: "critico",
      diagnosticoPrincipal: "Sepse de foco urinário",
      motivoInternacao:
        "Febre alta, hipotensão e rebaixamento; urocultura em andamento.",
      diaInternacao: 3,
      problemas: [
        problema({
          titulo: "Choque séptico (foco urinário)",
          status: "ativo",
          prioridade: "alta",
          observacao: "Lactato 4,2 mmol/L; em noradrenalina.",
          conduta: "ATB de largo espectro, ressuscitação volêmica e vasopressor.",
        }),
        problema({
          titulo: "Injúria renal aguda",
          status: "ativo",
          prioridade: "alta",
          observacao: "Oligúria nas últimas 12h.",
          conduta: "Controle de balanço hídrico; avaliar diálise se piora.",
        }),
      ],
      pendencias: [
        pendencia({
          descricao: "Checar resultado da urocultura e hemoculturas",
          prioridade: "alta",
          feito: false,
        }),
        pendencia({
          descricao: "Reavaliar drogas vasoativas",
          prioridade: "alta",
          feito: false,
        }),
      ],
      secoes: {
        comorbidadesMedicacoes: secao(
          blocos({ titulo: "Comorbidades", itens: ["DM2", "Nefrolitíase de repetição"] }),
        ),
        examesLaboratoriais: secao(
          blocos(
            { titulo: "Hemograma", itens: ["Leucócitos 21.800/mm³", "Bastões 12%"] },
            { titulo: "Função renal", itens: ["Ureia 92 mg/dL", "Creatinina 2,8 mg/dL"] },
            { titulo: "Gasometria", itens: ["Lactato 4,2 mmol/L", "pH 7,28"] },
          ),
        ),
        prescricaoHospitalar: secao(
          blocos({
            titulo: "Antibióticos",
            itens: ["Piperacilina-tazobactam 4,5 g IV 6/6h"],
          }),
        ),
      },
    }),

    base({
      id: "1061245",
      nomeCompleto: "Ana Paula Ferreira",
      idade: 45,
      leito: "B2",
      setor: "Clínica Médica",
      status: "revisar",
      statusClinico: "estavel",
      diagnosticoPrincipal: "TVP de membro inferior direito",
      motivoInternacao: "Dor e edema em panturrilha direita há 3 dias.",
      diaInternacao: 5,
      problemas: [
        problema({
          titulo: "Trombose venosa profunda (MID)",
          status: "ativo",
          prioridade: "media",
          observacao: "Doppler confirma TVP femoropoplítea.",
          conduta: "Anticoagulação plena com enoxaparina (1 mg/kg 12/12h).",
        }),
      ],
      pendencias: [
        pendencia({
          descricao: "Revisar dose de anticoagulante pelo peso",
          prioridade: "media",
          feito: false,
        }),
        pendencia({
          descricao: "Orientar transição para anticoagulante oral",
          prioridade: "baixa",
          feito: true,
        }),
      ],
      secoes: {
        comorbidadesMedicacoes: secao(
          blocos({ titulo: "Comorbidades", itens: ["Obesidade", "Tabagismo"] }),
        ),
        examesLaboratoriais: secao(
          blocos({ titulo: "Coagulação", itens: ["INR 1,1", "TTPa 32 s", "D-dímero 3.200 ng/mL"] }),
        ),
      },
    }),

    base({
      id: "0998120",
      nomeCompleto: "Carlos Eduardo Lima",
      idade: 67,
      leito: "C1",
      setor: "Clínica Médica",
      status: "altaProvavel",
      statusClinico: "melhora",
      diagnosticoPrincipal: "Descompensação de insuficiência cardíaca",
      motivoInternacao: "Dispneia progressiva e edema de membros inferiores.",
      diaInternacao: 12,
      problemas: [
        problema({
          titulo: "ICC descompensada (FEr)",
          status: "resolvendo",
          prioridade: "media",
          observacao: "Balanço negativo; sem dispneia em repouso.",
          conduta: "Furosemida VO; otimizar terapia para alta.",
        }),
      ],
      pendencias: [
        pendencia({
          descricao: "Agendar retorno na cardiologia",
          prioridade: "media",
          feito: true,
        }),
        pendencia({
          descricao: "Conciliar medicações para alta",
          prioridade: "baixa",
          feito: false,
        }),
      ],
      secoes: {
        comorbidadesMedicacoes: secao(
          blocos(
            { titulo: "Comorbidades", itens: ["ICC FEr", "HAS", "FA permanente"] },
            {
              titulo: "Medicações de uso contínuo",
              itens: ["Carvedilol 12,5 mg 2x/dia", "Espironolactona 25 mg/dia", "Varfarina conforme INR"],
            },
          ),
        ),
        examesLaboratoriais: secao(
          blocos(
            { titulo: "Marcadores", itens: ["BNP 720 pg/mL"] },
            { titulo: "Eletrólitos", itens: ["Na 138 mEq/L", "K 4,2 mEq/L"] },
          ),
        ),
      },
    }),

    base({
      id: "1072339",
      nomeCompleto: "Francisca Aparecida Santos",
      idade: 81,
      leito: "A4",
      setor: "Geriatria",
      status: "pendente",
      statusClinico: "estavel",
      diagnosticoPrincipal: "Fratura de fêmur proximal",
      motivoInternacao: "Queda da própria altura com dor e impotência funcional do quadril direito.",
      diaInternacao: 2,
      problemas: [
        problema({
          titulo: "Fratura transtrocantérica de fêmur (D)",
          status: "ativo",
          prioridade: "alta",
          observacao: "Aguarda avaliação da ortopedia para cirurgia.",
          conduta: "Analgesia, tração e preparo pré-operatório.",
        }),
        problema({
          titulo: "Delirium hipoativo",
          status: "ativo",
          prioridade: "media",
          observacao: "Flutuação do nível de consciência à noite.",
          conduta: "Medidas não farmacológicas; revisar polifarmácia.",
        }),
      ],
      pendencias: [
        pendencia({
          descricao: "Solicitar avaliação pré-operatória",
          prioridade: "alta",
          feito: false,
        }),
        pendencia({
          descricao: "Reservar concentrado de hemácias",
          prioridade: "media",
          feito: false,
        }),
        pendencia({
          descricao: "Iniciar profilaxia de TVP",
          prioridade: "media",
          feito: false,
        }),
      ],
      secoes: {
        comorbidadesMedicacoes: secao(
          blocos(
            { titulo: "Comorbidades", itens: ["Osteoporose", "Demência leve", "HAS"] },
            { titulo: "Medicações de uso contínuo", itens: ["Cálcio + vitamina D", "Donepezila 5 mg/dia"] },
          ),
        ),
        examesLaboratoriais: secao(
          blocos({ titulo: "Hemograma", itens: ["Hb 10,4 g/dL", "Plaquetas 210.000/mm³"] }),
        ),
      },
    }),

    base({
      id: "1080517",
      nomeCompleto: "Roberto Silva Neto",
      idade: 34,
      leito: "D1",
      setor: "Clínica Médica",
      status: "altaRealizada",
      statusClinico: "melhora",
      diagnosticoPrincipal: "Crise hipertensiva",
      motivoInternacao: "Cefaleia intensa com PA 220x130 mmHg na admissão.",
      diaInternacao: 1,
      problemas: [
        problema({
          titulo: "Urgência hipertensiva",
          status: "resolvido",
          prioridade: "baixa",
          observacao: "PA controlada, sem lesão de órgão-alvo.",
          conduta: "Alta com anti-hipertensivo oral e seguimento ambulatorial.",
        }),
      ],
      pendencias: [
        pendencia({
          descricao: "Entregar receita e orientações de alta",
          prioridade: "baixa",
          feito: true,
        }),
      ],
      secoes: {
        comorbidadesMedicacoes: secao(
          blocos({ titulo: "Comorbidades", itens: ["HAS de difícil controle"] }),
        ),
        examesLaboratoriais: secao(
          blocos({ titulo: "Função renal", itens: ["Creatinina 1,0 mg/dL"] }),
        ),
      },
    }),
  ];
}
