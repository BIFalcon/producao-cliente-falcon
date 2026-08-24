export type CrmAccountStage =
  | 'prospeccao'
  | 'lead_identificado'
  | 'contato_realizado'
  | 'oportunidade'
  | 'proposta_enviada'
  | 'negociacao'
  | 'fechamento';

export type CrmAccountStatus = 'ativo' | 'inativo';

export type CrmAccountType = 'empresa' | 'agencia';

export type CrmAccountSubSegment = 'evento' | 'mensalista' | 'grupo' | 'rfp';

export type CrmVisitType =
  | 'visita_presencial'
  | 'ligacao'
  | 'email'
  | 'whatsapp'
  | 'reuniao_comercial_interna'
  | 'treinamento'
  | 'eventos_feiras'
  | 'outro';

export const STAGE_LABELS: Record<CrmAccountStage, string> = {
  prospeccao: 'Prospecção',
  lead_identificado: 'Lead Identificado',
  contato_realizado: 'Contato Realizado',
  oportunidade: 'Oportunidade',
  proposta_enviada: 'Proposta Enviada',
  negociacao: 'Negociação',
  fechamento: 'Fechamento',
};

export const STAGE_DESCRIPTIONS: Record<CrmAccountStage, string> = {
  prospeccao: 'Empresas não abordadas',
  lead_identificado: 'Encontramos/mapeamos contato comercial',
  contato_realizado: 'Houve primeira abordagem',
  oportunidade: 'Existe demanda concreta',
  proposta_enviada: 'Enviou tarifa, acordo ou condição',
  negociacao: 'Cliente avaliando/em negociação',
  fechamento: 'Negócio/acordo fechado',
};

export const STAGE_ORDER: CrmAccountStage[] = [
  'prospeccao',
  'lead_identificado',
  'contato_realizado',
  'oportunidade',
  'proposta_enviada',
  'negociacao',
  'fechamento',
];

export const STAGE_COLORS: Record<CrmAccountStage, string> = {
  prospeccao: 'hsl(220, 10%, 55%)',
  lead_identificado: 'hsl(200, 60%, 55%)',
  contato_realizado: 'hsl(200, 80%, 55%)',
  oportunidade: 'hsl(180, 65%, 45%)',
  proposta_enviada: 'hsl(40, 90%, 55%)',
  negociacao: 'hsl(25, 85%, 55%)',
  fechamento: 'hsl(150, 60%, 45%)',
};

export const FINAL_STAGE: CrmAccountStage = 'fechamento';

export const ACCOUNT_STATUS_LABELS: Record<CrmAccountStatus, string> = {
  ativo: 'Ativo',
  inativo: 'Inativo',
};

export const ACCOUNT_STATUS_COLORS: Record<CrmAccountStatus, string> = {
  ativo: 'hsl(150, 60%, 45%)',
  inativo: 'hsl(0, 0%, 45%)',
};

export const VISIT_TYPE_LABELS: Record<CrmVisitType, string> = {
  visita_presencial: 'Visita Presencial',
  ligacao: 'Ligação',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  reuniao_comercial_interna: 'Reunião comercial interna',
  treinamento: 'Treinamento',
  eventos_feiras: 'Eventos e Feiras',
  outro: 'Outro',
};

export const ACCOUNT_TYPE_LABELS: Record<CrmAccountType, string> = {
  empresa: 'Empresa',
  agencia: 'Agência',
};

export const SUB_SEGMENT_LABELS: Record<CrmAccountSubSegment, string> = {
  evento: 'Evento',
  mensalista: 'Mensalista',
  grupo: 'Grupo',
  rfp: 'RFP',
};

/** Data de hoje no fuso local (evita deslocamento de 1 dia do UTC) */
export const todayLocalISO = (): string => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

/** Converte 'YYYY-MM-DD' em Date local (sem interpretar como UTC) */
const parseDateOnly = (iso: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(iso);
};

export const daysBetween = (dateISO: string | null | undefined): number | null => {
  if (!dateISO) return null;
  const d = parseDateOnly(dateISO);
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

export const formatDateBR = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  return parseDateOnly(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** 'HH:MM:SS' -> 'HH:MM' */
export const formatTimeBR = (time: string | null | undefined): string => {
  if (!time) return '';
  return time.slice(0, 5);
};

export const formatDateTimeBR = (iso: string | null | undefined, time?: string | null): string => {
  if (!iso) return '—';
  const d = formatDateBR(iso);
  const t = formatTimeBR(time);
  return t ? `${d} ${t}` : d;
};

/** Nome exibido de uma conta comercial */
export const accountLabel = (a: { account_type?: string | null; company_name?: string | null; travel_agent_name?: string | null } | null | undefined): string => {
  if (!a) return '—';
  const name = a.account_type === 'agencia' ? a.travel_agent_name : a.company_name;
  return name || a.company_name || a.travel_agent_name || '—';
};

export const formatMoneyBR = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
};
