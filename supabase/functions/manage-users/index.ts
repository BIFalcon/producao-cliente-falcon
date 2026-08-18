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
      // Only existing super_admins can assign the super_admin role
      if (role === 'super_admin' && !isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Somente super_admin pode atribuir a role super_admin' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const allowedRoles = ['master_admin', 'editor', 'viewer', 'gerente_geral', 'super_admin'];
      if (!allowedRoles.includes(role)) {
        return new Response(JSON.stringify({ error: 'Role inválida' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let userId: string | null = null;

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || '', tenant_id: tenantId },
      });

      if (createError) {
        const isEmailExists = (createError as any).code === 'email_exists' ||
          /already been registered/i.test(createError.message || '');
        if (!isEmailExists) throw createError;

        // Conta de auth órfã (profile removido antes): localizar e reaproveitar
        let existing: { id: string } | null = null;
        for (let page = 1; page <= 20 && !existing; page++) {
          const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
          if (listError) throw listError;
          existing = (list.users.find(
            (u: any) => (u.email || '').toLowerCase() === String(email).toLowerCase()
          ) as any) || null;
          if (!list.users.length || list.users.length < 200) break;
        }

        if (!existing) {
          return new Response(JSON.stringify({ error: 'E-mail já registrado e não foi possível localizar a conta. Contate o suporte.' }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Se já pertence a outro tenant, bloquear
        const { data: otherProfile } = await supabaseAdmin
          .from('profiles')
          .select('tenant_id')
          .eq('user_id', existing.id)
          .maybeSingle();
        if (otherProfile && otherProfile.tenant_id && otherProfile.tenant_id !== tenantId) {
          return new Response(JSON.stringify({ error: 'Este e-mail já está em uso por outro cliente (tenant).' }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        await supabaseAdmin.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
          ban_duration: 'none',
          user_metadata: { full_name: full_name || '', tenant_id: tenantId },
        });
        userId = existing.id;
      } else {
        userId = newUser.user.id;
      }

      // Upsert garante que o profile exista mesmo se o trigger não tiver rodado
      await supabaseAdmin
        .from('profiles')
        .upsert(
          { user_id: userId, full_name: full_name || '', tenant_id: tenantId, is_active: true },
          { onConflict: 'user_id' }
        );

      await supabaseAdmin.from('user_roles').delete().eq('user_id', userId).eq('tenant_id', tenantId);
      await supabaseAdmin
        .from('user_roles')
        .upsert({ user_id: userId, role, tenant_id: tenantId }, { onConflict: 'user_id,role' });

      // Set hotel permissions if provided and not master_admin
      await supabaseAdmin.from('user_hotel_permissions').delete().eq('user_id', userId).eq('tenant_id', tenantId);
      if (hotel_permissions && Array.isArray(hotel_permissions) && hotel_permissions.length > 0 && role !== 'master_admin') {
        const permRows = hotel_permissions.map((p: string) => ({
          user_id: userId,
          tenant_id: tenantId,
          property_name: p,
        }));
        await supabaseAdmin.from('user_hotel_permissions').insert(permRows);
      }


      return new Response(JSON.stringify({ success: true, user_id: userId }), {
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
      // Only existing super_admins can assign the super_admin role
      if (role === 'super_admin' && !isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Somente super_admin pode atribuir a role super_admin' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const allowedRolesUpdate = ['master_admin', 'editor', 'viewer', 'gerente_geral', 'super_admin'];
      if (!allowedRolesUpdate.includes(role)) {
        return new Response(JSON.stringify({ error: 'Role inválida' }), {
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
      await supabaseAdmin.from('user_hotel_permissions').delete().eq('user_id', target_user_id).eq('tenant_id', tenantId);

      // Insert new permissions
      if (hotel_permissions && Array.isArray(hotel_permissions) && hotel_permissions.length > 0) {
        const permRows = hotel_permissions.map((p: string) => ({
          user_id: target_user_id,
          tenant_id: tenantId,
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
        .eq('user_id', target_user_id)
        .eq('tenant_id', tenantId);

      if (!is_active) {
        await supabaseAdmin.auth.admin.updateUserById(target_user_id, { ban_duration: '876000h' });
      } else {
        await supabaseAdmin.auth.admin.updateUserById(target_user_id, { ban_duration: 'none' });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'delete') {
      const { target_user_id } = body;
      if (!target_user_id) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (target_user_id === user.id) {
        return new Response(JSON.stringify({ error: 'Você não pode excluir sua própria conta' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Target must belong to the tenant being managed
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('user_id, tenant_id')
        .eq('user_id', target_user_id)
        .maybeSingle();

      if (!targetProfile || targetProfile.tenant_id !== tenantId) {
        return new Response(JSON.stringify({ error: 'Usuário não pertence a este tenant' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Never allow deleting a super_admin unless the caller is a super_admin
      const { data: targetSuper } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', target_user_id)
        .eq('role', 'super_admin')
        .maybeSingle();
      if (targetSuper && !isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Sem permissão para excluir este usuário' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Keep at least one master admin in the tenant
      const { data: targetRole } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', target_user_id)
        .eq('tenant_id', tenantId)
        .eq('role', 'master_admin')
        .maybeSingle();

      if (targetRole) {
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

      await supabaseAdmin.from('user_hotel_permissions').delete().eq('user_id', target_user_id);
      await supabaseAdmin.from('user_roles').delete().eq('user_id', target_user_id);
      await supabaseAdmin.from('profiles').delete().eq('user_id', target_user_id);

      const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(target_user_id);
      if (delError) throw delError;

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
