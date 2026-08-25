import * as XLSX from 'xlsx';
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  STAGE_LABELS,
  SUB_SEGMENT_LABELS,
  VISIT_TYPE_LABELS,
  CrmAccountStage,
  CrmAccountStatus,
  CrmAccountSubSegment,
  CrmAccountType,
  CrmVisitType,
  formatDateBR,
} from '@/lib/crm';

const download = (rows: Record<string, any>[], sheetName: string, fileName: string) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
};

const today = () => new Date().toISOString().slice(0, 10);

const subSegmentLabel = (value?: string | null) =>
  value ? SUB_SEGMENT_LABELS[value as CrmAccountSubSegment] ?? value : '';

export const exportAccountsToExcel = (
  accounts: any[],
  userName: (userId: string | null) => string,
) => {
  const rows = accounts.map((a) => ({
    'Tipo': ACCOUNT_TYPE_LABELS[a.account_type as CrmAccountType] ?? a.account_type,
    'Nome': (a.account_type === 'agencia' ? a.travel_agent_name : a.company_name) || '',
    'Cidade': a.city || '',
    'Segmento': a.segment || '',
    'Subsegmentação': subSegmentLabel(a.sub_segment),
    'Hotéis atendidos': (a.properties || []).join(', '),
    'Estágio do Funil': STAGE_LABELS[a.stage as CrmAccountStage] ?? a.stage,
    'Status da Conta': a.account_status ? ACCOUNT_STATUS_LABELS[a.account_status as CrmAccountStatus] : '',
    'Data de Fechamento': a.closed_at ? formatDateBR(a.closed_at) : '',
    'Contato': a.contact_name || '',
    'E-mail': a.contact_email || '',
    'Telefone': a.contact_phone || '',
    'Executivo Comercial': userName(a.responsible_user_id ?? null),
    'Tarifa Acordo': a.agreed_rate ?? '',
    'Roomnights Acordo': a.agreed_roomnights ?? '',
    'Receita Projetada': a.projected_revenue ?? '',
    'Início da Vigência': a.agreement_start ? formatDateBR(a.agreement_start) : '',
    'Fim da Vigência': a.agreement_end ? formatDateBR(a.agreement_end) : '',
    'Anexo': a.attachment_name || '',
    'Observações': a.notes || '',
    'Última Interação': (() => {
      const last = (a.crm_visits || []).map((v: any) => v.visit_date).sort().pop();
      return last ? formatDateBR(last) : '';
    })(),
  }));
  download(rows, 'Contas Comerciais', `contas-comerciais-${today()}.xlsx`);
};

export const exportVisitsToExcel = (
  visits: any[],
  userName: (userId: string | null) => string,
) => {
  const rows = visits.map((v) => {
    const acc = v.crm_accounts || {};
    return {
      'Data': formatDateBR(v.visit_date),
      'Tipo de Interação': VISIT_TYPE_LABELS[v.visit_type as CrmVisitType] ?? v.visit_type,
      'Conta': (acc.account_type === 'agencia' ? acc.travel_agent_name : acc.company_name) || '',
      'Cidade': acc.city || '',
      'Subsegmentação': subSegmentLabel(acc.sub_segment),
      'Hotéis atendidos': (acc.properties || []).join(', '),
      'Estágio do Funil': acc.stage ? STAGE_LABELS[acc.stage as CrmAccountStage] : '',
      'Resumo': v.summary || '',
      'Próximo Follow-up': v.next_follow_up_date ? formatDateBR(v.next_follow_up_date) : '',
      'Hora do Follow-up': v.follow_up_time ? String(v.follow_up_time).slice(0, 5) : '',
      'Tipo do Follow-up': v.follow_up_type ? VISIT_TYPE_LABELS[v.follow_up_type as CrmVisitType] ?? v.follow_up_type : '',
      'Follow-up Concluído': v.next_follow_up_date ? (v.follow_up_done ? 'Sim' : 'Não') : '',
      'Observações do Follow-up': v.follow_up_notes || '',
      'Anexo': v.attachment_name || '',
      'Registrado por': userName(v.created_by ?? null),
    };
  });
  download(rows, 'Interações', `interacoes-comerciais-${today()}.xlsx`);
};

