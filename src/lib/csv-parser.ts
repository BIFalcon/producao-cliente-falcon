import Papa from 'papaparse';

// Common column name mappings (handles various CSV formats)
const COLUMN_MAP: Record<string, string> = {
  'property name': 'property_name',
  'property': 'property_name',
  'hotel': 'property_name',
  'nome do hotel': 'property_name',
  'reservation status': 'reservation_status',
  'status': 'reservation_status',
  'status da reserva': 'reservation_status',
  'confirmation number': 'confirmation_number',
  'confirmation': 'confirmation_number',
  'numero de confirmacao': 'confirmation_number',
  'numero confirmacao': 'confirmation_number',
  'reservation date': 'reservation_date',
  'data da reserva': 'reservation_date',
  'arrival date': 'arrival_date',
  'data de chegada': 'arrival_date',
  'checkin': 'arrival_date',
  'check-in': 'arrival_date',
  'arrival time': 'arrival_time',
  'departure date': 'departure_date',
  'data de saida': 'departure_date',
  'checkout': 'departure_date',
  'check-out': 'departure_date',
  'departure time': 'departure_time',
  'travel agent name': 'travel_agent_name',
  'travel agent': 'travel_agent_name',
  'agencia': 'travel_agent_name',
  'agente': 'travel_agent_name',
  'company name': 'company_name',
  'company': 'company_name',
  'empresa': 'company_name',
  'city': 'city',
  'cidade': 'city',
  'state': 'state',
  'estado': 'state',
  'uf': 'state',
  'country': 'country',
  'pais': 'country',
  'room revenue': 'room_revenue',
  'receita quartos': 'room_revenue',
  'receita quarto': 'room_revenue',
  'f&b revenue': 'fb_revenue',
  'fb revenue': 'fb_revenue',
  'receita a&b': 'fb_revenue',
  'receita ab': 'fb_revenue',
  'total revenue': 'total_revenue',
  'receita total': 'total_revenue',
  'revenue': 'total_revenue',
  'receita': 'total_revenue',
};

const normalizeHeader = (header: string): string => {
  const normalized = header.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return COLUMN_MAP[normalized] || normalized.replace(/\s+/g, '_');
};

export interface ParsedRow {
  property_name?: string;
  reservation_status?: string;
  confirmation_number?: string;
  reservation_date?: string;
  arrival_date?: string;
  arrival_time?: string;
  departure_date?: string;
  departure_time?: string;
  travel_agent_name?: string;
  company_name?: string;
  city?: string;
  state?: string;
  country?: string;
  room_revenue?: string | number;
  fb_revenue?: string | number;
  total_revenue?: string | number;
}

export const parseCSV = (file: File): Promise<ParsedRow[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
      complete: (results) => {
        resolve(results.data as ParsedRow[]);
      },
      error: (error) => {
        reject(error);
      },
    });
  });
};

export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};
