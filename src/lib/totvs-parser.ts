import { applyHotelRename } from '@/lib/hotel-renames';
import type { ParsedRow } from '@/lib/csv-parser';

// Leitor do relatório TOTVS "Relatório produção final" (uma linha por reserva,
// às vezes duplicada: uma sem cidade e outra com cidade/estado).
// Observações de negócio:
// - "Total Receita" é somente hospedagem (TOTVS não separa A&B): vai em room_revenue e total_revenue.
// - Cidade/Estado são a origem do HÓSPEDE, não da empresa.

const norm = (v: unknown) =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

const REQUIRED = ['hotel', 'status reserva', 'numero reserva', 'total receita', 'qtde pernoites'];

export const isTotvsHeader = (row: unknown[]): boolean => {
  const keys = (row || []).map(norm);
  return REQUIRED.every((k) => keys.includes(k));
};

export const findTotvsHeaderRow = (matrix: unknown[][]): number => {
  for (let i = 0; i < Math.min(matrix.length, 15); i++) if (isTotvsHeader(matrix[i] || [])) return i;
  return -1;
};

export const mapTotvsStatus = (s: unknown): string => {
  const n = norm(s).replace(/[-_]/g, ' ');
  if (n === 'checkout' || n === 'check out') return 'checked out';
  if (n === 'checkin' || n === 'check in') return 'checked in';
  if (n === 'no show' || n === 'noshow') return 'no show';
  if (n.startsWith('cancel')) return 'cancelled';
  return 'reserved';
};

const toDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(Math.floor(v - 25569) * 86400000).toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return s.slice(0, 10) || null;
};

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const cleaned = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return parseFloat(cleaned.replace(/[^\d.-]/g, '')) || 0;
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export const parseTotvsMatrix = (matrix: unknown[][], headerIdx: number): ParsedRow[] => {
  const headers = (matrix[headerIdx] || []).map(norm);
  const col = (name: string) => headers.indexOf(name);
  const c = {
    hotel: col('hotel'), status: col('status reserva'), resDate: col('data reserva'), adr: col('valor da diaria'),
    cliente: col('cliente'), tarifa: col('tarifa'), catTarifa: col('categoria de tarifa'), segmento: col('segmento'),
    uh: col('tipo uh'), origem: col('origem'), hospede: col('hospede'), num: col('numero reserva'),
    arr: col('data chegada'), dep: col('data saida'), cidade: col('cidade'), estado: col('estado'),
    receita: col('total receita'), noites: col('qtde pernoites'),
  };
  const get = (row: unknown[], i: number) => (i >= 0 ? row[i] : null);

  const byKey = new Map<string, ParsedRow>();
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const conf = str(get(row, c.num));
    if (!conf) continue;
    const cliente = str(get(row, c.cliente));
    const segmento = norm(get(row, c.segmento));
    const isAgent = segmento.includes('agenc') || segmento.includes('operadora');
    const isParticular = norm(cliente) === 'particular' || !cliente;
    const receita = toNum(get(row, c.receita));
    const city = str(get(row, c.cidade));
    const state = str(get(row, c.estado));

    const parsed: ParsedRow = {
      property_name: applyHotelRename(str(get(row, c.hotel))) as string,
      reservation_status: mapTotvsStatus(get(row, c.status)),
      confirmation_number: conf,
      reservation_date: toDate(get(row, c.resDate)) ?? undefined,
      arrival_date: toDate(get(row, c.arr)) ?? undefined,
      departure_date: toDate(get(row, c.dep)) ?? undefined,
      number_of_nights: toNum(get(row, c.noites)),
      travel_agent_name: isAgent && !isParticular ? cliente : '',
      company_name: !isAgent && !isParticular ? cliente : '',
      city,
      state,
      country: city || state ? 'Brasil' : '',
      room_revenue: receita,
      fb_revenue: 0,
      total_revenue: receita,
      room_type: str(get(row, c.uh)),
      source_name: '',
      individual_first_name: str(get(row, c.hospede)),
      rate_code: str(get(row, c.catTarifa)),
      rate_code_description: str(get(row, c.tarifa)),
    };
    (parsed as any).avg_daily_rate = toNum(get(row, c.adr)) || null;

    // Pares duplicados (sem cidade + com cidade): mantém uma linha, preferindo a que tem cidade
    const key = [conf, parsed.property_name, parsed.arrival_date, parsed.departure_date, parsed.room_type,
      receita, parsed.reservation_status, parsed.individual_first_name].join('|');
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, parsed);
    else if (!existing.city && city) byKey.set(key, parsed);
  }
  return [...byKey.values()];
};
