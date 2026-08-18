-- 1. closed_at on crm_accounts
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS closed_at date;

CREATE OR REPLACE FUNCTION public.crm_accounts_sync_account_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stage = 'fechamento'::public.crm_account_stage THEN
    IF NEW.account_status IS NULL THEN
      NEW.account_status := 'ativo'::public.crm_account_status;
    END IF;
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := CURRENT_DATE;
    END IF;
  ELSE
    NEW.account_status := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.crm_accounts
SET closed_at = COALESCE(closed_at, (updated_at)::date)
WHERE stage = 'fechamento'::public.crm_account_stage AND closed_at IS NULL;

-- 2. followers
CREATE TABLE IF NOT EXISTS public.crm_account_followers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.crm_account_followers TO authenticated;
GRANT ALL ON public.crm_account_followers TO service_role;

ALTER TABLE public.crm_account_followers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crm_followers_set_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id FROM public.crm_accounts WHERE id = NEW.account_id;
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS crm_followers_set_tenant ON public.crm_account_followers;
CREATE TRIGGER crm_followers_set_tenant
BEFORE INSERT ON public.crm_account_followers
FOR EACH ROW EXECUTE FUNCTION public.crm_followers_set_tenant_id();

DROP POLICY IF EXISTS "crm_followers_select" ON public.crm_account_followers;
CREATE POLICY "crm_followers_select" ON public.crm_account_followers
FOR SELECT TO authenticated
USING (public.can_view_crm(auth.uid(), tenant_id) AND (tenant_id = public.get_current_tenant_id() OR public.is_super_admin(auth.uid())));

DROP POLICY IF EXISTS "crm_followers_insert" ON public.crm_account_followers;
CREATE POLICY "crm_followers_insert" ON public.crm_account_followers
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_crm(auth.uid(), tenant_id) AND (tenant_id = public.get_current_tenant_id() OR public.is_super_admin(auth.uid())));

DROP POLICY IF EXISTS "crm_followers_delete" ON public.crm_account_followers;
CREATE POLICY "crm_followers_delete" ON public.crm_account_followers
FOR DELETE TO authenticated
USING (public.can_manage_crm(auth.uid(), tenant_id) AND (tenant_id = public.get_current_tenant_id() OR public.is_super_admin(auth.uid())));

-- 3. production cross-reference (post-closing check-ins)
CREATE OR REPLACE FUNCTION public.get_crm_production(p_tenant_id uuid)
RETURNS TABLE(
  account_id uuid,
  closed_at date,
  first_checkin date,
  last_checkin date,
  reservations bigint,
  revenue numeric,
  roomnights numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_view_crm(auth.uid(), p_tenant_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  WITH acc AS (
    SELECT a.id, a.closed_at,
      lower(extensions.unaccent(btrim(
        CASE WHEN a.account_type = 'empresa'::public.crm_account_type
             THEN COALESCE(a.company_name, '') ELSE COALESCE(a.travel_agent_name, '') END
      ))) AS nm,
      a.account_type
    FROM public.crm_accounts a
    WHERE a.tenant_id = p_tenant_id
  )
  SELECT ac.id, ac.closed_at,
    MIN(pr.arrival_date), MAX(pr.arrival_date),
    COUNT(pr.id)::bigint,
    COALESCE(SUM(pr.total_revenue), 0),
    COALESCE(SUM(pr.roomnights), 0)
  FROM acc ac
  LEFT JOIN public.processed_reservations pr
    ON pr.tenant_id = p_tenant_id
   AND ac.nm <> ''
   AND ac.closed_at IS NOT NULL
   AND pr.arrival_date >= ac.closed_at
   AND lower(extensions.unaccent(btrim(
         CASE WHEN ac.account_type = 'empresa'::public.crm_account_type
              THEN COALESCE(pr.company_name, '') ELSE COALESCE(pr.travel_agent_name, '') END
       ))) = ac.nm
  GROUP BY ac.id, ac.closed_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_crm_production(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_production(uuid) TO authenticated;