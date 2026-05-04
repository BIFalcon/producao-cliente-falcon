DROP POLICY IF EXISTS "Read processed_reservations within tenant" ON public.processed_reservations;

CREATE POLICY "Read processed_reservations within tenant"
ON public.processed_reservations
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR tenant_id = public.get_current_tenant_id()
);