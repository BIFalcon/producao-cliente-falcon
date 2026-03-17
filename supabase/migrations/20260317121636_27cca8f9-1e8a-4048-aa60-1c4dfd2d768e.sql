
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('master_admin', 'editor', 'viewer');

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Check if any users exist
CREATE OR REPLACE FUNCTION public.has_any_users()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles LIMIT 1)
$$;

-- RLS for user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Master admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'));

-- Auto-assign first user as master_admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'master_admin');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Raw reservations (uploaded CSV data)
CREATE TABLE public.raw_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_name TEXT,
  reservation_status TEXT,
  confirmation_number TEXT,
  reservation_date DATE,
  arrival_date DATE,
  arrival_time TEXT,
  departure_date DATE,
  departure_time TEXT,
  travel_agent_name TEXT,
  company_name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  room_revenue NUMERIC DEFAULT 0,
  fb_revenue NUMERIC DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  upload_batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.raw_reservations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_raw_res_confirmation ON public.raw_reservations(confirmation_number, property_name);
CREATE INDEX idx_raw_res_departure ON public.raw_reservations(departure_date);
CREATE INDEX idx_raw_res_status ON public.raw_reservations(reservation_status);
CREATE INDEX idx_raw_res_batch ON public.raw_reservations(upload_batch_id);

-- Processed/aggregated reservations
CREATE TABLE public.processed_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_name TEXT NOT NULL,
  confirmation_number TEXT NOT NULL,
  reservation_date DATE,
  arrival_date DATE,
  departure_date DATE,
  travel_agent_name TEXT,
  company_name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  room_revenue NUMERIC DEFAULT 0,
  fb_revenue NUMERIC DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  lead_time_days INT,
  sales_channel TEXT,
  departure_month INT,
  departure_year INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (confirmation_number, property_name)
);
ALTER TABLE public.processed_reservations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_proc_res_property ON public.processed_reservations(property_name);
CREATE INDEX idx_proc_res_channel ON public.processed_reservations(sales_channel);
CREATE INDEX idx_proc_res_company ON public.processed_reservations(company_name);
CREATE INDEX idx_proc_res_agent ON public.processed_reservations(travel_agent_name);
CREATE INDEX idx_proc_res_departure ON public.processed_reservations(departure_year, departure_month);
CREATE INDEX idx_proc_res_city ON public.processed_reservations(city);

-- Upload batches tracking
CREATE TABLE public.upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID REFERENCES auth.users(id) NOT NULL,
  file_name TEXT,
  total_rows INT DEFAULT 0,
  processed_rows INT DEFAULT 0,
  status TEXT DEFAULT 'pending',
  mode TEXT DEFAULT 'replace',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;

-- RLS policies for authenticated users
CREATE POLICY "Authenticated users can read raw_reservations" ON public.raw_reservations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Editors and admins can insert raw_reservations" ON public.raw_reservations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin') OR public.has_role(auth.uid(), 'editor')
  );

CREATE POLICY "Admins can delete raw_reservations" ON public.raw_reservations
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'));

CREATE POLICY "Authenticated users can read processed_reservations" ON public.processed_reservations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "System can manage processed_reservations" ON public.processed_reservations
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'master_admin') OR public.has_role(auth.uid(), 'editor')
  );

CREATE POLICY "Authenticated users can read upload_batches" ON public.upload_batches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Editors and admins can insert upload_batches" ON public.upload_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'master_admin') OR public.has_role(auth.uid(), 'editor')
  );

CREATE POLICY "Admins can manage upload_batches" ON public.upload_batches
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master_admin'));

