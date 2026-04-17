-- =========================================================
-- PHASE 1: Multi-tenant foundation (corrected order)
-- =========================================================

-- 1) tenants table (RLS enabled, policy added later after profiles.tenant_id exists)
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 2) Insert initial tenants
INSERT INTO public.tenants (name, slug)
VALUES
  ('Falcon - Nordeste', 'falcon-nordeste'),
  ('Falcon - Demais',   'falcon-demais');

-- 3) Add tenant_id columns
ALTER TABLE public.profiles                ADD COLUMN tenant_id uuid;
ALTER TABLE public.user_roles              ADD COLUMN tenant_id uuid;
ALTER TABLE public.user_hotel_permissions  ADD COLUMN tenant_id uuid;
ALTER TABLE public.raw_reservations        ADD COLUMN tenant_id uuid;
ALTER TABLE public.processed_reservations  ADD COLUMN tenant_id uuid;
ALTER TABLE public.channel_mapping         ADD COLUMN tenant_id uuid;
ALTER TABLE public.upload_batches          ADD COLUMN tenant_id uuid;

-- 4) Backfill all existing data to "Falcon - Nordeste"
DO $$
DECLARE v_nordeste uuid;
BEGIN
  SELECT id INTO v_nordeste FROM public.tenants WHERE slug = 'falcon-nordeste';

  UPDATE public.profiles                SET tenant_id = v_nordeste WHERE tenant_id IS NULL;
  UPDATE public.user_roles              SET tenant_id = v_nordeste WHERE tenant_id IS NULL;
  UPDATE public.user_hotel_permissions  SET tenant_id = v_nordeste WHERE tenant_id IS NULL;
  UPDATE public.raw_reservations        SET tenant_id = v_nordeste WHERE tenant_id IS NULL;
  UPDATE public.processed_reservations  SET tenant_id = v_nordeste WHERE tenant_id IS NULL;
  UPDATE public.channel_mapping         SET tenant_id = v_nordeste WHERE tenant_id IS NULL;
  UPDATE public.upload_batches          SET tenant_id = v_nordeste WHERE tenant_id IS NULL;
END $$;

-- 5) NOT NULL + FKs
ALTER TABLE public.profiles                ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.user_roles              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.user_hotel_permissions  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.raw_reservations        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.processed_reservations  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.channel_mapping         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.upload_batches          ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.profiles                ADD CONSTRAINT profiles_tenant_fk                FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
ALTER TABLE public.user_roles              ADD CONSTRAINT user_roles_tenant_fk              FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
ALTER TABLE public.user_hotel_permissions  ADD CONSTRAINT user_hotel_permissions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
ALTER TABLE public.raw_reservations        ADD CONSTRAINT raw_reservations_tenant_fk        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
ALTER TABLE public.processed_reservations  ADD CONSTRAINT processed_reservations_tenant_fk  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
ALTER TABLE public.channel_mapping         ADD CONSTRAINT channel_mapping_tenant_fk         FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
ALTER TABLE public.upload_batches          ADD CONSTRAINT upload_batches_tenant_fk          FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

-- 6) Indexes
CREATE INDEX idx_profiles_tenant                ON public.profiles(tenant_id);
CREATE INDEX idx_user_roles_tenant              ON public.user_roles(tenant_id);
CREATE INDEX idx_user_hotel_permissions_tenant  ON public.user_hotel_permissions(tenant_id);
CREATE INDEX idx_raw_reservations_tenant        ON public.raw_reservations(tenant_id);
CREATE INDEX idx_processed_reservations_tenant  ON public.processed_reservations(tenant_id);
CREATE INDEX idx_channel_mapping_tenant         ON public.channel_mapping(tenant_id);
CREATE INDEX idx_upload_batches_tenant          ON public.upload_batches(tenant_id);

-- 7) Helper functions
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_any_users_in_tenant(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = _tenant_id LIMIT 1)
$$;

CREATE OR REPLACE FUNCTION public.has_role_in_tenant(_user_id uuid, _role app_role, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role AND tenant_id = _tenant_id
  )
$$;

-- 8) tenants policy (now safe — profiles.tenant_id exists)
CREATE POLICY "Users read their own tenant"
  ON public.tenants FOR SELECT TO authenticated
  USING (id = public.get_current_tenant_id());

