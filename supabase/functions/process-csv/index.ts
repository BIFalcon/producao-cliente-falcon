import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const normalizeText = (str: string | null | undefined): string => {
  if (!str) return '';
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

const normalizeRevenue = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  const cleaned = String(val).replace(/[^\d.,-]/g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
};

const normalizeNights = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  return parseFloat(String(val)) || 0;
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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

    const body = await req.json();
    const { rows, batch_id, mode, chunk_index, total_chunks, action } = body;

    // Separate action: only run process_reservations
    if (action === 'process') {
      if (!batch_id) {
        return new Response(JSON.stringify({ error: 'Missing batch_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await supabase.from('upload_batches').update({ status: 'processing' }).eq('id', batch_id);

      const { error: procError } = await supabase.rpc('process_reservations', { p_batch_id: batch_id });
      if (procError) {
        console.error('Processing error:', procError);
        await supabase.from('upload_batches').update({
          status: 'error',
          error_message: procError.message,
        }).eq('id', batch_id);
        throw new Error(`Processing failed: ${procError.message}`);
      }

      await supabase.from('upload_batches').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', batch_id);

      return new Response(JSON.stringify({ success: true, action: 'process' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Normal upload action
    if (!rows || !Array.isArray(rows) || !batch_id) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // First chunk in replace mode: clear existing data
    if (chunk_index === 0 && mode === 'replace') {
      await supabase.from('raw_reservations').delete().not('id', 'is', null);
      await supabase.from('processed_reservations').delete().not('id', 'is', null);
    }

    // Normalize all rows
    const processedRows = rows.map((row: any) => {
      const roomRev = normalizeRevenue(row.room_revenue);
      const fbRev = normalizeRevenue(row.fb_revenue);
      let totalRev = normalizeRevenue(row.total_revenue);
      if (totalRev === 0 && (roomRev > 0 || fbRev > 0)) {
        totalRev = roomRev + fbRev;
      }

      return {
        property_name: normalizeText(row.property_name),
        reservation_status: normalizeText(row.reservation_status),
        confirmation_number: String(row.confirmation_number || '').trim(),
        reservation_date: row.reservation_date || null,
        arrival_date: row.arrival_date || null,
        arrival_time: row.arrival_time || null,
        departure_date: row.departure_date || null,
        departure_time: row.departure_time || null,
        number_of_nights: normalizeNights(row.number_of_nights),
        travel_agent_name: normalizeText(row.travel_agent_name),
        company_name: normalizeText(row.company_name),
        city: normalizeText(row.city),
        state: normalizeText(row.state),
        country: normalizeText(row.country),
        room_revenue: roomRev,
        fb_revenue: fbRev,
        total_revenue: totalRev,
        room_type: normalizeText(row.room_type),
        source_name: normalizeText(row.source_name),
        rate_code: normalizeText(row.rate_code),
        rate_code_description: normalizeText(row.rate_code_description),
        upload_batch_id: batch_id,
      };
    });

    // Insert in batches of 200
    const batchSize = 200;
    for (let i = 0; i < processedRows.length; i += batchSize) {
      const batch = processedRows.slice(i, i + batchSize);
      const { error: insertError } = await supabase.from('raw_reservations').insert(batch);
      if (insertError) {
        console.error('Insert error:', insertError);
        throw new Error(`Insert failed: ${insertError.message}`);
      }
    }

    // Update batch progress
    await supabase.from('upload_batches').update({
      processed_rows: rows.length * (chunk_index + 1),
      status: 'uploading',
    }).eq('id', batch_id);

    return new Response(JSON.stringify({
      success: true,
      processed: processedRows.length,
      chunk: chunk_index + 1,
      total_chunks,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
