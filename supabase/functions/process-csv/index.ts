import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

const parseDate = (val: any): string | null => {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).trim();
  if (!s) return null;
  // Already ISO YYYY-MM-DD (optionally with time)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    return null;
  }
  // DD/MM/YYYY or DD-MM-YYYY (optional time after)
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    let d = +dmy[1], m = +dmy[2], y = +dmy[3];
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
  }
  return null;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const body = await req.json().catch(() => ({} as any));
    const headerTenantId = req.headers.get('x-tenant-id');
    const bodyTenantId = body?.tenant_id;
    const candidateTenantId = (bodyTenantId || headerTenantId || '').toString().trim();

    if (!candidateTenantId || !UUID_REGEX.test(candidateTenantId)) {
      console.error('[process-csv] Missing or invalid tenant_id', { headerTenantId, bodyTenantId, userId: user.id });
      return new Response(JSON.stringify({ error: 'tenant_id ausente ou inválido no payload/header' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate tenant exists and is active
    const { data: tenantRow, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, is_active')
      .eq('id', candidateTenantId)
      .maybeSingle();

    if (tenantErr || !tenantRow) {
      console.error('[process-csv] Tenant not found in tenants table', { candidateTenantId, tenantErr });
      return new Response(JSON.stringify({ error: `Tenant não encontrado: ${candidateTenantId}` }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (tenantRow.is_active === false) {
      return new Response(JSON.stringify({ error: 'Tenant inativo' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Authorization: super_admin can use any tenant; otherwise must match user's profile tenant_id
    const { data: superRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .maybeSingle();
    const isSuperAdmin = !!superRole;

    if (!isSuperAdmin) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!profile?.tenant_id || profile.tenant_id !== candidateTenantId) {
        console.error('[process-csv] User does not belong to tenant', { userId: user.id, profileTenant: profile?.tenant_id, candidateTenantId });
        return new Response(JSON.stringify({ error: 'Usuário não pertence a este tenant' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const tenant_id: string = candidateTenantId;
    const { rows, batch_id, mode, chunk_index, total_chunks, action } = body;

    // Separate action: only run process_reservations
    if (action === 'process') {
      if (!batch_id) {
        return new Response(JSON.stringify({ error: 'Missing batch_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: batchRow } = await supabase
        .from('upload_batches')
        .select('tenant_id')
        .eq('id', batch_id)
        .single();
      if (!batchRow || batchRow.tenant_id !== tenant_id) {
        return new Response(JSON.stringify({ error: 'Batch não pertence ao seu tenant' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await supabase.from('upload_batches').update({ status: 'processing' }).eq('id', batch_id);

      const { error: procError } = await supabase.rpc('process_reservations', {
        p_tenant_id: tenant_id,
        p_batch_id: batch_id,
      });
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

    const { data: batchRow2 } = await supabase
      .from('upload_batches')
      .select('tenant_id')
      .eq('id', batch_id)
      .single();
    if (!batchRow2 || batchRow2.tenant_id !== tenant_id) {
      return new Response(JSON.stringify({ error: 'Batch não pertence ao seu tenant' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // First chunk in replace mode: clear existing data ONLY for this tenant, in batches to avoid lock/timeout
    if (chunk_index === 0 && mode === 'replace') {
      console.log(`[process-csv] Replace mode: deleting old data for tenant ${tenant_id} in batches`);
      const DELETE_BATCH = 50000;
      // Delete processed_reservations in batches
      while (true) {
        const { data: ids } = await supabase
          .from('processed_reservations')
          .select('id')
          .eq('tenant_id', tenant_id)
          .limit(DELETE_BATCH);
        if (!ids || ids.length === 0) break;
        const { error: delErr } = await supabase
          .from('processed_reservations')
          .delete()
          .in('id', ids.map((r: any) => r.id));
        if (delErr) {
          console.error('[process-csv] Delete processed batch error', delErr);
          break;
        }
        if (ids.length < DELETE_BATCH) break;
      }
      // Delete raw_reservations in batches
      while (true) {
        const { data: ids } = await supabase
          .from('raw_reservations')
          .select('id')
          .eq('tenant_id', tenant_id)
          .limit(DELETE_BATCH);
        if (!ids || ids.length === 0) break;
        const { error: delErr } = await supabase
          .from('raw_reservations')
          .delete()
          .in('id', ids.map((r: any) => r.id));
        if (delErr) {
          console.error('[process-csv] Delete raw batch error', delErr);
          break;
        }
        if (ids.length < DELETE_BATCH) break;
      }
    }

    // Normalize all rows and stamp tenant_id
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
        reservation_date: parseDate(row.reservation_date),
        arrival_date: parseDate(row.arrival_date),
        arrival_time: row.arrival_time || null,
        departure_date: parseDate(row.departure_date),
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
        individual_first_name: normalizeText(row.individual_first_name),
        rate_code: normalizeText(row.rate_code),
        rate_code_description: normalizeText(row.rate_code_description),
        upload_batch_id: batch_id,
      };
    });

    // Insert in sub-batches of 200
    const batchSize = 200;
    for (let i = 0; i < processedRows.length; i += batchSize) {
      const batch = processedRows.slice(i, i + batchSize);
      const { error: insertError } = await supabase.from('raw_reservations').insert(batch);
      if (insertError) {
        console.error('Insert error:', insertError);
        throw new Error(`Insert failed: ${insertError.message}`);
      }
    }

    // Update batch progress incrementally (per chunk)
    const processedSoFar = (typeof chunk_index === 'number' ? chunk_index + 1 : 1) * rows.length;
    await supabase.from('upload_batches').update({
      processed_rows: processedSoFar,
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