-- 9) Replace signup triggers to capture tenant_id from user metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_user_count int;
BEGIN
  v_tenant_id := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::uuid;
  IF v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_user_count FROM public.user_roles WHERE tenant_id = v_tenant_id;
  IF v_user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (NEW.id, 'master_admin', v_tenant_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id uuid;
BEGIN
  v_tenant_id := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::uuid;
  IF v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (user_id, full_name, tenant_id)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), v_tenant_id);
  RETURN NEW;
END;
$$;

-- =========================================================
-- 10) RLS rewrite — tenant isolation everywhere
-- =========================================================

-- profiles
DROP POLICY IF EXISTS "Master admins can manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile"        ON public.profiles;

CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Master admins manage profiles in tenant"
  ON public.profiles FOR ALL TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  )
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  );

-- user_roles
DROP POLICY IF EXISTS "Master admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles"       ON public.user_roles;

CREATE POLICY "Users view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Master admins manage roles in tenant"
  ON public.user_roles FOR ALL TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  )
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  );

-- user_hotel_permissions
DROP POLICY IF EXISTS "Master admins can manage hotel permissions" ON public.user_hotel_permissions;
DROP POLICY IF EXISTS "Users can view own permissions"             ON public.user_hotel_permissions;

CREATE POLICY "Users view own permissions"
  ON public.user_hotel_permissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Master admins manage hotel permissions in tenant"
  ON public.user_hotel_permissions FOR ALL TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  )
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  );

-- raw_reservations
DROP POLICY IF EXISTS "Authenticated users can read raw_reservations"  ON public.raw_reservations;
DROP POLICY IF EXISTS "Editors and admins can insert raw_reservations" ON public.raw_reservations;
DROP POLICY IF EXISTS "Admins can delete raw_reservations"             ON public.raw_reservations;

CREATE POLICY "Read raw_reservations within tenant"
  ON public.raw_reservations FOR SELECT TO authenticated
  USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Editors/admins insert raw_reservations within tenant"
  ON public.raw_reservations FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor', tenant_id)
    )
  );

CREATE POLICY "Admins delete raw_reservations within tenant"
  ON public.raw_reservations FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  );

-- processed_reservations
DROP POLICY IF EXISTS "Authenticated users can read processed_reservations" ON public.processed_reservations;
DROP POLICY IF EXISTS "System can manage processed_reservations"            ON public.processed_reservations;

CREATE POLICY "Read processed_reservations within tenant"
  ON public.processed_reservations FOR SELECT TO authenticated
  USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Editors/admins manage processed_reservations within tenant"
  ON public.processed_reservations FOR ALL TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor', tenant_id)
    )
  )
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor', tenant_id)
    )
  );

-- channel_mapping
DROP POLICY IF EXISTS "Authenticated users can read channel_mapping"   ON public.channel_mapping;
DROP POLICY IF EXISTS "Admins and editors can manage channel_mapping"  ON public.channel_mapping;

CREATE POLICY "Read channel_mapping within tenant"
  ON public.channel_mapping FOR SELECT TO authenticated
  USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Editors/admins manage channel_mapping within tenant"
  ON public.channel_mapping FOR ALL TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor', tenant_id)
    )
  )
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor', tenant_id)
    )
  );

-- upload_batches
DROP POLICY IF EXISTS "Authenticated users can read upload_batches"  ON public.upload_batches;
DROP POLICY IF EXISTS "Editors and admins can insert upload_batches" ON public.upload_batches;
DROP POLICY IF EXISTS "Admins can manage upload_batches"             ON public.upload_batches;

CREATE POLICY "Read upload_batches within tenant"
  ON public.upload_batches FOR SELECT TO authenticated
  USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Editors/admins insert upload_batches within tenant"
  ON public.upload_batches FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND (
      public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
      OR public.has_role_in_tenant(auth.uid(), 'editor', tenant_id)
    )
  );

CREATE POLICY "Admins manage upload_batches within tenant"
  ON public.upload_batches FOR ALL TO authenticated
  USING (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  )
  WITH CHECK (
    tenant_id = public.get_current_tenant_id()
    AND public.has_role_in_tenant(auth.uid(), 'master_admin', tenant_id)
  );
