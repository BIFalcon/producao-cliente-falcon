import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5/xlsx.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

const REQUIRED_COLUMNS = [
  'property_name',
  'reservation_status',
  'confirmation_number',
];

const normalizeHeader = (header: string): string => {
  const normalized = header.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return COLUMN_MAP[normalized] || normalized.replace(/\s+/g, '_');
};

const excelDateToJSDate = (serial: number): string | null => {
  if (!serial || typeof serial !== 'number') return null;
  // Excel date serial to JS date
  const utc_days = Math.floor(serial - 25569);
  const date = new Date(utc_days * 86400 * 1000);
  return date.toISOString().split('T')[0];
};

const formatCellValue = (value: any, header: string): any => {
  if (value === null || value === undefined) return null;
  
  // Date columns - handle Excel serial dates
  const dateColumns = ['reservation_date', 'arrival_date', 'departure_date'];
  if (dateColumns.includes(header)) {
    if (typeof value === 'number') {
      return excelDateToJSDate(value);
    }
    return String(value);
  }
  
  return value;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify user
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'parse';

    // Read the file from the request body
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false });
    const sheetNames = workbook.SheetNames;

    // Action: get-sheets - return available sheet names
    if (action === 'get-sheets') {
      // Also return row counts per sheet
      const sheets = sheetNames.map((name: string) => {
        const sheet = workbook.Sheets[name];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        const rowCount = range.e.r; // 0-indexed, so this is row count minus header
        return { name, rowCount };
      });

      return new Response(JSON.stringify({ sheets }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Action: parse - parse a specific sheet and return rows
    const sheetName = url.searchParams.get('sheet') || sheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    if (!sheet) {
      return new Response(JSON.stringify({ error: `Sheet "${sheetName}" not found` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Convert to JSON with raw headers
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (rawRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Planilha vazia', rows: [], headers: [] }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Normalize headers
    const rawHeaders = Object.keys(rawRows[0]);
    const headerMap: Record<string, string> = {};
    rawHeaders.forEach(h => {
      headerMap[h] = normalizeHeader(h);
    });

    const normalizedHeaders = Object.values(headerMap);

    // Check for required columns
    const missingColumns = REQUIRED_COLUMNS.filter(
      col => !normalizedHeaders.includes(col)
    );

    if (missingColumns.length > 0) {
      const readableNames: Record<string, string> = {
        'property_name': 'Property Name / Hotel',
        'reservation_status': 'Reservation Status / Status da Reserva',
        'confirmation_number': 'Confirmation Number / Número de Confirmação',
      };
      const missingReadable = missingColumns.map(c => readableNames[c] || c);
      return new Response(JSON.stringify({
        error: `Colunas obrigatórias não encontradas: ${missingReadable.join(', ')}`,
        found_columns: normalizedHeaders,
        missing_columns: missingColumns,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Map rows to normalized structure
    const rows = rawRows.map((row: any) => {
      const normalized: any = {};
      for (const [rawKey, normalizedKey] of Object.entries(headerMap)) {
        normalized[normalizedKey] = formatCellValue(row[rawKey], normalizedKey);
      }
      return normalized;
    });

    return new Response(JSON.stringify({
      success: true,
      total_rows: rows.length,
      headers: normalizedHeaders,
      rows,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Excel parse error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
