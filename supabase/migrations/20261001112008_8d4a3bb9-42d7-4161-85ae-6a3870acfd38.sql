CREATE TABLE public.reservation_nights_by_month (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_name text NOT NULL,
  confirmation_number text NOT NULL,
  sales_channel text,
  company_name text,
  travel_agent_name text,
  ref_year integer NOT NULL,
  ref_month integer NOT NULL,
  nights_in_month numeric NOT NULL DEFAULT 0,
  room_revenue_alloc numeric NOT NULL DEFAULT 0,
  total_revenue_alloc numeric NOT NULL DEFAULT 0,
  source_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reservation_nights_by_month TO authenticated;
GRANT ALL ON public.reservation_nights_by_month TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.reservation_nights_by_month_id_seq TO service_role;
ALTER TABLE public.reservation_nights_by_month ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read nights by month" ON public.reservation_nights_by_month
FOR SELECT TO authenticated
USING (tenant_id = (SELECT public.get_current_tenant_id()) OR (SELECT public.is_super_admin(auth.uid())));

CREATE INDEX idx_rnbm_tenant_ym_prop ON public.reservation_nights_by_month (tenant_id, ref_year, ref_month, property_name);
CREATE INDEX idx_rnbm_tenant_prop ON public.reservation_nights_by_month (tenant_id, property_name);

CREATE OR REPLACE FUNCTION public.rebuild_nights_by_month(p_tenant_id uuid, p_property_name text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '2400s'
AS $$
DECLARE v_prop text; v_total integer := 0; v_n integer;
BEGIN
  FOR v_prop IN
    SELECT DISTINCT property_name FROM processed_reservations
    WHERE tenant_id = p_tenant_id AND (p_property_name IS NULL OR property_name = p_property_name)
  LOOP
    DELETE FROM reservation_nights_by_month WHERE tenant_id = p_tenant_id AND property_name = v_prop;

    WITH st AS (
      SELECT DISTINCT ON (r.confirmation_number) r.confirmation_number,
             LOWER(COALESCE(r.reservation_status,'')) AS status, r.upload_batch_id
      FROM raw_reservations r JOIN upload_batches b ON b.id = r.upload_batch_id
      WHERE r.tenant_id = p_tenant_id AND r.property_name = v_prop
      ORDER BY r.confirmation_number, b.created_at DESC
    ),
    p AS (
      SELECT pr.*, st.status, st.upload_batch_id,
             (pr.departure_date - pr.arrival_date) AS cal
      FROM processed_reservations pr LEFT JOIN st ON st.confirmation_number = pr.confirmation_number
      WHERE pr.tenant_id = p_tenant_id AND pr.property_name = v_prop
        AND pr.arrival_date IS NOT NULL AND pr.departure_date IS NOT NULL
        AND NOT (st.status = 'no show' AND COALESCE(pr.total_revenue,0) = 0)
    ),
    -- No-show com receita: tudo no mês da saída prevista, sem rateio
    ns AS (
      SELECT p.*, p.departure_date AS d, COALESCE(p.roomnights,0)::numeric AS nights, 1::numeric AS f
      FROM p WHERE p.status = 'no show'
    ),
    -- Day use: 1 noite, receita inteira no dia
    du AS (
      SELECT p.*, p.arrival_date AS d, 1::numeric AS nights, 1::numeric AS f
      FROM p WHERE COALESCE(p.status,'') <> 'no show' AND p.cal <= 0
    ),
    -- Estada normal: rateio por mês tocado, base = roomnights da reserva
    st_norm AS (
      SELECT p.*, m.ms AS d,
        (LEAST(p.departure_date, (m.ms + interval '1 month')::date) - GREATEST(p.arrival_date, m.ms))::numeric / p.cal AS f
      FROM p
      CROSS JOIN LATERAL generate_series(date_trunc('month', p.arrival_date)::date,
                                         date_trunc('month', p.departure_date - 1)::date,
                                         interval '1 month') AS g(x)
      CROSS JOIN LATERAL (SELECT g.x::date AS ms) m
      WHERE COALESCE(p.status,'') <> 'no show' AND p.cal > 0
    ),
    alloc AS (
      SELECT tenant_id, property_name, confirmation_number, sales_channel, company_name, travel_agent_name,
             d, nights * f AS nim, room_revenue, total_revenue, f, upload_batch_id FROM ns
      UNION ALL
      SELECT tenant_id, property_name, confirmation_number, sales_channel, company_name, travel_agent_name,
             d, nights * f, room_revenue, total_revenue, f, upload_batch_id FROM du
      UNION ALL
      SELECT tenant_id, property_name, confirmation_number, sales_channel, company_name, travel_agent_name,
             d, COALESCE(roomnights,0) * f, room_revenue, total_revenue, f, upload_batch_id FROM st_norm
    )
    INSERT INTO reservation_nights_by_month (tenant_id, property_name, confirmation_number, sales_channel,
      company_name, travel_agent_name, ref_year, ref_month, nights_in_month, room_revenue_alloc,
      total_revenue_alloc, source_batch_id)
    SELECT tenant_id, property_name, confirmation_number, sales_channel, company_name, travel_agent_name,
      EXTRACT(YEAR FROM d)::int, EXTRACT(MONTH FROM d)::int, nim,
      COALESCE(room_revenue,0) * f, COALESCE(total_revenue,0) * f, upload_batch_id
    FROM alloc WHERE f > 0;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.rebuild_nights_by_month(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_nights_by_month(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_channel_multiyear_competencia(p_tenant_id uuid, p_property text[] DEFAULT NULL, p_month integer[] DEFAULT NULL)
RETURNS TABLE(sales_channel text, departure_year integer, revenue numeric, roomnights numeric, room_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  IF NOT (public.is_super_admin(auth.uid()) OR public.get_current_tenant_id() = p_tenant_id) THEN RETURN; END IF;
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT n.sales_channel, n.ref_year, SUM(n.total_revenue_alloc), SUM(n.nights_in_month), SUM(n.room_revenue_alloc)
  FROM public.reservation_nights_by_month n
  WHERE n.tenant_id = p_tenant_id
    AND (p_property IS NULL OR cardinality(p_property) = 0 OR n.property_name = ANY(p_property))
    AND (p_month IS NULL OR cardinality(p_month) = 0 OR n.ref_month = ANY(p_month))
    AND (v_allowed IS NULL OR n.property_name = ANY(v_allowed))
  GROUP BY n.sales_channel, n.ref_year
  ORDER BY n.sales_channel, n.ref_year;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_drilldown_multiyear_competencia(p_tenant_id uuid, p_channel text, p_property text[] DEFAULT NULL, p_month integer[] DEFAULT NULL)
RETURNS TABLE(item_name text, departure_year integer, revenue numeric, roomnights numeric, room_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  IF NOT (public.is_super_admin(auth.uid()) OR public.get_current_tenant_id() = p_tenant_id) THEN RETURN; END IF;
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT
    CASE WHEN p_channel IN ('Empresas','Layover','Grupos')
         THEN COALESCE(NULLIF(n.company_name,''), n.travel_agent_name, 'Sem nome')
         ELSE COALESCE(NULLIF(n.travel_agent_name,''), n.company_name, 'Sem nome') END AS nm,
    n.ref_year, SUM(n.total_revenue_alloc), SUM(n.nights_in_month), SUM(n.room_revenue_alloc)
  FROM public.reservation_nights_by_month n
  WHERE n.tenant_id = p_tenant_id AND n.sales_channel = p_channel
    AND (p_property IS NULL OR cardinality(p_property) = 0 OR n.property_name = ANY(p_property))
    AND (p_month IS NULL OR cardinality(p_month) = 0 OR n.ref_month = ANY(p_month))
    AND (v_allowed IS NULL OR n.property_name = ANY(v_allowed))
  GROUP BY nm, n.ref_year
  ORDER BY nm, n.ref_year;
END;
$$;
REVOKE ALL ON FUNCTION public.get_channel_multiyear_competencia(uuid, text[], integer[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_channel_drilldown_multiyear_competencia(uuid, text, text[], integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_channel_multiyear_competencia(uuid, text[], integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_channel_drilldown_multiyear_competencia(uuid, text, text[], integer[]) TO authenticated;