ALTER TABLE public.crm_accounts
  ADD COLUMN IF NOT EXISTS agreed_roomnights numeric,
  ADD COLUMN IF NOT EXISTS agreement_start date,
  ADD COLUMN IF NOT EXISTS agreement_end date,
  ADD COLUMN IF NOT EXISTS projected_revenue numeric,
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_name text;

ALTER TABLE public.crm_visits
  ADD COLUMN IF NOT EXISTS follow_up_time time,
  ADD COLUMN IF NOT EXISTS follow_up_type public.crm_visit_type,
  ADD COLUMN IF NOT EXISTS follow_up_notes text,
  ADD COLUMN IF NOT EXISTS follow_up_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_up_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_name text;

CREATE INDEX IF NOT EXISTS crm_visits_follow_up_idx
  ON public.crm_visits (tenant_id, next_follow_up_date)
  WHERE next_follow_up_date IS NOT NULL;

ALTER TABLE public.crm_visits
  DROP CONSTRAINT IF EXISTS crm_visits_account_id_fkey;
ALTER TABLE public.crm_visits
  ADD CONSTRAINT crm_visits_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES public.crm_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.crm_account_followers
  DROP CONSTRAINT IF EXISTS crm_account_followers_account_id_fkey;
ALTER TABLE public.crm_account_followers
  ADD CONSTRAINT crm_account_followers_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES public.crm_accounts(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "crm_accounts delete admins only" ON public.crm_accounts;
CREATE POLICY "crm_accounts delete comercial editors admins"
  ON public.crm_accounts FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (tenant_id = public.get_current_tenant_id() AND public.can_manage_crm(auth.uid(), tenant_id))
  );