ALTER TABLE public.crm_accounts
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text;

CREATE OR REPLACE FUNCTION public.get_tenant_users_basic(p_tenant_id uuid)
RETURNS TABLE(user_id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name
  FROM public.profiles p
  WHERE p.tenant_id = p_tenant_id
    AND (public.is_super_admin(auth.uid()) OR p_tenant_id = public.get_current_tenant_id())
  ORDER BY p.full_name
$$;

REVOKE ALL ON FUNCTION public.get_tenant_users_basic(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tenant_users_basic(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_users_basic(uuid) TO authenticated;