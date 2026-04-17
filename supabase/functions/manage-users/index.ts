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

    // Determine if caller is super_admin
    const { data: superRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .maybeSingle();
    const isSuperAdmin = !!superRole;

    const body = await req.json();
    const { action, target_tenant_id: bodyTargetTenantId } = body;

    // Resolve effective tenant_id:
    // - super_admin: must provide target_tenant_id (the tenant being managed)
    // - master_admin: derived from their own profile, target_tenant_id ignored
    let tenant_id: string;
    if (isSuperAdmin) {
      if (!bodyTargetTenantId) {
        return new Response(JSON.stringify({ error: 'super_admin must provide target_tenant_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      tenant_id = bodyTargetTenantId;
    } else {
      const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', user.id)
        .single();
      if (callerProfileError || !callerProfile?.tenant_id) {
        return new Response(JSON.stringify({ error: 'Tenant não encontrado' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      tenant_id = callerProfile.tenant_id;

      // Caller must be master_admin in this tenant
      const { data: roleData } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', tenant_id)
        .eq('role', 'master_admin')
        .maybeSingle();
      if (!roleData) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Helper: ensure target user belongs to the same tenant being managed
    const assertSameTenant = async (target_user_id: string): Promise<boolean> => {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', target_user_id)
        .single();
      return data?.tenant_id === tenant_id;
    };

    if (action === 'create') {
      const { email, password, full_name, role, hotel_permissions } = body;
      if (!email || !password || !role) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Security: nobody can create another super_admin via this function.
      // super_admin must be provisioned manually in SQL.
      if (role === 'super_admin') {
        return new Response(JSON.stringify({ error: 'super_admin cannot be created via this function' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || '', tenant_id },
      });
      if (createError) throw createError;

      await supabaseAdmin
        .from('profiles')
        .upsert(
          { user_id: newUser.user.id, full_name: full_name || '', tenant_id },
          { onConflict: 'user_id' }
        );

      await supabaseAdmin
        .from('user_roles')
        .delete()
        .eq('user_id', newUser.user.id)
        .eq('tenant_id', tenant_id);

      await supabaseAdmin
        .from('user_roles')
        .insert({ user_id: newUser.user.id, role, tenant_id });

      if (hotel_permissions && Array.isArray(hotel_permissions) && hotel_permissions.length > 0 && role !== 'master_admin') {
        const permRows = hotel_permissions.map((p: string) => ({
          user_id: newUser.user.id,
          property_name: p,
          tenant_id,
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

      if (role === 'super_admin') {
        return new Response(JSON.stringify({ error: 'Cannot promote to super_admin' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!(await assertSameTenant(target_user_id))) {
        return new Response(JSON.stringify({ error: 'Usuário não pertence ao tenant alvo' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (target_user_id === user.id && role !== 'master_admin') {
        const { data: admins } = await supabaseAdmin
          .from('user_roles')
          .select('user_id')
          .eq('role', 'master_admin')
          .eq('tenant_id', tenant_id);
        if (!admins || admins.length <= 1) {
          return new Response(JSON.stringify({ error: 'Deve existir ao menos um Master Admin' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      await supabaseAdmin
        .from('user_roles')
        .delete()
        .eq('user_id', target_user_id)
        .eq('tenant_id', tenant_id);
      await supabaseAdmin
        .from('user_roles')
        .insert({ user_id: target_user_id, role, tenant_id });

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

      if (!(await assertSameTenant(target_user_id))) {
        return new Response(JSON.stringify({ error: 'Usuário não pertence ao tenant alvo' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await supabaseAdmin
        .from('user_hotel_permissions')
        .delete()
        .eq('user_id', target_user_id)
        .eq('tenant_id', tenant_id);

      if (hotel_permissions && Array.isArray(hotel_permissions) && hotel_permissions.length > 0) {
        const permRows = hotel_permissions.map((p: string) => ({
          user_id: target_user_id,
          property_name: p,
          tenant_id,
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

      if (!(await assertSameTenant(target_user_id))) {
        return new Response(JSON.stringify({ error: 'Usuário não pertence ao tenant alvo' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
        .eq('user_id', target_user_id)
        .eq('tenant_id', tenant_id);

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
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
