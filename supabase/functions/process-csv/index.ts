import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const normalizeText = (str: string | null | undefined): string => {
  if (!str) return '';
  return String(str).toLowerCase()
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

const errorResponse = (stage: string, detail: string, status = 500, extra: Record<string, unknown> = {}) => {
  console.error(`[process-csv] ${stage}: ${detail}`, extra);
  return new Response(JSON.stringify({ error: detail, stage, ...extra }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('auth', 'Missing Authorization header', 401);
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
      return errorResponse('auth', authError?.message || 'Unauthorized', 401);
    }

    let body: any;
    try {
      body = await req.json();
    } catch (e: any) {
      return errorResponse('parse-body', `Invalid JSON body: ${e.message}`, 400);
    }

    const { rows, batch_id, mode, chunk_index, total_chunks, action } = body;
    const headerTenant = req.headers.get('x-tenant-id');
    const tenant_id: string | null = body.tenant_id || headerTenant || null;

    if (!tenant_id) {
      return errorResponse('tenant', 'Missing tenant_id (body.tenant_id or x-tenant-id header)', 400, {
        chunk_index, batch_id,
      });
    }

    // Authorize: user must belong to tenant AND have editor/master_admin role (or be super_admin)
    const [{ data: superCheck }, { data: profileCheck }, { data: roleRows }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'super_admin').maybeSingle(),
      supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', user.id).eq('tenant_id', tenant_id),
    ]);
    const isSuperAdmin = !!superCheck;
    if (!isSuperAdmin && profileCheck?.tenant_id !== tenant_id) {
      return errorResponse('authz', 'User not authorized for tenant', 403, { tenant_id });
    }
    if (!isSuperAdmin) {
      const roles = (roleRows || []).map((r: any) => r.role);
      const canWrite = roles.includes('editor') || roles.includes('master_admin');
      if (!canWrite) {
        return errorResponse('authz', 'Requires editor or master_admin role', 403, { tenant_id });
      }
    }

    // ─── PROCESS action ───
    if (action === 'process') {
      if (!batch_id) {
        return errorResponse('process', 'Missing batch_id', 400, { tenant_id });
      }

      await supabase.from('upload_batches')
        .update({ status: 'processing' })
        .eq('id', batch_id)
        .eq('tenant_id', tenant_id);

           // Roda o processamento em segundo plano, sem prender a resposta da
      // função a ele — Edge Functions derrubam a conexão em 150s de espera,
      // e processar uma base grande (vários hotéis) pode levar mais que isso.
      const processInBackground = async () => {
        const { error: procError } = await supabase.rpc('process_reservations', {
          p_tenant_id: tenant_id,
          p_batch_id: batch_id,
        });
        if (procError) {
          console.error('[process-csv] process_reservations failed:', procError);
          await supabase.from('upload_batches').update({
            status: 'error',
            error_message: procError.message,
          }).eq('id', batch_id).eq('tenant_id', tenant_id);
          return;
        }
        await supabase.from('upload_batches').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', batch_id).eq('tenant_id', tenant_id);
      };

      // @ts-ignore — EdgeRuntime é global no ambiente da Supabase, não no TypeScript padrão
      EdgeRuntime.waitUntil(processInBackground());

      return new Response(JSON.stringify({ success: true, action: 'process', status: 'processing', tenant_id, batch_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ─── UPLOAD chunk action ───
    if (!rows || !Array.isArray(rows) || !batch_id) {
      return errorResponse('validate', 'Invalid payload: rows[] and batch_id required', 400, {
        tenant_id, has_rows: !!rows, batch_id, chunk_index,
      });
    }

    // First chunk in replace mode: clear existing data FOR THIS TENANT ONLY
    if (chunk_index === 0 && mode === 'replace') {
      console.log(`[process-csv] Replace mode: clearing tenant ${tenant_id} data`);
      const { error: delRawErr } = await supabase
        .from('raw_reservations')
        .delete()
        .eq('tenant_id', tenant_id);
      if (delRawErr) {
        return errorResponse('delete-raw', delRawErr.message, 500, { tenant_id });
      }
      const { error: delProcErr } = await supabase
        .from('processed_reservations')
        .delete()
        .eq('tenant_id', tenant_id);
      if (delProcErr) {
        return errorResponse('delete-processed', delProcErr.message, 500, { tenant_id });
      }
    }

    // Normalize rows with tenant_id on every row
    const processedRows = rows.map((row: any) => {
      const roomRev = normalizeRevenue(row.room_revenue);
      const fbRev = normalizeRevenue(row.fb_revenue);
      let totalRev = normalizeRevenue(row.total_revenue);
      if (totalRev === 0 && (roomRev > 0 || fbRev > 0)) {
        totalRev = roomRev + fbRev;
      }

      return {
        tenant_id,
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
        avg_daily_rate: normalizeRevenue(row.avg_daily_rate) || null,
        room_type: normalizeText(row.room_type),
        source_name: normalizeText(row.source_name),
        individual_first_name: normalizeText(row.individual_first_name),
        rate_code: normalizeText(row.rate_code),
        rate_code_description: normalizeText(row.rate_code_description),
        upload_batch_id: batch_id,
      };
    });

    // Insert in sub-batches of 200
    const batchSize = 200;
    let insertedTotal = 0;
    for (let i = 0; i < processedRows.length; i += batchSize) {
      const subBatch = processedRows.slice(i, i + batchSize);
      const { error: insertError } = await supabase.from('raw_reservations').insert(subBatch);
      if (insertError) {
        return errorResponse('insert-raw', insertError.message, 500, {
          tenant_id, batch_id, chunk_index, sub_batch_start: i, sub_batch_size: subBatch.length,
        });
      }
      insertedTotal += subBatch.length;
    }

    // Update batch progress (scoped by tenant)
    await supabase.from('upload_batches').update({
      processed_rows: rows.length * ((chunk_index ?? 0) + 1),
      status: 'uploading',
    }).eq('id', batch_id).eq('tenant_id', tenant_id);

    return new Response(JSON.stringify({
      success: true,
      tenant_id,
      processed: insertedTotal,
      chunk: (chunk_index ?? 0) + 1,
      total_chunks,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[process-csv] Unhandled error:', error);
    return new Response(JSON.stringify({ error: error?.message || String(error), stage: 'unhandled' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
