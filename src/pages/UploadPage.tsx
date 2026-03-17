import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { parseCSV, chunkArray, type ParsedRow } from '@/lib/csv-parser';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Upload, Replace, PlusCircle, ArrowLeft, FileSpreadsheet, Loader2, Table2 } from 'lucide-react';
import * as XLSX from 'xlsx';

const CHUNK_SIZE = 2000;

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'];
const ACCEPTED_TYPES = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

const isValidFile = (file: File): boolean => {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  return ACCEPTED_EXTENSIONS.includes(ext) || ACCEPTED_TYPES.includes(file.type);
};

const isExcelFile = (file: File): boolean => {
  return file.name.toLowerCase().endsWith('.xlsx');
};

interface SheetInfo {
  name: string;
  rowCount: number;
}

const UploadPage = () => {
  const { user } = useAuth();
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

  const resetSheets = () => {
    setSheets([]);
    setSelectedSheet('');
  };

  const detectSheets = async (excelFile: File) => {
    setLoadingSheets(true);
    try {
      const buffer = await excelFile.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false });
      const sheetList: SheetInfo[] = workbook.SheetNames.map((name: string) => {
        const sheet = workbook.Sheets[name];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        return { name, rowCount: range.e.r };
      });
      setSheets(sheetList);
      // Store workbook for later use
      (excelFile as any).__workbook = workbook;

      if (sheetList.length === 1) {
        setSelectedSheet(sheetList[0].name);
      } else if (sheetList.length > 1) {
        setSelectedSheet('');
        toast.info(`${sheetList.length} abas encontradas. Selecione qual importar.`);
      }
    } catch (err: any) {
      console.error('Sheet detection error:', err);
      toast.error(`Erro ao ler arquivo Excel: ${err.message}`);
      setFile(null);
    } finally {
      setLoadingSheets(false);
    }
  };

  const handleFileSelected = (selectedFile: File) => {
    if (!isValidFile(selectedFile)) {
      toast.error('Formato não suportado. Envie um arquivo .csv ou .xlsx');
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
    if (droppedFile) {
      handleFileSelected(droppedFile);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFileSelected(selectedFile);
  };

  const parseExcelViaBackend = async (excelFile: File, sheetName: string): Promise<ParsedRow[]> => {
    const formData = new FormData();
    formData.append('file', excelFile);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-excel?action=parse&sheet=${encodeURIComponent(sheetName)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      }
    );

    const result = await response.json();

    if (!response.ok) {
      if (result.missing_columns) {
        throw new Error(result.error);
      }
      throw new Error(result.error || 'Erro ao processar arquivo Excel');
    }

    return result.rows as ParsedRow[];
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    // For Excel, require sheet selection if multiple sheets
    if (isExcelFile(file) && sheets.length > 1 && !selectedSheet) {
      toast.error('Selecione uma aba da planilha para importar');
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      let rows: ParsedRow[];

      if (isExcelFile(file)) {
        setProgressText('Processando arquivo Excel no servidor...');
        setProgress(5);
        const sheet = selectedSheet || sheets[0]?.name || '';
        rows = await parseExcelViaBackend(file, sheet);
        setProgress(20);
      } else {
        setProgressText('Lendo arquivo CSV...');
        rows = await parseCSV(file);
      }

      if (rows.length === 0) {
        toast.error('Arquivo vazio ou formato inválido');
        setUploading(false);
        return;
      }

      // Create batch
      const { data: batch, error: batchError } = await supabase
        .from('upload_batches')
        .insert({
          uploaded_by: user.id,
          file_name: file.name,
          total_rows: rows.length,
          status: 'uploading',
          mode,
        })
        .select()
        .single();

      if (batchError) throw batchError;

      // Chunk and upload
      const chunks = chunkArray(rows, CHUNK_SIZE);
      setProgressText(`Processando ${rows.length.toLocaleString('pt-BR')} registros...`);

      for (let i = 0; i < chunks.length; i++) {
        const pct = 20 + Math.round(((i + 1) / chunks.length) * 70);
        setProgress(pct);
        setProgressText(`Enviando lote ${i + 1}/${chunks.length} (${((i + 1) * CHUNK_SIZE > rows.length ? rows.length : (i + 1) * CHUNK_SIZE).toLocaleString('pt-BR')} registros)`);

        const { error } = await supabase.functions.invoke('process-csv', {
          body: {
            rows: chunks[i],
            batch_id: batch.id,
            mode,
            chunk_index: i,
            total_chunks: chunks.length,
          },
        });

        if (error) throw error;
      }

      setProgress(100);
      setProgressText(`${rows.length.toLocaleString('pt-BR')} registros processados com sucesso!`);
      toast.success('Upload concluído com sucesso!');

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

      <div className="mx-auto max-w-2xl p-6">
        {/* Mode selection */}
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-foreground">Modo de Upload</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('replace')}
              className={`surface-card p-4 text-left transition-all ${mode === 'replace' ? 'ring-1 ring-primary' : ''}`}
            >
              <Replace className="mb-2 h-5 w-5 text-destructive" />
              <div className="text-sm font-medium text-foreground">Substituir Base</div>
              <div className="text-xs text-muted-foreground mt-1">Remove dados existentes e importa nova base completa</div>
            </button>
            <button
              onClick={() => setMode('append')}
              className={`surface-card p-4 text-left transition-all ${mode === 'append' ? 'ring-1 ring-primary' : ''}`}
            >
              <PlusCircle className="mb-2 h-5 w-5 text-success" />
              <div className="text-sm font-medium text-foreground">Adicionar Registros</div>
              <div className="text-xs text-muted-foreground mt-1">Adiciona novos registros sem remover existentes</div>
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
            accept=".csv,.xlsx"
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
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">XLSX</span>
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
                Suporta <span className="font-medium text-primary">.csv</span> e <span className="font-medium text-accent">.xlsx</span> com 100k+ registros
              </div>
            </>
          )}
        </div>

        {/* Sheet selection for Excel with multiple sheets */}
        {needsSheetSelection && !uploading && (
          <div className="mt-4 surface-card p-4">
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
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Table2 className="h-3 w-3" />
            Aba: <span className="font-medium text-foreground">{sheets[0].name}</span>
            ({sheets[0].rowCount.toLocaleString('pt-BR')} linhas)
          </div>
        )}

        {/* Progress */}
        {uploading && (
          <div className="mt-4 space-y-2">
            <Progress value={progress} className="h-1" />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progressText}
            </div>
          </div>
        )}

        {/* Upload button */}
        <div className="mt-6">
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
      </div>
    </div>
  );
};

export default UploadPage;
