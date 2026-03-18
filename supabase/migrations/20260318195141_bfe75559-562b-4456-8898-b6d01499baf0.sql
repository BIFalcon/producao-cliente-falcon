
DROP FUNCTION IF EXISTS public.get_dashboard_kpis(text, integer, text);
DROP FUNCTION IF EXISTS public.get_channel_drilldown(text, text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_company_table(text, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_agent_comparison(text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_agent_companies(text, text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_all_users();

CREATE OR REPLACE FUNCTION public.get_allowed_properties(p_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  is_admin boolean;
  props text[];
BEGIN
  SELECT public.has_role(p_user_id, 'master_admin') INTO is_admin;
  IF is_admin THEN RETURN NULL; END IF;
  SELECT ARRAY_AGG(uhp.property_name) INTO props
  FROM public.user_hotel_permissions uhp WHERE uhp.user_id = p_user_id;
  RETURN COALESCE(props, ARRAY[]::text[]);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_reservations(p_batch_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '120s'
AS $$
BEGIN
  CREATE TEMP TABLE tmp_valid_rows ON COMMIT DROP AS
  SELECT
    r.confirmation_number,
    r.property_name,
    COALESCE(r.room_revenue, 0) AS room_revenue,
    COALESCE(r.fb_revenue, 0) AS fb_revenue,
    COALESCE(r.total_revenue, 0) AS total_revenue,
    CASE WHEN COALESCE(r.number_of_nights, 0) = 0 THEN 1 ELSE r.number_of_nights END AS number_of_nights,
    NULLIF(BTRIM(r.country), '') AS country,
    NULLIF(BTRIM(r.state), '') AS state,
    NULLIF(BTRIM(r.city), '') AS city,
    r.reservation_date,
    r.arrival_date,
    r.departure_date,
    NULLIF(BTRIM(r.company_name), '') AS company_name,
    NULLIF(BTRIM(r.travel_agent_name), '') AS travel_agent_name,
    NULLIF(BTRIM(r.source_name), '') AS source_name,
    LOWER(COALESCE(BTRIM(r.room_type), '')) AS room_type_normalized,
    LOWER(COALESCE(BTRIM(r.rate_code_description), '')) AS rate_code_desc_normalized
  FROM public.raw_reservations r
  WHERE r.confirmation_number IS NOT NULL
    AND r.property_name IS NOT NULL
    AND COALESCE(r.reservation_status, '') IN ('checked out', 'checked in', 'no show');

  CREATE TEMP TABLE tmp_reservation_totals ON COMMIT DROP AS
  SELECT
    v.confirmation_number, v.property_name,
    SUM(v.room_revenue) AS room_revenue,
    SUM(v.fb_revenue) AS fb_revenue,
    SUM(v.total_revenue) AS total_revenue,
    AVG(v.number_of_nights) AS roomnights,
    MAX(v.country) AS country, MAX(v.state) AS state, MAX(v.city) AS city,
    MIN(v.reservation_date) AS reservation_date,
    MIN(v.arrival_date) AS arrival_date,
    MAX(v.departure_date) AS departure_date,
    EXTRACT(MONTH FROM MAX(v.departure_date))::int AS departure_month,
    EXTRACT(YEAR FROM MAX(v.departure_date))::int AS departure_year,
    CASE WHEN MIN(v.reservation_date) IS NOT NULL AND MIN(v.arrival_date) IS NOT NULL
      THEN (MIN(v.arrival_date) - MIN(v.reservation_date)) ELSE NULL END AS lead_time_days
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  CREATE TEMP TABLE tmp_operational_signals ON COMMIT DROP AS
  SELECT
    o.confirmation_number, o.property_name,
    MAX(o.company_name) AS agg_company,
    MAX(o.travel_agent_name) AS agg_agent,
    BOOL_OR(o.has_ota) AS has_ota,
    BOOL_OR(o.has_operadora) AS has_operadora,
    BOOL_OR(o.has_layover) AS has_layover,
    BOOL_OR(o.has_agent) AS has_agent,
    BOOL_OR(o.has_company) AS has_company,
    BOOL_OR(o.has_source) AS has_source,
    BOOL_OR(o.has_group) AS has_group,
    TRUE AS has_operational_room
  FROM (
    SELECT
      v.confirmation_number, v.property_name, v.company_name, v.travel_agent_name, v.source_name,
      (POSITION('booking' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('expedia' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('decolar' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0) AS has_ota,
      (POSITION('trend' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('cvc' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('latam.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('gol.linhas' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('abreu' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('flytour' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('idt.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('affinity' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('oca.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('tour.house' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('schultz' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('orinter' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('visual.turismo' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('luck.viagens' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('viagens.promo' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('sakura' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('lucky.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('shift.travel' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('tam.viagens' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('newit.turismo' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 OR
       POSITION('klas.turismo' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0) AS has_operadora,
      (POSITION('azul linhas aereas' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) > 0 AND
       POSITION('azul viagens' IN LOWER(CONCAT_WS(' ', v.company_name, v.travel_agent_name, v.source_name))) = 0) AS has_layover,
      v.travel_agent_name IS NOT NULL AS has_agent,
      v.company_name IS NOT NULL AS has_company,
      v.source_name IS NOT NULL AS has_source,
      (POSITION('grupo' IN v.rate_code_desc_normalized) > 0) AS has_group
    FROM tmp_valid_rows v
    WHERE v.room_type_normalized NOT IN ('pm', 'pf')
  ) o
  GROUP BY o.confirmation_number, o.property_name;

  DELETE FROM public.processed_reservations WHERE true;

  INSERT INTO public.processed_reservations (
    confirmation_number, property_name, company_name, travel_agent_name,
    sales_channel, room_revenue, fb_revenue, total_revenue, roomnights,
    country, state, city, reservation_date, arrival_date, departure_date,
    departure_month, departure_year, lead_time_days
  )
  SELECT
    t.confirmation_number, t.property_name, s.agg_company, s.agg_agent,
    CASE
      WHEN COALESCE(s.has_ota, false) THEN 'OTA'
      WHEN COALESCE(s.has_operadora, false) THEN 'Operadoras'
      WHEN COALESCE(s.has_layover, false) THEN 'Layover'
      WHEN COALESCE(s.has_agent, false) THEN 'Outras Agências'
      WHEN COALESCE(s.has_company, false) THEN 'Empresas'
      WHEN COALESCE(s.has_group, false) THEN 'Grupos'
      WHEN COALESCE(s.has_source, false) THEN 'Outros'
      WHEN COALESCE(s.has_operational_room, false) THEN 'Particular'
      ELSE 'Outras Receitas (PM e PF)'
    END,
    t.room_revenue, t.fb_revenue, t.total_revenue, t.roomnights,
    t.country, t.state, t.city, t.reservation_date, t.arrival_date,
    t.departure_date, t.departure_month, t.departure_year, t.lead_time_days
  FROM tmp_reservation_totals t
  LEFT JOIN tmp_operational_signals s
    ON s.confirmation_number = t.confirmation_number AND s.property_name = t.property_name;

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.upload_batches
    SET status = 'completed', completed_at = NOW(),
        processed_rows = (SELECT COUNT(*) FROM public.processed_reservations)
    WHERE id = p_batch_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_filter_options()
RETURNS TABLE(properties text[], years integer[], channels text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT
    ARRAY(SELECT DISTINCT pr.property_name FROM public.processed_reservations pr
          WHERE (v_allowed IS NULL OR pr.property_name = ANY(v_allowed)) ORDER BY pr.property_name),
    ARRAY(SELECT DISTINCT pr.departure_year FROM public.processed_reservations pr
          WHERE (v_allowed IS NULL OR pr.property_name = ANY(v_allowed)) ORDER BY pr.departure_year DESC),
    ARRAY(SELECT DISTINCT pr.sales_channel FROM public.processed_reservations pr
          WHERE (v_allowed IS NULL OR pr.property_name = ANY(v_allowed)) ORDER BY pr.sales_channel);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(total_revenue numeric, total_reservations bigint, avg_lead_time numeric, total_roomnights numeric, adr numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT SUM(pr.total_revenue), COUNT(*)::BIGINT, AVG(pr.lead_time_days)::NUMERIC,
    SUM(pr.roomnights)::NUMERIC,
    CASE WHEN SUM(pr.roomnights) > 0 THEN ROUND(SUM(pr.room_revenue) / SUM(pr.roomnights), 2) ELSE 0 END
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_multiyear(
  p_property text DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(sales_channel text, departure_year integer, revenue numeric, roomnights numeric, room_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT pr.sales_channel, pr.departure_year, SUM(pr.total_revenue), SUM(pr.roomnights), SUM(pr.room_revenue)
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.sales_channel, pr.departure_year
  ORDER BY pr.sales_channel, pr.departure_year;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_comparison(
  p_property text DEFAULT NULL, p_current_year integer DEFAULT NULL,
  p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(sales_channel text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT pr.sales_channel AS ch, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.sales_channel
  ),
  prev AS (
    SELECT pr.sales_channel AS ch, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.sales_channel
  )
  SELECT COALESCE(c.ch, p.ch), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.ch = p.ch
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_drilldown(
  p_channel text, p_property text DEFAULT NULL, p_current_year integer DEFAULT NULL,
  p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(item_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT
      CASE WHEN p_channel IN ('OTA','Operadoras','Empresas','Layover','Grupos')
           THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
           ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
      END AS nm,
      SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev
    FROM processed_reservations pr
    WHERE pr.sales_channel = p_channel
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY nm
  ),
  prev AS (
    SELECT
      CASE WHEN p_channel IN ('OTA','Operadoras','Empresas','Layover','Grupos')
           THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
           ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
      END AS nm,
      SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.sales_channel = p_channel
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY nm
  )
  SELECT COALESCE(c.nm, p.nm), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    COALESCE(c.rn, 0),
    CASE WHEN COALESCE(c.rn, 0) > 0 THEN ROUND(COALESCE(c.room_rev, 0) / c.rn, 2) ELSE 0 END
  FROM cur c FULL OUTER JOIN prev p ON c.nm = p.nm
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_table(
  p_property text DEFAULT NULL, p_current_year integer DEFAULT NULL,
  p_previous_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, revenue_share numeric, roomnights_current numeric, room_revenue_current numeric, adr_current numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH current_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev,
           SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  previous_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  total AS (SELECT SUM(rev) AS t FROM current_yr)
  SELECT COALESCE(c.cn, p.cn), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    CASE WHEN t.t > 0 THEN ROUND(COALESCE(c.rev, 0) / t.t * 100, 2) ELSE 0 END,
    COALESCE(c.rn, 0), COALESCE(c.room_rev, 0),
    CASE WHEN COALESCE(c.rn, 0) > 0 THEN ROUND(COALESCE(c.room_rev, 0) / c.rn, 2) ELSE 0 END
  FROM current_yr c FULL OUTER JOIN previous_yr p ON c.cn = p.cn
  CROSS JOIN total t
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_comparison(
  p_property text DEFAULT NULL, p_current_year integer DEFAULT NULL,
  p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(travel_agent_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev,
           SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev
    FROM processed_reservations pr
    WHERE pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.travel_agent_name
  ),
  prev AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.travel_agent_name
  )
  SELECT COALESCE(c.ag, p.ag), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    COALESCE(c.rn, 0),
    CASE WHEN COALESCE(c.rn, 0) > 0 THEN ROUND(COALESCE(c.room_rev, 0) / c.rn, 2) ELSE 0 END
  FROM cur c FULL OUTER JOIN prev p ON c.ag = p.ag
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_companies(
  p_agent text, p_property text DEFAULT NULL, p_current_year integer DEFAULT NULL,
  p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev,
           SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev
    FROM processed_reservations pr
    WHERE pr.travel_agent_name = p_agent
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  prev AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.travel_agent_name = p_agent
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  )
  SELECT COALESCE(c.co, p.co), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    COALESCE(c.rn, 0),
    CASE WHEN COALESCE(c.rn, 0) > 0 THEN ROUND(COALESCE(c.room_rev, 0) / c.rn, 2) ELSE 0 END
  FROM cur c FULL OUTER JOIN prev p ON c.co = p.co
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_revenue(
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(month integer, year integer, revenue numeric, reservations bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT pr.departure_month, pr.departure_year, SUM(pr.total_revenue), COUNT(*)::BIGINT
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.departure_month, pr.departure_year
  ORDER BY pr.departure_year, pr.departure_month;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_analytics(
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL
)
RETURNS TABLE(sales_channel text, revenue numeric, reservations bigint, share_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH totals AS (
    SELECT SUM(pr.total_revenue) AS total FROM public.processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  )
  SELECT pr.sales_channel, SUM(pr.total_revenue), COUNT(*)::BIGINT,
    CASE WHEN t.total > 0 THEN ROUND(SUM(pr.total_revenue) / t.total * 100, 2) ELSE 0 END
  FROM public.processed_reservations pr CROSS JOIN totals t
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.sales_channel, t.total
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_concentration_metrics(
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(top1_share numeric, top3_share numeric, top5_share numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH ranked AS (
    SELECT pr.company_name, SUM(pr.total_revenue) AS rev,
      ROW_NUMBER() OVER (ORDER BY SUM(pr.total_revenue) DESC) AS rn
    FROM public.processed_reservations pr
    WHERE pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  total AS (SELECT SUM(rev) AS t FROM ranked)
  SELECT
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 1 THEN r.rev END), 0) / NULLIF(MAX(t.t), 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 3 THEN r.rev END), 0) / NULLIF(MAX(t.t), 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 5 THEN r.rev END), 0) / NULLIF(MAX(t.t), 0) * 100, 2)
  FROM ranked r CROSS JOIN total t;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_guest_city_analytics(
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(city text, state text, revenue numeric, reservations bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT pr.city, pr.state, SUM(pr.total_revenue), COUNT(*)::BIGINT
  FROM processed_reservations pr
  WHERE pr.city IS NOT NULL AND pr.city != ''
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.city, pr.state
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_city_analytics(
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(city text, state text, company_count bigint, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT pr.city, pr.state, COUNT(DISTINCT pr.company_name), SUM(pr.total_revenue)
  FROM processed_reservations pr
  WHERE pr.city IS NOT NULL AND pr.city != ''
    AND pr.company_name IS NOT NULL AND pr.company_name != ''
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.city, pr.state
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_city_drilldown(
  p_city text, p_state text DEFAULT NULL, p_property text DEFAULT NULL,
  p_year integer DEFAULT NULL, p_month integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(company_name text, revenue numeric, reservations bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT pr.company_name, SUM(pr.total_revenue), COUNT(*)::BIGINT
  FROM processed_reservations pr
  WHERE pr.city = p_city
    AND pr.company_name IS NOT NULL AND pr.company_name != ''
    AND (p_state IS NULL OR pr.state = p_state)
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.company_name
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_city_analytics(
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(city text, state text, company_count bigint, revenue numeric, reservations bigint, top_companies text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH city_data AS (
    SELECT pr.city AS c, pr.state AS s, COUNT(DISTINCT pr.company_name) AS cc,
      SUM(pr.total_revenue) AS rev, COUNT(*) AS res
    FROM public.processed_reservations pr
    WHERE pr.city IS NOT NULL AND pr.city != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.city, pr.state
  ),
  top_co AS (
    SELECT pr.city AS c, pr.state AS s,
      ARRAY_AGG(DISTINCT pr.company_name ORDER BY pr.company_name) FILTER (WHERE pr.company_name IS NOT NULL AND pr.company_name != '') AS companies
    FROM public.processed_reservations pr
    WHERE pr.city IS NOT NULL AND pr.city != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.city, pr.state
  )
  SELECT cd.c, cd.s, cd.cc, cd.rev, cd.res, COALESCE(tc.companies[1:5], ARRAY[]::TEXT[])
  FROM city_data cd LEFT JOIN top_co tc ON cd.c = tc.c AND cd.s = tc.s
  ORDER BY cd.rev DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_breakdown(
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL
)
RETURNS TABLE(travel_agent_name text, revenue numeric, reservations bigint, companies text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  SELECT pr.travel_agent_name, SUM(pr.total_revenue), COUNT(*)::BIGINT,
    ARRAY_AGG(DISTINCT pr.company_name) FILTER (WHERE pr.company_name IS NOT NULL AND pr.company_name != '')
  FROM public.processed_reservations pr
  WHERE pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.travel_agent_name
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS TABLE(user_id uuid, email text, full_name text, role text, is_active boolean, created_at timestamptz, hotel_permissions text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'master_admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, COALESCE(p.full_name, ''), COALESCE(ur.role::text, 'viewer'),
    COALESCE(p.is_active, true), u.created_at,
    COALESCE(
      (SELECT ARRAY_AGG(uhp.property_name) FROM public.user_hotel_permissions uhp WHERE uhp.user_id = u.id),
      ARRAY[]::text[]
    )
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  ORDER BY u.created_at;
END;
$$;
