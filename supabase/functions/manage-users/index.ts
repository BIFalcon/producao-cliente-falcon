import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    const supabaseAdmin = createClient(
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
    const { action, target_tenant_id } = body;

    const { data: superAdminCheck } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .maybeSingle();

    const isSuperAdmin = !!superAdminCheck;
    let tenantId: string | null = null;

    if (isSuperAdmin) {
      tenantId = target_tenant_id || null;
    } else {
      const { data: profileData } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', user.id)
        .maybeSingle();
      tenantId = profileData?.tenant_id || null;
    }

    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'Tenant não informado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!isSuperAdmin) {
      const { data: roleData } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'master_admin')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!roleData) {
        return new Response(JSON.stringify({ error: 'Acesso restrito a Master Admin' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (action === 'create') {
      const { email, password, full_name, role, hotel_permissions } = body;
      if (!email || !password || !role) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || '' },
      });
      if (createError) throw createError;

      await supabaseAdmin
        .from('profiles')
        .update({ full_name: full_name || '', tenant_id: tenantId })
        .eq('user_id', newUser.user.id);

      await supabaseAdmin
        .from('user_roles')
        .upsert({ user_id: newUser.user.id, role, tenant_id: tenantId }, { onConflict: 'user_id,role' });

      // Set hotel permissions if provided and not master_admin
      if (hotel_permissions && Array.isArray(hotel_permissions) && hotel_permissions.length > 0 && role !== 'master_admin') {
        const permRows = hotel_permissions.map((p: string) => ({
          user_id: newUser.user.id,
          tenant_id: tenantId,
          property_name: p,
        }));
        await supabaseAdmin.from('user_hotel_permissions').insert(permRows);
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'update_role') {
      const { target_user_id, role } = body;
      if (!target_user_id || !role) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (target_user_id === user.id && role !== 'master_admin') {
        const { data: admins } = await supabaseAdmin
          .from('user_roles')
          .select('user_id')
          .eq('role', 'master_admin')
          .eq('tenant_id', tenantId);
        if (!admins || admins.length <= 1) {
          return new Response(JSON.stringify({ error: 'Deve existir ao menos um Master Admin' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      await supabaseAdmin.from('user_roles').delete().eq('user_id', target_user_id).eq('tenant_id', tenantId);
      await supabaseAdmin.from('user_roles').insert({ user_id: target_user_id, role, tenant_id: tenantId });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'update_hotel_permissions') {
      const { target_user_id, hotel_permissions } = body;
      if (!target_user_id) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Clear existing permissions
      await supabaseAdmin.from('user_hotel_permissions').delete().eq('user_id', target_user_id);

      // Insert new permissions
      if (hotel_permissions && Array.isArray(hotel_permissions) && hotel_permissions.length > 0) {
        const permRows = hotel_permissions.map((p: string) => ({
          user_id: target_user_id,
          property_name: p,
        }));
        await supabaseAdmin.from('user_hotel_permissions').insert(permRows);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'toggle_active') {
      const { target_user_id, is_active } = body;
      if (!target_user_id) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (target_user_id === user.id && !is_active) {
        return new Response(JSON.stringify({ error: 'Você não pode desativar sua própria conta' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await supabaseAdmin
        .from('profiles')
        .update({ is_active })
        .eq('user_id', target_user_id);

      if (!is_active) {
        await supabaseAdmin.auth.admin.updateUserById(target_user_id, { ban_duration: '876000h' });
      } else {
        await supabaseAdmin.auth.admin.updateUserById(target_user_id, { ban_duration: 'none' });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
