import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { CrmAccountStage, CrmAccountType, STAGE_LABELS } from '@/lib/crm';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const normalize = (v: any): string =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

const STAGE_FROM_SHEET: Record<string, CrmAccountStage> = {
  'prospeccao': 'prospeccao',
  'contato inicial': 'contato_realizado',
  'contato realizado': 'contato_realizado',
  'lead identificado': 'lead_identificado',
  'oportunidade': 'oportunidade',
  'proposta enviada': 'proposta_enviada',
  'negociacao': 'negociacao',
  'fechamento': 'fechamento',
};

const COLUMNS: Record<string, string> = {
  'tipo': 'tipo',
  'empresa alvo': 'nome',
  'cidade': 'cidade',
  'segmento': 'segmento',
  'hotel': 'hotel',
  'hoteis': 'hotel',
  'estagio do funil': 'estagio',
  'estagio': 'estagio',
  'contato': 'contato',
  'e-mail': 'email',
  'email': 'email',
  'telefone': 'telefone',
  'executivo comercial': 'executivo',
  'proxima acao': 'proxima_acao',
  'data proxima acao': 'data_proxima_acao',
  'data fechamento': 'data_fechamento',
  'observacoes': 'observacoes',
};

interface Row {
  line: number;
  account_type: CrmAccountType;
  name: string;
  city: string | null;
  segment: string | null;
  properties: string[];
  unknownHotels: string[];
  stage: CrmAccountStage;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  executivoText: string;
  responsible_user_id: string | null;
  notes: string | null;
}

const formatCell = (v: any): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('pt-BR');
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    const d = new Date(Math.floor(v - 25569) * 86400 * 1000);
    return d.toLocaleDateString('pt-BR');
  }
  return String(v).trim();
};

