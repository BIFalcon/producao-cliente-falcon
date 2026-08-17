-- Comercial (antigo viewer) pode gerenciar o CRM; Gerente Geral não acessa o CRM
CREATE OR REPLACE FUNCTION public.can_manage_crm(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.tenant_id = _tenant_id
        AND ur.role IN ('master_admin'::public.app_role, 'editor'::public.app_role, 'viewer'::public.app_role)
    );
$$;
REVOKE ALL ON FUNCTION public.can_manage_crm(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_crm(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_view_crm(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(_user_id)
    OR NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.tenant_id = _tenant_id
        AND ur.role = 'gerente_geral'::public.app_role
    );
$$;
REVOKE ALL ON FUNCTION public.can_view_crm(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_crm(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "crm_accounts insert editors or admins" ON public.crm_accounts;
CREATE POLICY "crm_accounts insert comercial editors admins" ON public.crm_accounts
FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()) OR (tenant_id = public.get_current_tenant_id() AND public.can_manage_crm(auth.uid(), tenant_id)));

DROP POLICY IF EXISTS "crm_accounts update editors or admins" ON public.crm_accounts;
CREATE POLICY "crm_accounts update comercial editors admins" ON public.crm_accounts
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()) OR (tenant_id = public.get_current_tenant_id() AND public.can_manage_crm(auth.uid(), tenant_id)))
WITH CHECK (public.is_super_admin(auth.uid()) OR (tenant_id = public.get_current_tenant_id() AND public.can_manage_crm(auth.uid(), tenant_id)));

DROP POLICY IF EXISTS "crm_accounts read same tenant or hotel scoped" ON public.crm_accounts;
CREATE POLICY "crm_accounts read same tenant or hotel scoped" ON public.crm_accounts
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND public.can_view_crm(auth.uid(), tenant_id)
    AND (public.get_allowed_properties(auth.uid(), tenant_id) IS NULL OR properties && public.get_allowed_properties(auth.uid(), tenant_id))
  )
);

DROP POLICY IF EXISTS "crm_visits update editors admins or creator" ON public.crm_visits;
CREATE POLICY "crm_visits update comercial editors admins or creator" ON public.crm_visits
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()) OR (tenant_id = public.get_current_tenant_id() AND (created_by = auth.uid() OR public.can_manage_crm(auth.uid(), tenant_id))))
WITH CHECK (public.is_super_admin(auth.uid()) OR (tenant_id = public.get_current_tenant_id() AND (created_by = auth.uid() OR public.can_manage_crm(auth.uid(), tenant_id))));

DROP POLICY IF EXISTS "crm_visits insert same tenant or super_admin" ON public.crm_visits;
CREATE POLICY "crm_visits insert comercial editors admins" ON public.crm_visits
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.crm_accounts a
      WHERE a.id = crm_visits.account_id
        AND a.tenant_id = public.get_current_tenant_id()
        AND public.can_manage_crm(auth.uid(), a.tenant_id)
    )
  )
);

DROP POLICY IF EXISTS "crm_visits read same tenant or hotel scoped" ON public.crm_visits;
CREATE POLICY "crm_visits read same tenant or hotel scoped" ON public.crm_visits
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    tenant_id = public.get_current_tenant_id()
    AND public.can_view_crm(auth.uid(), tenant_id)
    AND EXISTS (
      SELECT 1 FROM public.crm_accounts a
      WHERE a.id = crm_visits.account_id
        AND (public.get_allowed_properties(auth.uid(), a.tenant_id) IS NULL OR a.properties && public.get_allowed_properties(auth.uid(), a.tenant_id))
    )
  )
);

DROP POLICY IF EXISTS "crm_visits delete admins only" ON public.crm_visits;
CREATE POLICY "crm_visits delete comercial editors admins" ON public.crm_visits
FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()) OR (tenant_id = public.get_current_tenant_id() AND (created_by = auth.uid() OR public.can_manage_crm(auth.uid(), tenant_id))));