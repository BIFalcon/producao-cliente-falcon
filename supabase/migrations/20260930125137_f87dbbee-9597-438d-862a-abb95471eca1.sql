DROP POLICY "crm_accounts read same tenant or hotel scoped" ON public.crm_accounts;
CREATE POLICY "crm_accounts read same tenant or hotel scoped" ON public.crm_accounts FOR SELECT TO authenticated
USING (
  (SELECT public.is_super_admin(auth.uid()))
  OR (
    tenant_id = (SELECT public.get_current_tenant_id())
    AND (SELECT public.can_view_crm(auth.uid(), public.get_current_tenant_id()))
    AND (
      (SELECT public.get_allowed_properties(auth.uid(), public.get_current_tenant_id())) IS NULL
      OR properties && (SELECT public.get_allowed_properties(auth.uid(), public.get_current_tenant_id()))
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_proc_res_tenant_year_month_prop ON public.processed_reservations (tenant_id, departure_year, departure_month, property_name);