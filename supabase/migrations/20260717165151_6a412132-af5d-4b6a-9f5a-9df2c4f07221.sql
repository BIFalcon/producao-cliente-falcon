
-- ENUMs
CREATE TYPE public.crm_account_stage AS ENUM ('prospectado','contatado','em_negociacao','cliente_ativo','inativo');
CREATE TYPE public.crm_account_type AS ENUM ('empresa','agencia');
CREATE TYPE public.crm_visit_type AS ENUM ('visita_presencial','ligacao','email','whatsapp','outro');

-- crm_accounts
CREATE TABLE public.crm_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_type public.crm_account_type NOT NULL,
  company_name text,
  travel_agent_name text,
  city text,
  segment text,
  stage public.crm_account_stage NOT NULL DEFAULT 'prospectado',
  responsible_user_id uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_accounts_name_check CHECK (
    (account_type = 'empresa' AND company_name IS NOT NULL)
    OR (account_type = 'agencia' AND travel_agent_name IS NOT NULL)
  )
);
CREATE INDEX idx_crm_accounts_tenant ON public.crm_accounts(tenant_id);
CREATE INDEX idx_crm_accounts_company_name ON public.crm_accounts(tenant_id, company_name);
CREATE INDEX idx_crm_accounts_travel_agent ON public.crm_accounts(tenant_id, travel_agent_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_accounts TO authenticated;
GRANT ALL ON public.crm_accounts TO service_role;
ALTER TABLE public.crm_accounts ENABLE ROW LEVEL SECURITY;

-- crm_visits
CREATE TABLE public.crm_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  visit_type public.crm_visit_type NOT NULL,
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  summary text NOT NULL,
  next_follow_up_date date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crm_visits_tenant ON public.crm_visits(tenant_id);
CREATE INDEX idx_crm_visits_account ON public.crm_visits(account_id);
CREATE INDEX idx_crm_visits_follow_up ON public.crm_visits(tenant_id, next_follow_up_date) WHERE next_follow_up_date IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_visits TO authenticated;
GRANT ALL ON public.crm_visits TO service_role;
ALTER TABLE public.crm_visits ENABLE ROW LEVEL SECURITY;

-- Trigger: enforce tenant_id on visits from parent account
CREATE OR REPLACE FUNCTION public.crm_visits_set_tenant_id()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id FROM public.crm_accounts WHERE id = NEW.account_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_crm_visits_set_tenant_id
  BEFORE INSERT OR UPDATE OF account_id ON public.crm_visits
  FOR EACH ROW EXECUTE FUNCTION public.crm_visits_set_tenant_id();

-- Trigger: touch updated_at on accounts
CREATE TRIGGER trg_crm_accounts_updated_at
  BEFORE UPDATE ON public.crm_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Policies: viewer/editor/master_admin todos podem ler/escrever no CRM do próprio tenant.
-- super_admin tem acesso a qualquer tenant. Apenas master_admin/super_admin excluem.

-- crm_accounts
CREATE POLICY "crm_accounts read same tenant or super_admin"
  ON public.crm_accounts FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR tenant_id = public.get_current_tenant_id()
  );

CREATE POLICY "crm_accounts insert same tenant or super_admin"
  ON public.crm_accounts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id = public.get_current_tenant_id()
  );

CREATE POLICY "crm_accounts update same tenant or super_admin"
  ON public.crm_accounts FOR UPDATE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR tenant_id = public.get_current_tenant_id()
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id = public.get_current_tenant_id()
  );

CREATE POLICY "crm_accounts delete admins only"
  ON public.crm_accounts FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (
      tenant_id = public.get_current_tenant_id()
      AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
    )
  );

-- crm_visits
CREATE POLICY "crm_visits read same tenant or super_admin"
  ON public.crm_visits FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR tenant_id = public.get_current_tenant_id()
  );

CREATE POLICY "crm_visits insert same tenant or super_admin"
  ON public.crm_visits FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.crm_accounts a
      WHERE a.id = account_id
        AND a.tenant_id = public.get_current_tenant_id()
    )
  );

CREATE POLICY "crm_visits update same tenant or super_admin"
  ON public.crm_visits FOR UPDATE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR tenant_id = public.get_current_tenant_id()
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR tenant_id = public.get_current_tenant_id()
  );

CREATE POLICY "crm_visits delete admins only"
  ON public.crm_visits FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (
      tenant_id = public.get_current_tenant_id()
      AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
    )
  );
