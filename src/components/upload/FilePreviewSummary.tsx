import React from 'react';
import { AlertTriangle, FileSearch } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import type { ParsedRow } from '@/lib/csv-parser';

export interface HotelPreview {
  hotel: string;
  rows: number;
  first: string | null;
  last: string | null;
  missingDays: string[];
}

export interface FilePreview {
  hotels: HotelPreview[];
  statusCounts: Record<string, number>;
  noConfirmation: number;
  totalRows: number;
  partialWarnings: string[];
}

const toISO = (v: unknown): string | null => {
  if (!v) return null;
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
};

const fmt = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

export const buildFilePreview = (rows: ParsedRow[]): FilePreview => {
  const byHotel = new Map<string, { rows: number; dates: Set<string> }>();
  const statusCounts: Record<string, number> = {};
  let noConfirmation = 0;

  for (const r of rows) {
    const hotel = String(r.property_name || '(sem hotel)').trim();
    const h = byHotel.get(hotel) || { rows: 0, dates: new Set<string>() };
    h.rows++;
    const d = toISO(r.departure_date);
    if (d) h.dates.add(d);
    byHotel.set(hotel, h);
    const st = String(r.reservation_status || '(vazio)').trim() || '(vazio)';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    if (!String(r.confirmation_number ?? '').trim()) noConfirmation++;
  }

  const partialWarnings: string[] = [];
  const hotels: HotelPreview[] = Array.from(byHotel.entries()).map(([hotel, h]) => {
    const sorted = Array.from(h.dates).sort();
    const first = sorted[0] || null;
    const last = sorted[sorted.length - 1] || null;
    const missingDays: string[] = [];
    if (first && last) {
      const cur = new Date(`${first}T12:00:00Z`);
      const end = new Date(`${last}T12:00:00Z`);
      while (cur <= end) {
        const iso = cur.toISOString().slice(0, 10);
        if (!h.dates.has(iso)) missingDays.push(iso);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      const monthStart = `${last.slice(0, 7)}-01`;
      if (first > monthStart) {
        partialWarnings.push(`${hotel}: a primeira saída é ${fmt(first)}, e não o dia 1 do mês da última saída (${fmt(monthStart)}).`);
      }
    }
    if (missingDays.length > 0) {
      partialWarnings.push(`${hotel}: ${missingDays.length} dia(s) sem nenhuma saída dentro do período.`);
    }
    return { hotel, rows: h.rows, first, last, missingDays };
  }).sort((a, b) => a.hotel.localeCompare(b.hotel));

  return { hotels, statusCounts, noConfirmation, totalRows: rows.length, partialWarnings };
};

export const FilePreviewSummary: React.FC<{
  preview: FilePreview;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}> = ({ preview, acknowledged, onAcknowledge }) => (
  <div className="surface-card p-4 space-y-3">
    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
      <FileSearch className="h-4 w-4 text-primary" /> Conferência do arquivo antes do envio
    </div>
    <div className="overflow-auto" style={{ maxHeight: 260 }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background">
          <tr className="text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">Hotel</th>
            <th className="px-2 py-1 text-right font-medium">Linhas</th>
            <th className="px-2 py-1 text-left font-medium">1ª saída</th>
            <th className="px-2 py-1 text-left font-medium">Última saída</th>
            <th className="px-2 py-1 text-left font-medium">Dias sem saída</th>
          </tr>
        </thead>
        <tbody>
          {preview.hotels.map((h) => (
            <tr key={h.hotel} className="border-t border-border/40">
              <td className="px-2 py-1 text-foreground">{h.hotel}</td>
              <td className="px-2 py-1 text-right font-mono">{h.rows.toLocaleString('pt-BR')}</td>
              <td className="px-2 py-1">{fmt(h.first)}</td>
              <td className="px-2 py-1">{fmt(h.last)}</td>
              <td className={`px-2 py-1 ${h.missingDays.length ? 'text-destructive' : 'text-muted-foreground'}`}>
                {h.missingDays.length ? h.missingDays.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)).join(', ') : 'nenhum'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>Total: <b className="text-foreground">{preview.totalRows.toLocaleString('pt-BR')}</b> linhas</span>
      {Object.entries(preview.statusCounts).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
        <span key={s}>{s}: <b className="text-foreground">{n.toLocaleString('pt-BR')}</b></span>
      ))}
      <span>Sem nº de confirmação: <b className="text-foreground">{preview.noConfirmation.toLocaleString('pt-BR')}</b> (serão ignoradas)</span>
    </div>
    {preview.partialWarnings.length > 0 && (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> O arquivo parece parcial
        </div>
        <ul className="list-disc pl-5 text-xs text-foreground/80 space-y-0.5">
          {preview.partialWarnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
        <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
          <Checkbox checked={acknowledged} onCheckedChange={(v) => onAcknowledge(v === true)} />
          Conferi e quero enviar mesmo assim
        </label>
      </div>
    )}
  </div>
);
