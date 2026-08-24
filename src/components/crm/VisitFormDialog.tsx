import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import CrmAttachmentField from '@/components/crm/CrmAttachmentField';
import { useCrmAccountOptions } from '@/hooks/useCrmAccountOptions';
import { CrmVisitType, VISIT_TYPE_LABELS, todayLocalISO, accountLabel } from '@/lib/crm';

interface VisitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quando ausente, o usuário escolhe a conta no próprio formulário */
  accountId?: string;
  visit?: any | null;
}

const VisitFormDialog: React.FC<VisitFormDialogProps> = ({ open, onOpenChange, accountId, visit }) => {
  const { user, tenantId } = useAuth();
  const qc = useQueryClient();
  const { data: accountOptions } = useCrmAccountOptions();

  const [selectedAccountId, setSelectedAccountId] = useState<string>(accountId || '');
  const [visitType, setVisitType] = useState<CrmVisitType>('visita_presencial');
  const [visitDate, setVisitDate] = useState<string>(todayLocalISO());
  const [summary, setSummary] = useState('');
  const [nextFollowUp, setNextFollowUp] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [followUpType, setFollowUpType] = useState<CrmVisitType | null>(null);
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [followUpDone, setFollowUpDone] = useState(false);
  const [attachment, setAttachment] = useState<{ path: string | null; name: string | null }>({ path: null, name: null });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (visit) {
      setSelectedAccountId(visit.account_id);
      setVisitType(visit.visit_type);
      setVisitDate(visit.visit_date);
      setSummary(visit.summary);
      setNextFollowUp(visit.next_follow_up_date || '');
      setFollowUpTime(visit.follow_up_time ? String(visit.follow_up_time).slice(0, 5) : '');
      setFollowUpType((visit.follow_up_type as CrmVisitType) ?? null);
      setFollowUpNotes(visit.follow_up_notes || '');
      setFollowUpDone(!!visit.follow_up_done);
      setAttachment({ path: visit.attachment_path ?? null, name: visit.attachment_name ?? null });
    } else {
      setSelectedAccountId(accountId || '');
      setVisitType('visita_presencial');
      setVisitDate(todayLocalISO());
      setSummary('');
      setNextFollowUp('');
      setFollowUpTime('');
      setFollowUpType(null);
      setFollowUpNotes('');
      setFollowUpDone(false);
      setAttachment({ path: null, name: null });
    }
  }, [visit, open, accountId]);

  const selectedAccount = useMemo(
    () => accountOptions?.find((a) => a.id === selectedAccountId),
    [accountOptions, selectedAccountId],
  );

  const invalidate = () =>
    qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith('crm-') });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('Sem tenant ativo');
      if (!selectedAccountId) throw new Error('Selecione a empresa/conta');
      if (!summary.trim()) throw new Error('Resumo é obrigatório');
      const payload: any = {
        tenant_id: tenantId,
        account_id: selectedAccountId,
        visit_type: visitType,
        visit_date: visitDate,
        summary: summary.trim(),
        next_follow_up_date: nextFollowUp || null,
        follow_up_time: nextFollowUp && followUpTime ? followUpTime : null,
        follow_up_type: nextFollowUp ? followUpType : null,
        follow_up_notes: nextFollowUp ? (followUpNotes.trim() || null) : null,
        follow_up_done: nextFollowUp ? followUpDone : false,
        follow_up_completed_at: nextFollowUp && followUpDone ? new Date().toISOString() : null,
        attachment_path: attachment.path,
        attachment_name: attachment.name,
      };
      if (visit?.id) {
        const { error } = await (supabase.from('crm_visits') as any).update(payload).eq('id', visit.id);
        if (error) throw error;
      } else {
        payload.created_by = user?.id;
        const { error } = await (supabase.from('crm_visits') as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(visit?.id ? 'Atividade atualizada' : 'Atividade registrada');
      invalidate();
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao salvar'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from('crm_visits') as any).delete().eq('id', visit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Atividade excluída');
      invalidate();
      setConfirmDelete(false);
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao excluir'),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle>{visit?.id ? 'Editar Atividade' : 'Nova Atividade / Interação'}</DialogTitle>
          </DialogHeader>
          <div className="grid flex-1 gap-3 overflow-y-auto pr-1">
            {!accountId && (
              <div>
                <Label className="text-xs">Empresa / Conta *</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar conta" /></SelectTrigger>
                  <SelectContent>
                    {(accountOptions || []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hotel(is): {selectedAccount?.properties?.length ? selectedAccount.properties.join(', ') : '—'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={visitType} onValueChange={(v) => setVisitType(v as CrmVisitType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VISIT_TYPE_LABELS) as CrmVisitType[]).map((t) => (
                      <SelectItem key={t} value={t}>{VISIT_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Data</Label>
                <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs">Resumo *</Label>
              <Textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="O que foi conversado, próximos passos, decisores..." />
            </div>

            <CrmAttachmentField scope="visitas" value={attachment} onChange={setAttachment} />

            <div className="rounded-md border border-border/60 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Próximo Follow-up (vai para Tarefas Futuras)
              </div>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Data</Label>
                    <Input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Horário</Label>
                    <Input type="time" value={followUpTime} onChange={(e) => setFollowUpTime(e.target.value)} disabled={!nextFollowUp} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Tipo de atividade</Label>
                  <Select
                    value={followUpType ?? 'none'}
                    onValueChange={(v) => setFollowUpType(v === 'none' ? null : (v as CrmVisitType))}
                    disabled={!nextFollowUp}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— não informado</SelectItem>
                      {(Object.keys(VISIT_TYPE_LABELS) as CrmVisitType[]).map((t) => (
                        <SelectItem key={t} value={t}>{VISIT_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Observações do follow-up</Label>
                  <Textarea rows={2} value={followUpNotes} onChange={(e) => setFollowUpNotes(e.target.value)} disabled={!nextFollowUp} />
                </div>
                {visit?.id && nextFollowUp && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox checked={followUpDone} onCheckedChange={(c) => setFollowUpDone(!!c)} />
                    <span>Tarefa concluída (sai de Tarefas Futuras)</span>
                  </label>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row items-center justify-between sm:justify-between">
            {visit?.id ? (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Excluir
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta atividade?</AlertDialogTitle>
            <AlertDialogDescription>
              A interação será removida permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default VisitFormDialog;
