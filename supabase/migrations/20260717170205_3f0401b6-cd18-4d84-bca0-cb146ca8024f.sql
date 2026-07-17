
-- 1) Revoke public/anon execute on internal trigger function
REVOKE EXECUTE ON FUNCTION public.crm_visits_set_tenant_id() FROM PUBLIC, anon;

-- 2) Enforce created_by = auth.uid() on crm_visits INSERT
DROP POLICY IF EXISTS "crm_visits insert same tenant or super_admin" ON public.crm_visits;
CREATE POLICY "crm_visits insert same tenant or super_admin"
ON public.crm_visits
FOR INSERT
TO authenticated
WITH CHECK (
  (created_by = auth.uid())
  AND (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.crm_accounts a
      WHERE a.id = crm_visits.account_id
        AND a.tenant_id = public.get_current_tenant_id()
    )
  )
);

-- 3) Add tenant-scoped UPDATE policy for raw_reservations (editors + master_admins)
CREATE POLICY "Editors/admins update raw_reservations within tenant"
ON public.raw_reservations
FOR UPDATE
TO authenticated
USING (
  (tenant_id = public.get_current_tenant_id())
  AND (
    public.has_role_in_tenant(auth.uid(), 'master_admin'::app_role, tenant_id)
    OR public.has_role_in_tenant(auth.uid(), 'editor'::app_role, tenant_id)
  )
)
WITH CHECK (
  (tenant_id = public.get_current_tenant_id())
  AND (
    public.has_role_in_tenant(auth.uid(), 'master_admin'::app_role, tenant_id)
    OR public.has_role_in_tenant(auth.uid(), 'editor'::app_role, tenant_id)
  )
);
