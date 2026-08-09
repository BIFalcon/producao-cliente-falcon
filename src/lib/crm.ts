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

export type CrmVisitType =
  | 'visita_presencial'
  | 'ligacao'
  | 'email'
  | 'whatsapp'
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
  outro: 'Outro',
};

export const ACCOUNT_TYPE_LABELS: Record<CrmAccountType, string> = {
  empresa: 'Empresa',
  agencia: 'Agência',
};

export const daysBetween = (dateISO: string | null | undefined): number | null => {
  if (!dateISO) return null;
  const d = new Date(dateISO);
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

export const formatDateBR = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
