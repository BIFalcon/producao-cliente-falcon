import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { parseCSV, chunkArray } from '@/lib/csv-parser';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Upload, Replace, PlusCircle, ArrowLeft, FileSpreadsheet, Loader2 } from 'lucide-react';

const CHUNK_SIZE = 2000;

const UploadPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.type === 'text/csv')) {
      setFile(droppedFile);
    } else {
      toast.error('Por favor, envie um arquivo CSV');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    setUploading(true);
    setProgress(0);

    try {
      // Parse CSV
      setProgressText('Lendo arquivo...');
      const rows = await parseCSV(file);
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
        const pct = Math.round(((i + 1) / chunks.length) * 90);
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
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          {file ? (
            <>
              <FileSpreadsheet className="mb-3 h-10 w-10 text-primary" />
              <div className="text-sm font-medium text-foreground">{file.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </div>
            </>
          ) : (
            <>
              <Upload className={`mb-3 h-10 w-10 text-muted-foreground ${dragOver ? 'animate-pulse-subtle' : ''}`} />
              <div className="text-sm text-foreground">Arraste o arquivo CSV ou clique para selecionar</div>
              <div className="text-xs text-muted-foreground mt-1">Suporta arquivos com 100k+ registros</div>
            </>
          )}
        </div>

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
            disabled={!file || uploading}
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