-- Aggregation function to process raw data into processed_reservations
CREATE OR REPLACE FUNCTION public.process_reservations(p_batch_id UUID DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Clear processed data if replacing
  IF p_batch_id IS NOT NULL THEN
    DELETE FROM public.processed_reservations;
  END IF;

  INSERT INTO public.processed_reservations (
    property_name, confirmation_number, reservation_date, arrival_date,
    departure_date, travel_agent_name, company_name, city, state, country,
    room_revenue, fb_revenue, total_revenue, lead_time_days, sales_channel,
    departure_month, departure_year
  )
  SELECT
    r.property_name,
    r.confirmation_number,
    MIN(r.reservation_date),
    MIN(r.arrival_date),
    MAX(r.departure_date),
    MAX(r.travel_agent_name),
    MAX(r.company_name),
    MAX(r.city),
    MAX(r.state),
    MAX(r.country),
    SUM(COALESCE(r.room_revenue, 0)),
    SUM(COALESCE(r.fb_revenue, 0)),
    CASE
      WHEN SUM(COALESCE(r.total_revenue, 0)) > 0 THEN SUM(COALESCE(r.total_revenue, 0))
      ELSE SUM(COALESCE(r.room_revenue, 0)) + SUM(COALESCE(r.fb_revenue, 0))
    END,
    EXTRACT(DAY FROM MIN(r.arrival_date) - MIN(r.reservation_date))::INT,
    -- Sales channel classification
    CASE
      WHEN LOWER(COALESCE(MAX(r.company_name),'') || ' ' || COALESCE(MAX(r.travel_agent_name),'')) ~ '(booking|expedia|decolar)' THEN 'OTA'
      WHEN LOWER(COALESCE(MAX(r.company_name),'') || ' ' || COALESCE(MAX(r.travel_agent_name),'')) ~ '(trend|ehlt|cvc|europlus|frt|bwt|brt|tbo|foco|masterop|dluna)' THEN 'Operadoras'
      WHEN LOWER(COALESCE(MAX(r.company_name),'') || ' ' || COALESCE(MAX(r.travel_agent_name),'')) ~ 'azul linhas aereas'
        AND NOT LOWER(COALESCE(MAX(r.company_name),'') || ' ' || COALESCE(MAX(r.travel_agent_name),'')) ~ 'azul viagens' THEN 'Layover'
      WHEN COALESCE(MAX(r.company_name), '') != '' AND MAX(r.company_name) IS NOT NULL THEN 'Empresas'
      WHEN (MAX(r.company_name) IS NULL OR MAX(r.company_name) = '')
        AND (MAX(r.travel_agent_name) IS NULL OR MAX(r.travel_agent_name) = '')
        AND SUM(COALESCE(r.total_revenue, 0)) + SUM(COALESCE(r.room_revenue, 0)) + SUM(COALESCE(r.fb_revenue, 0)) > 0 THEN 'Particular'
      ELSE 'Outros'
    END,
    EXTRACT(MONTH FROM MAX(r.departure_date))::INT,
    EXTRACT(YEAR FROM MAX(r.departure_date))::INT
  FROM public.raw_reservations r
  WHERE LOWER(r.reservation_status) IN ('checked out', 'checked in', 'no show')
  GROUP BY r.confirmation_number, r.property_name
  ON CONFLICT (confirmation_number, property_name) DO UPDATE SET
    reservation_date = EXCLUDED.reservation_date,
    arrival_date = EXCLUDED.arrival_date,
    departure_date = EXCLUDED.departure_date,
    travel_agent_name = EXCLUDED.travel_agent_name,
    company_name = EXCLUDED.company_name,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    country = EXCLUDED.country,
    room_revenue = EXCLUDED.room_revenue,
    fb_revenue = EXCLUDED.fb_revenue,
    total_revenue = EXCLUDED.total_revenue,
    lead_time_days = EXCLUDED.lead_time_days,
    sales_channel = EXCLUDED.sales_channel,
    departure_month = EXCLUDED.departure_month,
    departure_year = EXCLUDED.departure_year;
END;
$$;

-- Dashboard aggregation views
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(
  p_property TEXT DEFAULT NULL,
  p_year INT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL
)
RETURNS TABLE(
  total_revenue NUMERIC,
  total_reservations BIGINT,
  avg_lead_time NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    SUM(pr.total_revenue),
    COUNT(*)::BIGINT,
    AVG(pr.lead_time_days)::NUMERIC
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel);
END;
$$;

-- Monthly revenue function
CREATE OR REPLACE FUNCTION public.get_monthly_revenue(
  p_property TEXT DEFAULT NULL,
  p_year INT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL
)
RETURNS TABLE(
  month INT,
  year INT,
  revenue NUMERIC,
  reservations BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.departure_month,
    pr.departure_year,
    SUM(pr.total_revenue),
    COUNT(*)::BIGINT
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
  GROUP BY pr.departure_month, pr.departure_year
  ORDER BY pr.departure_year, pr.departure_month;
END;
$$;

-- Channel analytics
CREATE OR REPLACE FUNCTION public.get_channel_analytics(
  p_property TEXT DEFAULT NULL,
  p_year INT DEFAULT NULL
)
RETURNS TABLE(
  sales_channel TEXT,
  revenue NUMERIC,
  reservations BIGINT,
  share_pct NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH totals AS (
    SELECT SUM(pr.total_revenue) AS total
    FROM public.processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
  )
  SELECT
    pr.sales_channel,
    SUM(pr.total_revenue),
    COUNT(*)::BIGINT,
    CASE WHEN t.total > 0 THEN ROUND(SUM(pr.total_revenue) / t.total * 100, 2) ELSE 0 END
  FROM public.processed_reservations pr
  CROSS JOIN totals t
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
  GROUP BY pr.sales_channel, t.total
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

-- Company table
CREATE OR REPLACE FUNCTION public.get_company_table(
  p_property TEXT DEFAULT NULL,
  p_current_year INT DEFAULT NULL,
  p_previous_year INT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL
)
RETURNS TABLE(
  company_name TEXT,
  revenue_current NUMERIC,
  revenue_previous NUMERIC,
  absolute_change NUMERIC,
  pct_change NUMERIC,
  revenue_share NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH current_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    GROUP BY pr.company_name
  ),
  previous_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    GROUP BY pr.company_name
  ),
  total AS (
    SELECT SUM(rev) AS t FROM current_yr
  )
  SELECT
    COALESCE(c.cn, p.cn),
    COALESCE(c.rev, 0),
    COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    CASE WHEN t.t > 0 THEN ROUND(COALESCE(c.rev, 0) / t.t * 100, 2) ELSE 0 END
  FROM current_yr c
  FULL OUTER JOIN previous_yr p ON c.cn = p.cn
  CROSS JOIN total t
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- Get available filters
CREATE OR REPLACE FUNCTION public.get_filter_options()
RETURNS TABLE(
  properties TEXT[],
  years INT[],
  channels TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ARRAY(SELECT DISTINCT pr.property_name FROM public.processed_reservations pr ORDER BY pr.property_name),
    ARRAY(SELECT DISTINCT pr.departure_year FROM public.processed_reservations pr ORDER BY pr.departure_year DESC),
    ARRAY(SELECT DISTINCT pr.sales_channel FROM public.processed_reservations pr ORDER BY pr.sales_channel);
END;
$$;

-- City analytics
CREATE OR REPLACE FUNCTION public.get_city_analytics(
  p_property TEXT DEFAULT NULL,
  p_year INT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL
)
RETURNS TABLE(
  city TEXT,
  state TEXT,
  company_count BIGINT,
  revenue NUMERIC,
  reservations BIGINT,
  top_companies TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH city_data AS (
    SELECT
      pr.city AS c,
      pr.state AS s,
      COUNT(DISTINCT pr.company_name) AS cc,
      SUM(pr.total_revenue) AS rev,
      COUNT(*) AS res
    FROM public.processed_reservations pr
    WHERE pr.city IS NOT NULL AND pr.city != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    GROUP BY pr.city, pr.state
  ),
  top_co AS (
    SELECT
      pr.city AS c,
      pr.state AS s,
      ARRAY_AGG(DISTINCT pr.company_name ORDER BY pr.company_name) FILTER (WHERE pr.company_name IS NOT NULL AND pr.company_name != '') AS companies
    FROM public.processed_reservations pr
    WHERE pr.city IS NOT NULL AND pr.city != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    GROUP BY pr.city, pr.state
  )
  SELECT cd.c, cd.s, cd.cc, cd.rev, cd.res, COALESCE(tc.companies[1:5], ARRAY[]::TEXT[])
  FROM city_data cd
  LEFT JOIN top_co tc ON cd.c = tc.c AND cd.s = tc.s
  ORDER BY cd.rev DESC;
END;
$$;

-- Agent breakdown
CREATE OR REPLACE FUNCTION public.get_agent_breakdown(
  p_property TEXT DEFAULT NULL,
  p_year INT DEFAULT NULL
)
RETURNS TABLE(
  travel_agent_name TEXT,
  revenue NUMERIC,
  reservations BIGINT,
  companies TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.travel_agent_name,
    SUM(pr.total_revenue),
    COUNT(*)::BIGINT,
    ARRAY_AGG(DISTINCT pr.company_name) FILTER (WHERE pr.company_name IS NOT NULL AND pr.company_name != '')
  FROM public.processed_reservations pr
  WHERE pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
  GROUP BY pr.travel_agent_name
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

-- Concentration metrics
CREATE OR REPLACE FUNCTION public.get_concentration_metrics(
  p_property TEXT DEFAULT NULL,
  p_year INT DEFAULT NULL,
  p_channel TEXT DEFAULT NULL
)
RETURNS TABLE(
  top1_share NUMERIC,
  top3_share NUMERIC,
  top5_share NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      pr.company_name,
      SUM(pr.total_revenue) AS rev,
      ROW_NUMBER() OVER (ORDER BY SUM(pr.total_revenue) DESC) AS rn
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    GROUP BY pr.company_name
  ),
  total AS (SELECT SUM(rev) AS t FROM ranked)
  SELECT
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 1 THEN r.rev END), 0) / NULLIF(t.t, 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 3 THEN r.rev END), 0) / NULLIF(t.t, 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 5 THEN r.rev END), 0) / NULLIF(t.t, 0) * 100, 2)
  FROM ranked r
  CROSS JOIN total t;
END;
$$;
