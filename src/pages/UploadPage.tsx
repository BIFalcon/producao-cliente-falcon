import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { parseCSV, chunkArray, type ParsedRow } from '@/lib/csv-parser';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Upload, Replace, PlusCircle, ArrowLeft, FileSpreadsheet, Loader2, Table2, MapPin, Building2, AlertTriangle, History, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';

const CHUNK_SIZE = 1000;
const MAX_RETRIES = 3;
const PARALLEL_CHUNKS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invokeWithRetry(
  fnName: string,
  body: any,
  tenantId: string,
  onAttempt?: (attempt: number, err: any) => void
): Promise<void> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { error } = await supabase.functions.invoke(fnName, {
        body,
        headers: { 'x-tenant-id': tenantId },
      });
      if (error) throw error;
      return;
    } catch (err: any) {
      lastErr = err;
      onAttempt?.(attempt, err);
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * attempt);
      }
    }
  }
  throw lastErr;
}

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const ACCEPTED_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

const isValidFile = (file: File): boolean => {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  return ACCEPTED_EXTENSIONS.includes(ext) || ACCEPTED_TYPES.includes(file.type);
};

const isExcelFile = (file: File): boolean => {
  const name = file.name.toLowerCase();
  return name.endsWith('.xlsx') || name.endsWith('.xls');
};

interface SheetInfo {
  name: string;
  rowCount: number;
}

const normalizeText = (str: string): string => {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
};

