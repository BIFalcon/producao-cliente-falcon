import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { CrmVisitType, VISIT_TYPE_LABELS, todayLocalISO } from '@/lib/crm';

interface VisitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  visit?: any | null;
}

const VisitFormDialog: React.FC<VisitFormDialogProps> = ({ open, onOpenChange, accountId, visit }) => {
  const { user, tenantId } = useAuth();
  const qc = useQueryClient();

  const [visitType, setVisitType] = useState<CrmVisitType>('visita_presencial');
  const [visitDate, setVisitDate] = useState<string>(todayLocalISO());
  const [summary, setSummary] = useState('');
  const [nextFollowUp, setNextFollowUp] = useState('');

  useEffect(() => {
    if (visit) {
      setVisitType(visit.visit_type);
      setVisitDate(visit.visit_date);
      setSummary(visit.summary);
      setNextFollowUp(visit.next_follow_up_date || '');
    } else {
      setVisitType('visita_presencial');
      setVisitDate(todayLocalISO());
      setSummary('');
      setNextFollowUp('');
    }
  }, [visit, open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('Sem tenant ativo');
      if (!summary.trim()) throw new Error('Resumo é obrigatório');
      const payload: any = {
        tenant_id: tenantId,
        account_id: accountId,
        visit_type: visitType,
        visit_date: visitDate,
        summary: summary.trim(),
        next_follow_up_date: nextFollowUp || null,
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
      toast.success(visit?.id ? 'Visita atualizada' : 'Visita registrada');
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith('crm-') });
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao salvar'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{visit?.id ? 'Editar Visita' : 'Registrar Nova Interação'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
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
          <div>
            <Label className="text-xs">Próximo Follow-up</Label>
            <Input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
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

export default VisitFormDialog;
