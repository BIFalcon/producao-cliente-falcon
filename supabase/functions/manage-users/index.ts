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

    // Resolve tenant_id from the caller's profile (server-side)
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
    const tenant_id: string = callerProfile.tenant_id;

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

    // Helper: ensure target user belongs to the same tenant
    const assertSameTenant = async (target_user_id: string): Promise<boolean> => {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', target_user_id)
        .single();
      return data?.tenant_id === tenant_id;
    };

    const body = await req.json();
    const { action } = body;

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
        user_metadata: { full_name: full_name || '', tenant_id },
      });
      if (createError) throw createError;

      // Triggers create profile + (first user of tenant) master_admin row using metadata.tenant_id.
      // Make sure the profile exists and has the right tenant + name.
      await supabaseAdmin
        .from('profiles')
        .upsert(
          { user_id: newUser.user.id, full_name: full_name || '', tenant_id },
          { onConflict: 'user_id' }
        );

      // Replace any auto-assigned role with the requested one (scoped to tenant)
      await supabaseAdmin
        .from('user_roles')
        .delete()
        .eq('user_id', newUser.user.id)
        .eq('tenant_id', tenant_id);

      await supabaseAdmin
        .from('user_roles')
        .insert({ user_id: newUser.user.id, role, tenant_id });

      // Set hotel permissions if provided and not master_admin
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

      if (!(await assertSameTenant(target_user_id))) {
        return new Response(JSON.stringify({ error: 'Usuário não pertence ao seu tenant' }), {
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
        return new Response(JSON.stringify({ error: 'Usuário não pertence ao seu tenant' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Clear existing permissions for this tenant only
      await supabaseAdmin
        .from('user_hotel_permissions')
        .delete()
        .eq('user_id', target_user_id)
        .eq('tenant_id', tenant_id);

      // Insert new permissions
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
        return new Response(JSON.stringify({ error: 'Usuário não pertence ao seu tenant' }), {
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