// ─── Loading guard component ───────────────────────────────────────────────
const TenantLoadingGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { roleLoading, loading, tenantId, isSuperAdmin, setActiveTenantId } = useAuth();

  const { data: tenants } = useQuery({
    queryKey: ['all-tenants-guard'],
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_all_tenants');
      return (data || []) as { id: string; name: string; is_active: boolean }[];
    },
    enabled: isSuperAdmin,
  });

  // Auth still initializing
  if (loading || roleLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Verificando permissões...</p>
      </div>
    );
  }

  // Non-super_admin without tenant — configuration error
  if (!isSuperAdmin && !tenantId) {
    return (
      <div className="mx-auto max-w-md mt-16 surface-card p-6 text-center space-y-3">
        <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto" />
        <p className="text-sm font-medium text-foreground">Tenant não configurado</p>
        <p className="text-xs text-muted-foreground">
          Sua conta não está associada a nenhum tenant. Entre em contato com o administrador do sistema.
        </p>
      </div>
    );
  }

  // super_admin without tenant selected — show inline selector
  if (isSuperAdmin && !tenantId) {
    return (
      <div className="mx-auto max-w-md mt-16 surface-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Selecione um tenant para continuar</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Escolha o cliente para o qual deseja enviar dados.
            </p>
          </div>
        </div>
        <Select onValueChange={(v) => setActiveTenantId(v || null)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecionar Tenant" />
          </SelectTrigger>
          <SelectContent>
            {(tenants || []).filter(t => t.is_active).map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return <>{children}</>;
};

// ─── Upload History section ───────────────────────────────────────────────
const UploadHistory: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const { data: batches, isLoading } = useQuery({
    queryKey: ['upload-history', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('upload_batches')
        .select('id, created_at, file_name, mode, total_rows, status')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: (query) => {
      const data = query.state.data as any[] | undefined;
      const hasActive = data?.some((b: any) => b.status === 'uploading' || b.status === 'processing');
      return hasActive ? 10_000 : false;
    },
  });

  const formatDateTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  const renderStatus = (status: string | null) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 gap-1">
            <CheckCircle2 className="h-3 w-3" /> Concluído
          </Badge>
        );
      case 'uploading':
      case 'processing':
        return (
          <Badge variant="outline" className="border-yellow-500/30 bg-yellow-500/10 text-yellow-400 gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> {status === 'uploading' ? 'Enviando' : 'Processando'}
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive gap-1">
            <XCircle className="h-3 w-3" /> Erro
          </Badge>
        );
      default:
        return <Badge variant="outline" className="text-muted-foreground">{status || '—'}</Badge>;
    }
  };

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-foreground flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        Histórico de Uploads
      </h2>
      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Data/hora</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Arquivo</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Modo</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Registros</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : batches && batches.length > 0 ? (
                batches.map((b: any) => (
                  <tr key={b.id} className="border-b" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    <td className="px-3 py-2 text-foreground/80 text-xs whitespace-nowrap">{formatDateTime(b.created_at)}</td>
                    <td className="px-3 py-2 text-foreground text-xs truncate max-w-[200px]">{b.file_name || '—'}</td>
                    <td className="px-3 py-2 text-xs text-foreground/80">{b.mode === 'replace' ? 'Substituir' : b.mode === 'append' ? 'Adicionar' : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground/80">{(b.total_rows || 0).toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2">{renderStatus(b.status)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">Nenhum upload registrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Main component ────────────────────────────────────────────────────────
const UploadPage = () => {
  const { user, tenantId, isSuperAdmin, setActiveTenantId, roleLoading, loading } = useAuth();
  const queryClient = useQueryClient();

  const { data: tenants } = useQuery({
    queryKey: ['all-tenants-upload'],
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('get_all_tenants');
      return (data || []) as { id: string; name: string; is_active: boolean }[];
    },
    enabled: isSuperAdmin,
  });

  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Excel sheet selection
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [loadingSheets, setLoadingSheets] = useState(false);

  // Mapping file state
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [uploadingMapping, setUploadingMapping] = useState(false);
  const [mappingCount, setMappingCount] = useState<number | null>(null);

  const resetSheets = () => {
    setSheets([]);
    setSelectedSheet('');
  };

  const detectSheets = async (excelFile: File) => {
    setLoadingSheets(true);
    try {
      const sizeMB = excelFile.size / (1024 * 1024);
      if (sizeMB > 50) {
        toast.warning(
          `Arquivo grande (${sizeMB.toFixed(0)} MB). Recomendamos converter para .CSV antes de enviar — arquivos Excel acima de 50 MB podem exceder a memória do navegador.`,
          { duration: 8000 }
        );
      }

      const buffer = await excelFile.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), {
        type: 'array',
        cellDates: false,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
      });

      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Arquivo Excel inválido ou sem abas legíveis.');
      }

      const sheetList: SheetInfo[] = workbook.SheetNames
        .map((name: string) => {
          const sheet = workbook.Sheets[name];
          if (!sheet || !sheet['!ref']) return { name, rowCount: 0 };
          try {
            const range = XLSX.utils.decode_range(sheet['!ref']);
            return { name, rowCount: range.e.r };
          } catch {
            return { name, rowCount: 0 };
          }
        })
        .filter(s => s.rowCount > 0);

      if (sheetList.length === 0) throw new Error('Nenhuma aba com dados foi encontrada no arquivo.');

      setSheets(sheetList);
      (excelFile as any).__workbook = workbook;

      if (sheetList.length === 1) {
        setSelectedSheet(sheetList[0].name);
      } else {
        setSelectedSheet('');
        toast.info(`${sheetList.length} abas encontradas. Selecione qual importar.`);
      }
    } catch (err: any) {
      console.error('Sheet detection error:', err);
      const msg = err?.message || String(err);
      const friendly = msg.includes('!ref') || msg.includes('undefined')
        ? 'Não foi possível ler o arquivo Excel. Ele pode estar corrompido ou ser muito grande para o navegador. Tente salvar como .CSV e enviar novamente.'
        : `Erro ao ler arquivo Excel: ${msg}`;
      toast.error(friendly, { duration: 8000 });
      setFile(null);
    } finally {
      setLoadingSheets(false);
    }
  };

  const handleFileSelected = (selectedFile: File) => {
    if (!isValidFile(selectedFile)) {
      toast.error('Formato não suportado. Envie um arquivo .csv, .xlsx ou .xls');
      return;
    }
    setFile(selectedFile);
    resetSheets();
    if (isExcelFile(selectedFile)) {
      detectSheets(selectedFile);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelected(droppedFile);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFileSelected(selectedFile);
  };

  const COLUMN_MAP: Record<string, string> = {
    'property name': 'property_name', 'property': 'property_name', 'hotel': 'property_name', 'nome do hotel': 'property_name',
    'reservation status': 'reservation_status', 'status': 'reservation_status', 'status da reserva': 'reservation_status',
    'confirmation number': 'confirmation_number', 'confirmation': 'confirmation_number', 'numero de confirmacao': 'confirmation_number', 'numero confirmacao': 'confirmation_number',
    'reservation date': 'reservation_date', 'data da reserva': 'reservation_date',
    'arrival date': 'arrival_date', 'data de chegada': 'arrival_date', 'checkin': 'arrival_date', 'check-in': 'arrival_date',
    'arrival time': 'arrival_time',
    'departure date': 'departure_date', 'data de saida': 'departure_date', 'checkout': 'departure_date', 'check-out': 'departure_date',
    'departure time': 'departure_time',
    'number of nights': 'number_of_nights', 'nights': 'number_of_nights', 'numero de noites': 'number_of_nights', 'noites': 'number_of_nights',
    'travel agent name': 'travel_agent_name', 'travel agent': 'travel_agent_name', 'agencia': 'travel_agent_name', 'agente': 'travel_agent_name',
    'company name': 'company_name', 'company': 'company_name', 'empresa': 'company_name',
    'city': 'city', 'cidade': 'city', 'state': 'state', 'estado': 'state', 'uf': 'state',
    'country': 'country', 'pais': 'country',
    'room revenue': 'room_revenue', 'receita quartos': 'room_revenue', 'receita quarto': 'room_revenue',
    'f&b revenue': 'fb_revenue', 'fb revenue': 'fb_revenue', 'receita a&b': 'fb_revenue', 'receita ab': 'fb_revenue',
    'total revenue': 'total_revenue', 'receita total': 'total_revenue', 'revenue': 'total_revenue', 'receita': 'total_revenue',
    'room type': 'room_type', 'tipo de quarto': 'room_type', 'tipo quarto': 'room_type', 'roomtype': 'room_type',
    'source name': 'source_name', 'source': 'source_name', 'fonte': 'source_name', 'nome da fonte': 'source_name',
    'rate code': 'rate_code', 'codigo tarifa': 'rate_code', 'codigo de tarifa': 'rate_code',
    'rate code description': 'rate_code_description', 'descricao tarifa': 'rate_code_description', 'rate description': 'rate_code_description',
  };

  const normalizeHeader = (header: string): string => {
    const normalized = header.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    return COLUMN_MAP[normalized] || normalized.replace(/\s+/g, '_');
  };

  const excelDateToJSDate = (serial: number): string | null => {
    if (!serial || typeof serial !== 'number') return null;
    const utc_days = Math.floor(serial - 25569);
    const date = new Date(utc_days * 86400 * 1000);
    return date.toISOString().split('T')[0];
  };

  const parseExcelLocally = async (excelFile: File, sheetName: string): Promise<ParsedRow[]> => {
    let workbook = (excelFile as any).__workbook;
    if (!workbook) {
      const buffer = await excelFile.arrayBuffer();
      workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false });
    }
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Aba "${sheetName}" não encontrada`);

    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (rawRows.length === 0) throw new Error('Planilha vazia');

    const rawHeaders = Object.keys(rawRows[0]);
    const headerMap: Record<string, string> = {};
    rawHeaders.forEach(h => { headerMap[h] = normalizeHeader(h); });

    const normalizedHeaders = Object.values(headerMap);
    const REQUIRED = ['property_name', 'reservation_status', 'confirmation_number'];
    const missing = REQUIRED.filter(c => !normalizedHeaders.includes(c));
    if (missing.length > 0) {
      const names: Record<string, string> = {
        'property_name': 'Property Name / Hotel',
        'reservation_status': 'Reservation Status',
        'confirmation_number': 'Confirmation Number',
      };
      throw new Error(`Colunas obrigatórias não encontradas: ${missing.map(c => names[c] || c).join(', ')}`);
    }

    const dateColumns = ['reservation_date', 'arrival_date', 'departure_date'];
    return rawRows.map((row: any) => {
      const normalized: any = {};
      for (const [rawKey, normKey] of Object.entries(headerMap)) {
        let value = row[rawKey];
        if (dateColumns.includes(normKey) && typeof value === 'number') {
          value = excelDateToJSDate(value);
        }
        normalized[normKey] = value;
      }
      return normalized as ParsedRow;
    });
  };

  const parseMappingFile = async (f: File): Promise<Array<{ canal: string; segmento: string }>> => {
    let rawRows: any[];

    if (isExcelFile(f)) {
      const buffer = await f.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    } else {
      const text = await f.text();
      const parsed = await new Promise<any>((resolve, reject) => {
        import('papaparse').then(Papa => {
          Papa.default.parse(text, {
            header: true,
            skipEmptyLines: true,
            complete: (results: any) => resolve(results),
            error: (err: any) => reject(err),
          });
        });
      });
      rawRows = parsed.data;
    }

    if (rawRows.length === 0) throw new Error('Arquivo de mapeamento vazio');

    const headers = Object.keys(rawRows[0]);
    const canalCol = headers.find(h => normalizeText(h) === 'canal');
    const segmentoCol = headers.find(h => normalizeText(h) === 'segmento');

    if (!canalCol || !segmentoCol) {
      throw new Error('Colunas obrigatórias não encontradas: CANAL e SEGMENTO');
    }

    return rawRows
      .filter((row: any) => row[canalCol] && row[segmentoCol])
      .map((row: any) => ({
        canal: String(row[canalCol]).trim(),
        segmento: String(row[segmentoCol]).trim(),
      }));
  };

  const handleMappingUpload = async () => {
    if (!mappingFile || !user) return;

    // Final tenant check right before sending — catches any timing issue
    const effectiveTenantId = tenantId;
    if (!effectiveTenantId) {
      toast.error(
        isSuperAdmin
          ? 'Selecione um tenant no seletor acima antes de enviar o mapeamento.'
          : 'Tenant não carregado ainda. Aguarde alguns segundos e tente novamente.'
      );
      return;
    }

    setUploadingMapping(true);
    try {
      const rows = await parseMappingFile(mappingFile);
      if (rows.length === 0) {
        toast.error('Arquivo de mapeamento vazio ou sem dados válidos');
        setUploadingMapping(false);
        return;
      }

      // Delete existing mapping for this tenant only
      const { error: delError } = await supabase
        .from('channel_mapping')
        .delete()
        .eq('tenant_id', effectiveTenantId);
      if (delError) throw delError;

      // Insert in batches with tenant_id on every row
      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize).map(r => ({ ...r, tenant_id: effectiveTenantId }));
        const { error } = await supabase.from('channel_mapping' as any).insert(batch as any);
        if (error) throw error;
      }

      setMappingCount(rows.length);
      toast.success(`${rows.length} mapeamentos importados com sucesso!`);
    } catch (err: any) {
      console.error('Mapping upload error:', err);
      toast.error(`Erro no upload do mapeamento: ${err.message}`);
    } finally {
      setUploadingMapping(false);
    }
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    // Final tenant check right before sending — catches any timing issue
    const effectiveTenantId = tenantId;
    if (!effectiveTenantId) {
      toast.error('Tenant não selecionado. Selecione um tenant antes de enviar dados.');
      return;
    }

    if (isExcelFile(file) && sheets.length > 1 && !selectedSheet) {
      toast.error('Selecione uma aba da planilha para importar');
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      let rows: ParsedRow[];

      if (isExcelFile(file)) {
        setProgressText('Processando arquivo Excel...');
        setProgress(5);
        const sheet = selectedSheet || sheets[0]?.name || '';
        rows = await parseExcelLocally(file, sheet);
        setProgress(10);
      } else {
        setProgressText('Lendo arquivo CSV...');
        rows = await parseCSV(file);
        setProgress(10);
      }

      if (rows.length === 0) {
        toast.error('Arquivo vazio ou formato inválido');
        setUploading(false);
        return;
      }

      setProgressText('Criando lote de upload...');

      const { data: batch, error: batchError } = await supabase
        .from('upload_batches')
        .insert({
          uploaded_by: user.id,
          tenant_id: effectiveTenantId,
          file_name: file.name,
          total_rows: rows.length,
          status: 'uploading',
          mode,
        })
        .select()
        .single();

      if (batchError) throw batchError;

      const chunks = chunkArray(rows, CHUNK_SIZE);
      const totalRows = rows.length;
      const totalChunks = chunks.length;
      const failedChunks: number[] = [];
      let completedChunks = 0;

      setProgressText(
        `Etapa 1/2 — Enviando dados (0/${totalChunks.toLocaleString('pt-BR')} chunks)`
      );

      const sendChunk = async (i: number) => {
        try {
          await invokeWithRetry(
            'process-csv',
            {
              tenant_id: effectiveTenantId,
              rows: chunks[i],
              batch_id: batch.id,
              mode,
              chunk_index: i,
              total_chunks: totalChunks,
            },
            effectiveTenantId,
            (attempt, err) => {
              console.warn(`[upload] Chunk ${i + 1} attempt ${attempt} failed:`, err?.message || err);
            }
          );
        } catch (chunkErr: any) {
          console.error(`[upload] Chunk ${i + 1} failed after ${MAX_RETRIES} attempts:`, chunkErr);
          failedChunks.push(i + 1);
          toast.warning(`Chunk ${i + 1} falhou após ${MAX_RETRIES} tentativas; continuando.`);
        } finally {
          chunks[i] = null as any;
          completedChunks++;
          const uploadedSoFar = Math.min(completedChunks * CHUNK_SIZE, totalRows);
          const pct = 10 + Math.round((completedChunks / totalChunks) * 70);
          setProgress(pct);
          setProgressText(
            `Etapa 1/2 — Enviando dados: ${completedChunks.toLocaleString('pt-BR')}/${totalChunks.toLocaleString('pt-BR')} chunks (${uploadedSoFar.toLocaleString('pt-BR')}/${totalRows.toLocaleString('pt-BR')} registros)`
          );
        }
      };

      // In replace mode, send first chunk alone so DELETE happens before parallel inserts
      let startIndex = 0;
      if (mode === 'replace' && chunks.length > 0) {
        await sendChunk(0);
        startIndex = 1;
      }

      for (let i = startIndex; i < chunks.length; i += PARALLEL_CHUNKS) {
        const batchPromises: Promise<void>[] = [];
        for (let j = 0; j < PARALLEL_CHUNKS && i + j < chunks.length; j++) {
          batchPromises.push(sendChunk(i + j));
        }
        await Promise.all(batchPromises);
      }

      if (failedChunks.length === totalChunks) {
        throw new Error('Todos os chunks falharam. Verifique a conexão e tente novamente.');
      }

      // Phase 2: Process reservations (80% - 100%)
      setProgress(82);
      setProgressText('Etapa 2/2 — Processando classificações e agregações...');

      await invokeWithRetry(
        'process-csv',
        {
          tenant_id: effectiveTenantId,
          action: 'process',
          batch_id: batch.id,
        },
        effectiveTenantId
      );

      setProgress(100);
      const successText =
        failedChunks.length > 0
          ? `${totalRows.toLocaleString('pt-BR')} registros processados (${failedChunks.length} chunks falharam)`
          : `${totalRows.toLocaleString('pt-BR')} registros processados com sucesso!`;
      setProgressText(successText);

      if (failedChunks.length > 0) {
        toast.warning(`Upload concluído com ${failedChunks.length} chunks falhos.`);
      } else {
        toast.success('Upload concluído com sucesso!');
      }

      queryClient.setQueryData(['has-data', effectiveTenantId], true);
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes(effectiveTenantId),
      });

      setTimeout(() => navigate('/'), 1500);
    } catch (err: any) {
      console.error('Upload error:', err);
      toast.error(`Erro no upload: ${err.message}`);
      setUploading(false);
    }
  };

  const fileIsExcel = file && isExcelFile(file);
  const needsSheetSelection = fileIsExcel && sheets.length > 1;
  const canUpload = file && !uploading && !loadingSheets && (!needsSheetSelection || selectedSheet);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b px-4 py-3" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="mr-1 h-4 w-4" />Voltar
          </Button>
          <h1 className="text-sm font-semibold text-foreground">Central de Dados</h1>
        </div>
      </div>

      <div className="mx-auto max-w-2xl p-6 space-y-8">

        {/* ===== Loading / tenant guard ===== */}
        <TenantLoadingGuard>

          {/* ===== Tenant selector for super_admin (when tenant already selected) ===== */}
          {isSuperAdmin && tenantId && (
            <div className="surface-card p-4 flex items-center gap-3">
              <Building2 className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Tenant ativo</p>
                <p className="text-xs text-muted-foreground">
                  Todas as ações desta página serão aplicadas ao tenant selecionado.
                </p>
              </div>
              <Select
                value={tenantId || ''}
                onValueChange={(v) => setActiveTenantId(v || null)}
              >
                <SelectTrigger className="h-9 w-[220px] bg-primary/10 border-primary/30 text-xs">
                  <SelectValue placeholder="Selecionar Tenant" />
                </SelectTrigger>
                <SelectContent>
                  {(tenants || []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ===== SECTION 1: Channel Mapping Upload ===== */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-foreground flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Tabela de Mapeamento de Canais
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Importe um arquivo com as colunas <span className="font-medium text-foreground">CANAL</span> e <span className="font-medium text-foreground">SEGMENTO</span> para classificação automática.
            </p>
            <div className="surface-card p-4 flex items-center gap-4">
              <div className="flex-1">
                <input
                  id="mapping-file-input"
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && isValidFile(f)) {
                      setMappingFile(f);
                      setMappingCount(null);
                    } else if (f) {
                      toast.error('Formato não suportado. Envie .csv, .xlsx ou .xls');
                    }
                  }}
                  disabled={uploadingMapping}
                />
                {mappingFile ? (
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    <span className="text-sm text-foreground">{mappingFile.name}</span>
                    {mappingCount !== null && (
                      <span className="text-xs text-muted-foreground">({mappingCount} registros)</span>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => document.getElementById('mapping-file-input')?.click()}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Selecionar arquivo de mapeamento...
                  </button>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={mappingFile ? handleMappingUpload : () => document.getElementById('mapping-file-input')?.click()}
                disabled={uploadingMapping}
              >
                {uploadingMapping ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : mappingFile ? (
                  <>
                    <Upload className="mr-1 h-3 w-3" />
                    Importar
                  </>
                ) : (
                  'Selecionar'
                )}
              </Button>
            </div>
          </div>

          {/* ===== SECTION 2: Upload Mode ===== */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-foreground">Modo de Upload</h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('replace')}
                className={`relative surface-card p-4 text-left transition-all cursor-pointer hover:border-primary/50 ${mode === 'replace' ? 'ring-2 ring-primary border-primary' : ''}`}
              >
                <Replace className="mb-2 h-5 w-5 text-destructive" />
                <div className="text-sm font-medium text-foreground">Substituir Base</div>
                <div className="text-xs text-muted-foreground mt-1">Remove dados existentes e importa nova base completa</div>
                {mode === 'replace' && (
                  <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setMode('append')}
                className={`relative surface-card p-4 text-left transition-all cursor-pointer hover:border-primary/50 ${mode === 'append' ? 'ring-2 ring-primary border-primary' : ''}`}
              >
                <PlusCircle className="mb-2 h-5 w-5 text-success" />
                <div className="text-sm font-medium text-foreground">Adicionar Registros</div>
                <div className="text-xs text-muted-foreground mt-1">Adiciona novos registros sem remover existentes</div>
                {mode === 'append' && (
                  <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`surface-card flex flex-col items-center justify-center border-2 border-dashed p-12 transition-all ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border'
            } ${uploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
            onClick={() => !uploading && document.getElementById('file-input')?.click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleFileSelect}
              disabled={uploading}
            />
            {file ? (
              <>
                <FileSpreadsheet className="mb-3 h-10 w-10 text-primary" />
                <div className="text-sm font-medium text-foreground">{file.name}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  {fileIsExcel && (
                    <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      {file.name.toLowerCase().endsWith('.xls') ? 'XLS' : 'XLSX'}
                    </span>
                  )}
                  {!fileIsExcel && (
                    <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">CSV</span>
                  )}
                </div>
                {loadingSheets && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Lendo abas da planilha...
                  </div>
                )}
              </>
            ) : (
              <>
                <Upload className={`mb-3 h-10 w-10 text-muted-foreground ${dragOver ? 'animate-pulse-subtle' : ''}`} />
                <div className="text-sm text-foreground">Arraste o arquivo ou clique para selecionar</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Suporta <span className="font-medium text-primary">.csv</span>, <span className="font-medium text-accent">.xlsx</span> e <span className="font-medium text-accent">.xls</span> com 100k+ registros
                </div>
              </>
            )}
          </div>

          {/* Sheet selection for Excel with multiple sheets */}
          {needsSheetSelection && !uploading && (
            <div className="surface-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Table2 className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium text-foreground">Selecionar Aba</span>
                <span className="text-xs text-muted-foreground">({sheets.length} abas encontradas)</span>
              </div>
              <Select value={selectedSheet} onValueChange={setSelectedSheet}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Selecione a aba para importar" />
                </SelectTrigger>
                <SelectContent>
                  {sheets.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      <div className="flex items-center gap-2">
                        <span>{s.name}</span>
                        <span className="text-xs text-muted-foreground">({s.rowCount.toLocaleString('pt-BR')} linhas)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Single sheet info */}
          {fileIsExcel && sheets.length === 1 && !uploading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Table2 className="h-3 w-3" />
              Aba: <span className="font-medium text-foreground">{sheets[0].name}</span>
              ({sheets[0].rowCount.toLocaleString('pt-BR')} linhas)
            </div>
          )}

          {/* Progress */}
          {uploading && (
            <div className="space-y-2">
              <Progress value={progress} className="h-1" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {progressText}
              </div>
            </div>
          )}

          {/* Upload button */}
          <div>
            <Button
              onClick={handleUpload}
              disabled={!canUpload}
              className="w-full"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  {mode === 'replace' ? 'Substituir e Processar' : 'Adicionar e Processar'}
                </>
              )}
            </Button>
          </div>

          {/* ===== SECTION: Upload History ===== */}
          {tenantId && <UploadHistory tenantId={tenantId} />}

        </TenantLoadingGuard>
      </div>
    </div>
  );
};

export default UploadPage;