const AccountImportDialog: React.FC<Props> = ({ open, onOpenChange }) => {
  const { tenantId, user } = useAuth();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');

  const { data: allProperties } = useQuery({
    queryKey: ['crm-account-properties', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_filter_options', { p_tenant_id: tenantId });
      return (data?.[0]?.properties || []) as string[];
    },
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['crm-tenant-users', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_tenant_users_basic', { p_tenant_id: tenantId });
      return (data || []) as { user_id: string; full_name: string }[];
    },
  });

  const reset = () => { setRows(null); setFileName(''); };

  const handleFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });

      let headerIdx = -1;
      for (let i = 0; i < Math.min(matrix.length, 15); i++) {
        const keys = (matrix[i] || []).map((c) => COLUMNS[normalize(c)]);
        if (keys.includes('nome') && keys.includes('tipo')) { headerIdx = i; break; }
      }
      if (headerIdx === -1) throw new Error('Cabeçalho não encontrado. A planilha precisa ter as colunas "Tipo" e "Empresa Alvo".');

      const headers = (matrix[headerIdx] || []).map((c) => COLUMNS[normalize(c)] || '');
      const propByNorm = new Map((allProperties || []).map((p) => [normalize(p), p]));
      const userByNorm = new Map((tenantUsers || []).map((u) => [normalize(u.full_name), u.user_id]));

      const parsed: Row[] = [];
      for (let r = headerIdx + 1; r < matrix.length; r++) {
        const raw = matrix[r] || [];
        const rec: Record<string, string> = {};
        headers.forEach((key, c) => { if (key) rec[key] = formatCell(raw[c]); });
        if (!rec.nome) continue;

        const isAgencia = normalize(rec.tipo).startsWith('agenc');
        const hotelsText = rec.hotel || '';
        const hotelParts = hotelsText.split(/[,;/|]/).map((h) => h.trim()).filter(Boolean);
        const properties: string[] = [];
        const unknownHotels: string[] = [];
        hotelParts.forEach((h) => {
          const match = propByNorm.get(normalize(h));
          if (match) properties.push(match);
          else unknownHotels.push(h);
        });

        const notesParts: string[] = [];
        if (rec.observacoes) notesParts.push(rec.observacoes);
        if (rec.proxima_acao) notesParts.push(`Próxima Ação: ${rec.proxima_acao}`);
        if (rec.data_proxima_acao) notesParts.push(`Data Próxima Ação: ${rec.data_proxima_acao}`);
        if (rec.data_fechamento) notesParts.push(`Data Fechamento: ${rec.data_fechamento}`);

        parsed.push({
          line: r + 1,
          account_type: isAgencia ? 'agencia' : 'empresa',
          name: rec.nome,
          city: rec.cidade || null,
          segment: rec.segmento || null,
          properties,
          unknownHotels,
          stage: STAGE_FROM_SHEET[normalize(rec.estagio)] || 'prospeccao',
          contact_name: rec.contato || null,
          contact_email: rec.email || null,
          contact_phone: rec.telefone || null,
          executivoText: rec.executivo || '',
          responsible_user_id: rec.executivo ? (userByNorm.get(normalize(rec.executivo)) ?? null) : null,
          notes: notesParts.length > 0 ? notesParts.join('\n') : null,
        });
      }

      if (parsed.length === 0) throw new Error('Nenhuma linha de dados encontrada');
      setFileName(file.name);
      setRows(parsed);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao ler planilha');
      reset();
    }
  };

  const unknownHotels = useMemo(() => {
    if (!rows) return [];
    const set = new Set<string>();
    rows.forEach((r) => r.unknownHotels.forEach((h) => set.add(h)));
    return [...set];
  }, [rows]);

  const missingExecutives = useMemo(
    () => (rows || []).filter((r) => r.executivoText && !r.responsible_user_id),
    [rows]
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!tenantId || !rows) throw new Error('Sem tenant ativo');
      const payload = rows.map((r) => ({
        tenant_id: tenantId,
        account_type: r.account_type,
        company_name: r.account_type === 'empresa' ? r.name : null,
        travel_agent_name: r.account_type === 'agencia' ? r.name : null,
        city: r.city,
        segment: r.segment,
        properties: r.properties,
        stage: r.stage,
        account_status: r.stage === 'fechamento' ? 'ativo' : null,
        contact_name: r.contact_name,
        contact_email: r.contact_email,
        contact_phone: r.contact_phone,
        responsible_user_id: r.responsible_user_id ?? user?.id ?? null,
        notes: r.notes,
      }));
      const { error } = await (supabase.from('crm_accounts') as any).insert(payload);
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} conta(s) importada(s)`);
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith('crm-') });
      if (missingExecutives.length === 0) {
        onOpenChange(false);
        reset();
      }
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao importar'),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Contas Comerciais</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Planilha Excel (.xlsx)</Label>
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Colunas: Tipo, Empresa Alvo, Cidade, Segmento, Hotel, Estagio do Funil, Contato, e-mail, Telefone,
              Executivo Comercial, Próxima Ação, Data Próxima Ação, Data Fechamento.
            </p>
          </div>

          {rows && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-foreground">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span>{fileName} — <strong>{rows.length}</strong> linha(s) prontas</span>
              </div>

              {unknownHotels.length > 0 && (
                <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-medium text-yellow-600">
                    <AlertTriangle className="h-3.5 w-3.5" /> Hotéis não reconhecidos
                  </div>
                  <ul className="list-disc pl-4 text-muted-foreground">
                    {unknownHotels.map((h) => <li key={h}>{h}</li>)}
                  </ul>
                  <p className="mt-1 text-muted-foreground">
                    Corrija os nomes na planilha para que fiquem iguais aos hotéis cadastrados antes de importar.
                  </p>
                </div>
              )}

              {missingExecutives.length > 0 && (
                <div className="rounded-md border border-border/60 p-3 text-xs">
                  <div className="mb-1 font-medium text-foreground">
                    Executivo não encontrado ({missingExecutives.length} linha(s)) — revisar manualmente
                  </div>
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto text-muted-foreground">
                    {missingExecutives.map((r) => (
                      <li key={r.line}>Linha {r.line}: {r.name} — "{r.executivoText}"</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="max-h-48 overflow-auto rounded-md border border-border/60">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/50 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Nome</th>
                      <th className="px-2 py-1.5 text-left">Tipo</th>
                      <th className="px-2 py-1.5 text-left">Estágio</th>
                      <th className="px-2 py-1.5 text-left">Hotéis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r) => (
                      <tr key={r.line} className="border-t border-border/40">
                        <td className="px-2 py-1.5 text-foreground">{r.name}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.account_type === 'agencia' ? 'Agência' : 'Empresa'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{STAGE_LABELS[r.stage]}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.properties.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {unknownHotels.length === 0 && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Todos os hotéis foram reconhecidos.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { onOpenChange(false); reset(); }}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!rows || unknownHotels.length > 0 || mutation.isPending}
          >
            {mutation.isPending ? 'Importando...' : 'Importar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AccountImportDialog;
