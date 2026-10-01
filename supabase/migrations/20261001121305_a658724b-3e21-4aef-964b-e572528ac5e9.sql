-- Bloco 1: tenant_id nulo só para consultor/super_admin
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_tenant_required
  CHECK (tenant_id IS NOT NULL OR role IN ('consultor'::app_role, 'super_admin'::app_role)) NOT VALID;
ALTER TABLE public.user_roles VALIDATE CONSTRAINT user_roles_tenant_required;

CREATE OR REPLACE FUNCTION public.is_consultor(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'consultor') $$;

-- Bloco 2: CRM bloqueado para consultor
CREATE OR REPLACE FUNCTION public.can_view_crm(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin(_user_id)
    OR (NOT public.is_consultor(_user_id) AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.tenant_id = _tenant_id
        AND ur.role = 'gerente_geral'::public.app_role));
$$;
CREATE OR REPLACE FUNCTION public.can_manage_crm(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_super_admin(_user_id)
    OR (NOT public.is_consultor(_user_id) AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.tenant_id = _tenant_id
        AND ur.role IN ('master_admin'::public.app_role, 'editor'::public.app_role, 'viewer'::public.app_role)));
$$;

-- Bloco 3: leitura do consultor nos hotéis permitidos, em qualquer tenant
CREATE POLICY "Consultor reads permitted hotels processed" ON public.processed_reservations
FOR SELECT TO authenticated
USING ((SELECT public.is_consultor(auth.uid())) AND EXISTS (
  SELECT 1 FROM public.user_hotel_permissions uhp
  WHERE uhp.user_id = auth.uid() AND uhp.tenant_id = processed_reservations.tenant_id
    AND uhp.property_name = processed_reservations.property_name));
CREATE POLICY "Consultor reads permitted hotels raw" ON public.raw_reservations
FOR SELECT TO authenticated
USING ((SELECT public.is_consultor(auth.uid())) AND EXISTS (
  SELECT 1 FROM public.user_hotel_permissions uhp
  WHERE uhp.user_id = auth.uid() AND uhp.tenant_id = raw_reservations.tenant_id
    AND uhp.property_name = raw_reservations.property_name));

-- Seletor: grupos do consultor e troca do grupo ativo
CREATE OR REPLACE FUNCTION public.get_consultor_tenants()
RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT DISTINCT t.id, t.name FROM public.tenants t
  JOIN public.user_hotel_permissions uhp ON uhp.tenant_id = t.id AND uhp.user_id = auth.uid()
  WHERE public.is_consultor(auth.uid()) AND t.is_active
  ORDER BY t.name;
$$;
CREATE OR REPLACE FUNCTION public.set_consultor_tenant(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_consultor(auth.uid()) THEN RAISE EXCEPTION 'Somente consultores podem trocar de grupo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_hotel_permissions WHERE user_id = auth.uid() AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Sem hotéis permitidos neste grupo';
  END IF;
  UPDATE public.profiles SET tenant_id = p_tenant_id, updated_at = now() WHERE user_id = auth.uid();
END;
$$;

-- Bloco 4: hotéis de todos os tenants (para marcar no consultor) e permissões do usuário
CREATE OR REPLACE FUNCTION public.get_all_tenant_properties()
RETURNS TABLE(tenant_id uuid, tenant_name text, property_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_admin')) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT DISTINCT pr.tenant_id, t.name, pr.property_name
  FROM public.processed_reservations pr JOIN public.tenants t ON t.id = pr.tenant_id
  ORDER BY t.name, pr.property_name;
END;
$$;
CREATE OR REPLACE FUNCTION public.get_user_all_hotel_permissions(p_user_id uuid)
RETURNS TABLE(tenant_id uuid, property_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_admin')) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY SELECT uhp.tenant_id, uhp.property_name FROM public.user_hotel_permissions uhp WHERE uhp.user_id = p_user_id;
END;
$$;

-- Lista de usuários: consultor aparece em todo tenant onde tem hotel
CREATE OR REPLACE FUNCTION public.get_all_users(p_tenant_id uuid)
RETURNS TABLE(user_id uuid, email text, full_name text, role text, is_active boolean, created_at timestamp with time zone, hotel_permissions text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role_in_tenant(auth.uid(), 'master_admin', p_tenant_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, COALESCE(p.full_name, ''),
    CASE WHEN public.is_consultor(u.id) THEN 'consultor' ELSE COALESCE(ur.role::text, 'viewer') END,
    COALESCE(p.is_active, true), u.created_at,
    COALESCE(
      (SELECT ARRAY_AGG(uhp.property_name) FROM public.user_hotel_permissions uhp
       WHERE uhp.user_id = u.id AND uhp.tenant_id = p_tenant_id),
      ARRAY[]::text[]
    )
  FROM auth.users u
  INNER JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id AND ur.tenant_id = p_tenant_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles ur2 WHERE ur2.user_id = u.id AND ur2.role = 'super_admin'
  )
  AND (
    (p.tenant_id = p_tenant_id AND NOT public.is_consultor(u.id))
    OR (public.is_consultor(u.id) AND (p.tenant_id = p_tenant_id OR EXISTS (
      SELECT 1 FROM public.user_hotel_permissions x WHERE x.user_id = u.id AND x.tenant_id = p_tenant_id)))
  )
  ORDER BY u.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_consultor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_consultor_tenants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_consultor_tenant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_all_tenant_properties() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_all_hotel_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_consultor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_consultor_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_consultor_tenant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_tenant_properties() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_all_hotel_permissions(uuid) TO authenticated;