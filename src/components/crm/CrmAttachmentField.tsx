import React, { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Paperclip, Loader2, X, Download } from 'lucide-react';
import { toast } from 'sonner';

export interface AttachmentValue {
  path: string | null;
  name: string | null;
}

interface Props {
  label?: string;
  scope: string;
  value: AttachmentValue;
  onChange: (value: AttachmentValue) => void;
  disabled?: boolean;
}

export const openAttachment = async (path: string) => {
  const { data, error } = await supabase.storage.from('crm-attachments').createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    toast.error('Não foi possível abrir o anexo');
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
};

const CrmAttachmentField: React.FC<Props> = ({ label = 'Anexo', scope, value, onChange, disabled }) => {
  const { tenantId } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!tenantId) {
      toast.error('Sem tenant ativo');
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${tenantId}/${scope}/${Date.now()}_${safe}`;
      const { error } = await supabase.storage.from('crm-attachments').upload(path, file, { upsert: false });
      if (error) throw error;
      onChange({ path, name: file.name });
      toast.success('Anexo enviado');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar anexo');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {value.path ? (
        <div className="mt-1 flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          <button type="button" onClick={() => openAttachment(value.path!)} className="flex-1 truncate text-left text-primary hover:underline">
            {value.name || 'Anexo'}
          </button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1" disabled={disabled}
                  onClick={() => onChange({ path: null, name: null })}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="mt-1 w-full"
                disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1 h-3.5 w-3.5" />}
          {uploading ? 'Enviando...' : 'Anexar arquivo'}
        </Button>
      )}
    </div>
  );
};

export const AttachmentLink: React.FC<{ path?: string | null; name?: string | null }> = ({ path, name }) => {
  if (!path) return null;
  return (
    <button type="button" onClick={() => openAttachment(path)}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      <Download className="h-3 w-3" /> {name || 'Anexo'}
    </button>
  );
};

export default CrmAttachmentField;
