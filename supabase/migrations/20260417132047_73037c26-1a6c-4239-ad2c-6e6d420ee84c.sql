-- 2) Allow nullable tenant_id on profiles & user_roles for super_admin
ALTER TABLE public.profiles ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.user_roles ALTER COLUMN tenant_id DROP NOT NULL;

-- 3) Helper: is current user super_admin?
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

-- 4) Update handle_new_user / handle_new_user_profile
-- super_admin is provisioned manually (no metadata.tenant_id), so triggers must skip them.
-- Existing functions already skip when tenant_id metadata is null, so they are safe.
-- No change needed, but we re-create defensively to ensure latest definition.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_tenant_id uuid; v_user_count int;
BEGIN
  v_tenant_id := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::uuid;
  IF v_tenant_id IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_user_count FROM public.user_roles WHERE tenant_id = v_tenant_id;
  IF v_user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (NEW.id, 'master_admin', v_tenant_id);
  END IF;
  RETURN NEW;
END;
$$;

-- 5) Add super_admin bypass policies on every tenant-scoped table

-- channel_mapping
CREATE POLICY "Super admin full access channel_mapping"
ON public.channel_mapping FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- processed_reservations
CREATE POLICY "Super admin full access processed_reservations"
ON public.processed_reservations FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- raw_reservations
CREATE POLICY "Super admin full access raw_reservations"
ON public.raw_reservations FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- upload_batches
CREATE POLICY "Super admin full access upload_batches"
ON public.upload_batches FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- profiles
CREATE POLICY "Super admin full access profiles"
ON public.profiles FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- user_roles
CREATE POLICY "Super admin full access user_roles"
ON public.user_roles FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- user_hotel_permissions
CREATE POLICY "Super admin full access user_hotel_permissions"
ON public.user_hotel_permissions FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- tenants: super_admin can do everything
CREATE POLICY "Super admin full access tenants"
ON public.tenants FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

-- 6) Update get_all_users to hide super_admins
CREATE OR REPLACE FUNCTION public.get_all_users(p_tenant_id uuid)
RETURNS TABLE(user_id uuid, email text, full_name text, role text, is_active boolean, created_at timestamp with time zone, hotel_permissions text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role_in_tenant(auth.uid(), 'master_admin', p_tenant_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, COALESCE(p.full_name, ''), COALESCE(ur.role::text, 'viewer'),
    COALESCE(p.is_active, true), u.created_at,
    COALESCE(
      (SELECT ARRAY_AGG(uhp.property_name) FROM public.user_hotel_permissions uhp
       WHERE uhp.user_id = u.id AND uhp.tenant_id = p_tenant_id),
      ARRAY[]::text[]
    )
  FROM auth.users u
  INNER JOIN public.profiles p ON p.user_id = u.id AND p.tenant_id = p_tenant_id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id AND ur.tenant_id = p_tenant_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles ur2 WHERE ur2.user_id = u.id AND ur2.role = 'super_admin'
  )
  ORDER BY u.created_at;
END;
$$;

-- 7) New: list all tenants (super_admin only)
CREATE OR REPLACE FUNCTION public.get_all_tenants()
RETURNS TABLE(id uuid, name text, slug text, is_active boolean, created_at timestamp with time zone, user_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.slug, t.is_active, t.created_at,
    (SELECT COUNT(*) FROM public.profiles p WHERE p.tenant_id = t.id)::bigint
  FROM public.tenants t
  ORDER BY t.created_at;
END;
$$;
