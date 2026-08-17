import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_STATUS_LABELS,
  CrmAccountStage,
  CrmAccountStatus,
  CrmAccountType,
  FINAL_STAGE,
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  STAGE_ORDER,
} from '@/lib/crm';

interface AccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: any | null;
}

const AccountFormDialog: React.FC<AccountFormDialogProps> = ({ open, onOpenChange, account }) => {
  const { tenantId, user } = useAuth();
  const qc = useQueryClient();

  const [accountType, setAccountType] = useState<CrmAccountType>('empresa');
  const [companyName, setCompanyName] = useState('');
  const [travelAgentName, setTravelAgentName] = useState('');
  const [city, setCity] = useState('');
  const [segment, setSegment] = useState('');
  const [stage, setStage] = useState<CrmAccountStage>('prospeccao');
  const [accountStatus, setAccountStatus] = useState<CrmAccountStatus | null>(null);
  const [notes, setNotes] = useState('');
  const [properties, setProperties] = useState<string[]>([]);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState<string | null>(null);


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

  const responsibleName = account?.responsible_user_id
    ? tenantUsers?.find((u) => u.user_id === account.responsible_user_id)?.full_name || null
    : null;

  const toggleProperty = (prop: string) => {
    setProperties((prev) => (prev.includes(prop) ? prev.filter((p) => p !== prop) : [...prev, prop]));
  };

  useEffect(() => {
    if (account) {
      setAccountType(account.account_type);
      setCompanyName(account.company_name || '');
      setTravelAgentName(account.travel_agent_name || '');
      setCity(account.city || '');
      setSegment(account.segment || '');
      setStage(account.stage);
      setAccountStatus(account.account_status ?? null);
      setNotes(account.notes || '');
      setProperties(account.properties || []);
      setContactName(account.contact_name || '');
      setContactEmail(account.contact_email || '');
      setContactPhone(account.contact_phone || '');
      setResponsibleUserId(account.responsible_user_id ?? null);

    } else {
      setAccountType('empresa');
      setCompanyName('');
      setTravelAgentName('');
      setCity('');
      setSegment('');
      setStage('prospeccao');
      setAccountStatus(null);
      setNotes('');
      setProperties([]);
      setContactName('');
      setContactEmail('');
      setContactPhone('');
      setResponsibleUserId(user?.id ?? null);

    }
  }, [account, open]);

  // O Status da Conta só existe a partir do estágio "Fechamento" e nasce como Ativo.
  useEffect(() => {
    if (stage === FINAL_STAGE) {
      setAccountStatus((prev) => prev ?? 'ativo');
    } else {
      setAccountStatus(null);
    }
  }, [stage]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('Sem tenant ativo');
      const payload: any = {
        tenant_id: tenantId,
        account_type: accountType,
        company_name: accountType === 'empresa' ? companyName.trim() : (companyName.trim() || null),
        travel_agent_name: accountType === 'agencia' ? travelAgentName.trim() : (travelAgentName.trim() || null),
        city: city.trim() || null,
        segment: segment.trim() || null,
        stage,
        account_status: stage === FINAL_STAGE ? (accountStatus ?? 'ativo') : null,
        notes: notes.trim() || null,
        properties,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      };
      payload.responsible_user_id = responsibleUserId ?? (account?.id ? null : user?.id ?? null);
      if (accountType === 'empresa' && !payload.company_name) throw new Error('Nome da empresa é obrigatório');
      if (accountType === 'agencia' && !payload.travel_agent_name) throw new Error('Nome da agência é obrigatório');

      if (account?.id) {
        const { error } = await (supabase.from('crm_accounts') as any).update(payload).eq('id', account.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from('crm_accounts') as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(account?.id ? 'Conta atualizada' : 'Conta criada');
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith('crm-') });
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao salvar'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{account?.id ? 'Editar Conta' : 'Nova Conta Comercial'}</DialogTitle>
        </DialogHeader>
        <div className="grid flex-1 gap-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={accountType} onValueChange={(v) => setAccountType(v as CrmAccountType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACCOUNT_TYPE_LABELS) as CrmAccountType[]).map((t) => (
                    <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Estágio do Funil</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as CrmAccountStage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGE_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="flex flex-col">
                        <span>{STAGE_LABELS[s]}</span>
                        <span className="text-xs text-muted-foreground">{STAGE_DESCRIPTIONS[s]}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{STAGE_DESCRIPTIONS[stage]}</p>
            </div>
          </div>

          {stage === FINAL_STAGE && (
            <div>
              <Label className="text-xs">Status da Conta</Label>
              <Select
                value={accountStatus ?? 'ativo'}
                onValueChange={(v) => setAccountStatus(v as CrmAccountStatus)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACCOUNT_STATUS_LABELS) as CrmAccountStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Nasce como Ativo no Fechamento. Marque Inativo se o cliente parar de gerar movimento.
              </p>
            </div>
          )}

          {accountType === 'empresa' ? (
            <div>
              <Label className="text-xs">Nome da Empresa *</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Ex: Petrobras S.A." />
            </div>
          ) : (
            <div>
              <Label className="text-xs">Nome da Agência *</Label>
              <Input value={travelAgentName} onChange={(e) => setTravelAgentName(e.target.value)} placeholder="Ex: CVC Corp" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cidade</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Segmento</Label>
              <Input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="Ex: Óleo & Gás" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Contato</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome da pessoa de contato" />
            </div>
            <div>
              <Label className="text-xs">Telefone</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="(21) 99999-9999" />
            </div>
          </div>

          <div>
            <Label className="text-xs">E-mail</Label>
            <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="contato@empresa.com" />
          </div>

          <div>
            <Label className="text-xs">Executivo responsável</Label>
            <Select value={responsibleUserId ?? 'none'} onValueChange={(v) => setResponsibleUserId(v === 'none' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar executivo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— não vinculado</SelectItem>
                {(tenantUsers || []).map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {account?.id
                ? `Atual: ${responsibleName || '— não vinculado'}`
                : 'Preenchido automaticamente com você; pode ser alterado.'}
            </p>
          </div>


          <div>
            <Label className="text-xs">Hotéis atendidos</Label>
            {allProperties && allProperties.length > 0 ? (
              <div className="mt-1 max-h-40 space-y-2 overflow-y-auto rounded-md border border-border/60 p-3">
                {allProperties.map((prop) => (
                  <label key={prop} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={properties.includes(prop)} onCheckedChange={() => toggleProperty(prop)} />
                    <span className="text-foreground">{prop}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Nenhum hotel disponível. Importe dados primeiro.</p>
            )}
            {properties.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">{properties.length} hotel(is) selecionado(s)</p>
            )}
          </div>

          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AccountFormDialog;
