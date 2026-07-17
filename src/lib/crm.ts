export type CrmAccountStage =
  | 'prospectado'
  | 'contatado'
  | 'em_negociacao'
  | 'cliente_ativo'
  | 'inativo';

export type CrmAccountType = 'empresa' | 'agencia';

export type CrmVisitType =
  | 'visita_presencial'
  | 'ligacao'
  | 'email'
  | 'whatsapp'
  | 'outro';

export const STAGE_LABELS: Record<CrmAccountStage, string> = {
  prospectado: 'Prospectado',
  contatado: 'Contatado',
  em_negociacao: 'Em Negociação',
  cliente_ativo: 'Cliente Ativo',
  inativo: 'Inativo',
};

export const STAGE_ORDER: CrmAccountStage[] = [
  'prospectado',
  'contatado',
  'em_negociacao',
  'cliente_ativo',
  'inativo',
];

export const STAGE_COLORS: Record<CrmAccountStage, string> = {
  prospectado: 'hsl(220, 10%, 50%)',
  contatado: 'hsl(200, 80%, 55%)',
  em_negociacao: 'hsl(40, 90%, 55%)',
  cliente_ativo: 'hsl(150, 60%, 45%)',
  inativo: 'hsl(0, 0%, 40%)',
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
