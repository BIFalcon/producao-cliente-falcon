-- =========================================================
-- PHASE 2: Add p_tenant_id to all RPCs
-- =========================================================

-- Drop existing functions to allow signature changes
DROP FUNCTION IF EXISTS public.get_allowed_properties(uuid);
DROP FUNCTION IF EXISTS public.get_dashboard_kpis(text, integer, text);
DROP FUNCTION IF EXISTS public.get_dashboard_kpis(text, integer, text, integer);
DROP FUNCTION IF EXISTS public.get_filter_options();
DROP FUNCTION IF EXISTS public.get_channel_analytics(text, integer);
DROP FUNCTION IF EXISTS public.get_channel_comparison(text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_channel_multiyear(text, integer);
DROP FUNCTION IF EXISTS public.get_channel_drilldown(text, text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_channel_drilldown_multiyear(text, text, integer);
DROP FUNCTION IF EXISTS public.get_company_table(text, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_agent_breakdown(text, integer);
DROP FUNCTION IF EXISTS public.get_agent_comparison(text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_agent_companies(text, text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_guest_city_analytics(text, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_guest_city_drilldown(text, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_company_city_analytics(text, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_company_city_drilldown(text, text, text, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_city_analytics(text, integer, text);
DROP FUNCTION IF EXISTS public.get_concentration_metrics(text, integer, text);
DROP FUNCTION IF EXISTS public.get_monthly_revenue(text, integer, text);
DROP FUNCTION IF EXISTS public.get_all_users();
DROP FUNCTION IF EXISTS public.process_reservations(uuid);
DROP FUNCTION IF EXISTS public.get_particular_debug(text, integer, integer);

-- =========================================================
-- get_allowed_properties (per tenant)
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_allowed_properties(p_user_id uuid, p_tenant_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE is_admin boolean; props text[];
BEGIN
  SELECT public.has_role_in_tenant(p_user_id, 'master_admin', p_tenant_id) INTO is_admin;
  IF is_admin THEN RETURN NULL; END IF;
  SELECT ARRAY_AGG(uhp.property_name) INTO props
  FROM public.user_hotel_permissions uhp
  WHERE uhp.user_id = p_user_id AND uhp.tenant_id = p_tenant_id;
  RETURN COALESCE(props, ARRAY[]::text[]);
END;
$$;

-- =========================================================
-- get_dashboard_kpis
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(
  p_tenant_id uuid,
  p_property text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_month integer DEFAULT NULL
)
RETURNS TABLE(total_revenue numeric, total_reservations bigint, avg_lead_time numeric, total_roomnights numeric, adr numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT SUM(pr.total_revenue), COUNT(*)::BIGINT, AVG(pr.lead_time_days)::NUMERIC, SUM(pr.roomnights)::NUMERIC, NULL::NUMERIC
  FROM public.processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed));
END;
$$;

-- =========================================================
-- get_filter_options
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_filter_options(p_tenant_id uuid)
RETURNS TABLE(properties text[], years integer[], channels text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT
    ARRAY(SELECT DISTINCT pr.property_name FROM public.processed_reservations pr
          WHERE pr.tenant_id = p_tenant_id AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed)) ORDER BY pr.property_name),
    ARRAY(SELECT DISTINCT pr.departure_year FROM public.processed_reservations pr
          WHERE pr.tenant_id = p_tenant_id AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed)) ORDER BY pr.departure_year DESC),
    ARRAY(SELECT DISTINCT pr.sales_channel FROM public.processed_reservations pr
          WHERE pr.tenant_id = p_tenant_id AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed)) ORDER BY pr.sales_channel);
END;
$$;

-- =========================================================
-- get_channel_analytics
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_channel_analytics(
  p_tenant_id uuid, p_property text DEFAULT NULL, p_year integer DEFAULT NULL
)
RETURNS TABLE(sales_channel text, revenue numeric, reservations bigint, share_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH totals AS (
    SELECT SUM(pr.total_revenue) AS total FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  )
  SELECT pr.sales_channel, SUM(pr.total_revenue), COUNT(*)::BIGINT,
    CASE WHEN t.total > 0 THEN ROUND(SUM(pr.total_revenue) / t.total * 100, 2) ELSE 0 END
  FROM public.processed_reservations pr CROSS JOIN totals t
  WHERE pr.tenant_id = p_tenant_id
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.sales_channel, t.total
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

-- =========================================================
-- get_channel_comparison
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_channel_comparison(
  p_tenant_id uuid, p_property text DEFAULT NULL,
  p_current_year integer DEFAULT NULL, p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(sales_channel text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH cur AS (
    SELECT pr.sales_channel AS ch, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.sales_channel
  ),
  prev AS (
    SELECT pr.sales_channel AS ch, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND (p_property IS NULL OR pr.property_name = p_property)
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

-- =========================================================
-- get_channel_multiyear
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_channel_multiyear(
  p_tenant_id uuid, p_property text DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(sales_channel text, departure_year integer, revenue numeric, roomnights numeric, room_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT pr.sales_channel, pr.departure_year, SUM(pr.total_revenue), SUM(pr.roomnights), SUM(pr.room_revenue)
  FROM public.processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.sales_channel, pr.departure_year
  ORDER BY pr.sales_channel, pr.departure_year;
END;
$$;

-- =========================================================
-- get_channel_drilldown
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_channel_drilldown(
  p_tenant_id uuid, p_channel text,
  p_property text DEFAULT NULL,
  p_current_year integer DEFAULT NULL, p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(item_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH cur AS (
    SELECT
      CASE WHEN p_channel IN ('Empresas','Layover','Grupos')
           THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
           ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
      END AS nm,
      SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
      SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
      SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id AND pr.sales_channel = p_channel
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY nm
  ),
  prev AS (
    SELECT
      CASE WHEN p_channel IN ('Empresas','Layover','Grupos')
           THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
           ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
      END AS nm,
      SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id AND pr.sales_channel = p_channel
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
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.nm = p.nm
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- =========================================================
-- get_channel_drilldown_multiyear
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_channel_drilldown_multiyear(
  p_tenant_id uuid, p_channel text, p_property text DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(item_name text, departure_year integer, revenue numeric, roomnights numeric, room_revenue numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT
    CASE WHEN p_channel IN ('Empresas','Layover','Grupos')
         THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
         ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
    END AS nm,
    pr.departure_year, SUM(pr.total_revenue), SUM(pr.roomnights), SUM(pr.room_revenue)
  FROM public.processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id AND pr.sales_channel = p_channel
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY nm, pr.departure_year
  ORDER BY nm, pr.departure_year;
END;
$$;

-- =========================================================
-- get_company_table
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_company_table(
  p_tenant_id uuid, p_property text DEFAULT NULL,
  p_current_year integer DEFAULT NULL, p_previous_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, revenue_share numeric, roomnights_current numeric, room_revenue_current numeric, adr_current numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH current_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  previous_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  grand_total AS (
    SELECT SUM(pr.total_revenue) AS t
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  )
  SELECT COALESCE(c.cn, p.cn), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END,
    CASE WHEN gt.t > 0 THEN ROUND(COALESCE(c.rev, 0) / gt.t * 100, 2) ELSE 0 END,
    COALESCE(c.rn, 0), COALESCE(c.room_rev, 0),
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM current_yr c FULL OUTER JOIN previous_yr p ON c.cn = p.cn
  CROSS JOIN grand_total gt
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- =========================================================
-- get_agent_breakdown
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_agent_breakdown(
  p_tenant_id uuid, p_property text DEFAULT NULL, p_year integer DEFAULT NULL
)
RETURNS TABLE(travel_agent_name text, revenue numeric, reservations bigint, companies text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT pr.travel_agent_name, SUM(pr.total_revenue), COUNT(*)::BIGINT,
    ARRAY_AGG(DISTINCT pr.company_name) FILTER (WHERE pr.company_name IS NOT NULL AND pr.company_name != '')
  FROM public.processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id
    AND pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.travel_agent_name
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

-- =========================================================
-- get_agent_comparison
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_agent_comparison(
  p_tenant_id uuid, p_property text DEFAULT NULL,
  p_current_year integer DEFAULT NULL, p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(travel_agent_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH cur AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.travel_agent_name
  ),
  prev AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
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
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.ag = p.ag
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- =========================================================
-- get_agent_companies
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_agent_companies(
  p_tenant_id uuid, p_agent text, p_property text DEFAULT NULL,
  p_current_year integer DEFAULT NULL, p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL
)
RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH cur AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
    FROM processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id AND pr.travel_agent_name = p_agent
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
    WHERE pr.tenant_id = p_tenant_id AND pr.travel_agent_name = p_agent
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
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.co = p.co
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- =========================================================
-- get_guest_city_analytics
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_guest_city_analytics(
  p_tenant_id uuid, p_property text DEFAULT NULL, p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(city text, state text, revenue numeric, reservations bigint, roomnights numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT pr.city, pr.state, SUM(pr.total_revenue), COUNT(*)::BIGINT, SUM(pr.roomnights)
  FROM processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id
    AND pr.city IS NOT NULL AND pr.city != ''
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.city, pr.state
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

-- =========================================================
-- get_guest_city_drilldown
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_guest_city_drilldown(
  p_tenant_id uuid, p_city text, p_state text DEFAULT NULL,
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(entity_name text, entity_type text, revenue numeric, roomnights numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT
    COALESCE(NULLIF(pr.company_name,''), NULLIF(pr.travel_agent_name,''), 'Sem nome') AS ent_name,
    pr.sales_channel AS ent_type, SUM(pr.total_revenue), SUM(pr.roomnights)
  FROM processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id AND pr.city = p_city
    AND (p_state IS NULL OR pr.state = p_state)
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY ent_name, pr.sales_channel
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

-- =========================================================
-- get_company_city_analytics
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_company_city_analytics(
  p_tenant_id uuid, p_property text DEFAULT NULL, p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(city text, state text, company_count bigint, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT pr.city, pr.state, COUNT(DISTINCT pr.company_name), SUM(pr.total_revenue)
  FROM processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id
    AND pr.city IS NOT NULL AND pr.city != ''
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

-- =========================================================
-- get_company_city_drilldown
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_company_city_drilldown(
  p_tenant_id uuid, p_city text, p_state text DEFAULT NULL,
  p_property text DEFAULT NULL, p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(company_name text, revenue numeric, reservations bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT pr.company_name, SUM(pr.total_revenue), COUNT(*)::BIGINT
  FROM processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id AND pr.city = p_city
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

-- =========================================================
-- get_city_analytics
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_city_analytics(
  p_tenant_id uuid, p_property text DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(city text, state text, company_count bigint, revenue numeric, reservations bigint, top_companies text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH city_data AS (
    SELECT pr.city AS c, pr.state AS s, COUNT(DISTINCT pr.company_name) AS cc,
      SUM(pr.total_revenue) AS rev, COUNT(*) AS res
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.city IS NOT NULL AND pr.city != ''
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
    WHERE pr.tenant_id = p_tenant_id
      AND pr.city IS NOT NULL AND pr.city != ''
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

-- =========================================================
-- get_concentration_metrics
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_concentration_metrics(
  p_tenant_id uuid, p_property text DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(top1_share numeric, top3_share numeric, top5_share numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  WITH ranked AS (
    SELECT pr.company_name, SUM(pr.total_revenue) AS rev,
      ROW_NUMBER() OVER (ORDER BY SUM(pr.total_revenue) DESC) AS rn
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    GROUP BY pr.company_name
  ),
  grand_total AS (
    SELECT SUM(pr.total_revenue) AS t
    FROM public.processed_reservations pr
    WHERE pr.tenant_id = p_tenant_id
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  )
  SELECT
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 1 THEN r.rev END), 0) / NULLIF(MAX(gt.t), 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 3 THEN r.rev END), 0) / NULLIF(MAX(gt.t), 0) * 100, 2),
    ROUND(COALESCE(SUM(CASE WHEN r.rn <= 5 THEN r.rev END), 0) / NULLIF(MAX(gt.t), 0) * 100, 2)
  FROM ranked r CROSS JOIN grand_total gt;
END;
$$;

-- =========================================================
-- get_monthly_revenue
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_monthly_revenue(
  p_tenant_id uuid, p_property text DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL
)
RETURNS TABLE(month integer, year integer, revenue numeric, reservations bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid(), p_tenant_id);
  RETURN QUERY
  SELECT pr.departure_month, pr.departure_year, SUM(pr.total_revenue), COUNT(*)::BIGINT
  FROM public.processed_reservations pr
  WHERE pr.tenant_id = p_tenant_id
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  GROUP BY pr.departure_month, pr.departure_year
  ORDER BY pr.departure_year, pr.departure_month;
END;
$$;

-- =========================================================
-- get_all_users (per tenant)
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_all_users(p_tenant_id uuid)
RETURNS TABLE(user_id uuid, email text, full_name text, role text, is_active boolean, created_at timestamp with time zone, hotel_permissions text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role_in_tenant(auth.uid(), 'master_admin', p_tenant_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, COALESCE(p.full_name, ''), COALESCE(ur.role::text, 'viewer'),
    COALESCE(p.is_active, true), u.created_at,
    COALESCE(
      (SELECT ARRAY_AGG(uhp.property_name) FROM public.user_hotel_permissions uhp
       WHERE uhp.user_id = u.id AND uhp.tenant_id = p_tenant_id),
      ARRAY[]::text[]
    )
  FROM auth.users u
  INNER JOIN public.profiles p ON p.user_id = u.id AND p.tenant_id = p_tenant_id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id AND ur.tenant_id = p_tenant_id
  ORDER BY u.created_at;
END;
$$;

-- =========================================================
-- process_reservations (per tenant)
-- =========================================================
CREATE OR REPLACE FUNCTION public.process_reservations(p_tenant_id uuid, p_batch_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '300s'
AS $$
BEGIN
  CREATE TEMP TABLE tmp_valid_rows ON COMMIT DROP AS
  SELECT
    r.confirmation_number, r.property_name,
    COALESCE(r.room_revenue, 0) AS room_revenue,
    COALESCE(r.fb_revenue, 0) AS fb_revenue,
    COALESCE(r.total_revenue, 0) AS total_revenue,
    CASE WHEN COALESCE(r.number_of_nights, 0) = 0 THEN 1 ELSE r.number_of_nights END AS number_of_nights,
    NULLIF(BTRIM(r.country), '') AS country,
    NULLIF(BTRIM(r.state), '') AS state,
    NULLIF(BTRIM(r.city), '') AS city,
    r.reservation_date, r.arrival_date, r.departure_date,
    NULLIF(BTRIM(r.company_name), '') AS company_name,
    NULLIF(BTRIM(r.travel_agent_name), '') AS travel_agent_name,
    NULLIF(BTRIM(r.source_name), '') AS source_name,
    NULLIF(BTRIM(r.individual_first_name), '') AS individual_first_name,
    LOWER(COALESCE(BTRIM(r.room_type), '')) AS room_type_normalized,
    LOWER(extensions.unaccent(COALESCE(BTRIM(r.rate_code_description), ''))) AS rate_code_desc_normalized,
    LOWER(extensions.unaccent(
      COALESCE(BTRIM(r.company_name), '') || ' ' ||
      COALESCE(BTRIM(r.travel_agent_name), '') || ' ' ||
      COALESCE(BTRIM(r.source_name), '') || ' ' ||
      COALESCE(BTRIM(r.individual_first_name), '')
    )) AS combined_text
  FROM public.raw_reservations r
  WHERE r.tenant_id = p_tenant_id
    AND r.confirmation_number IS NOT NULL
    AND r.property_name IS NOT NULL
    AND LOWER(COALESCE(r.reservation_status, '')) IN ('checked out', 'checked in', 'no show');

  CREATE INDEX idx_tmp_valid_cn_pn ON tmp_valid_rows (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_reservation_totals ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    SUM(v.room_revenue) AS room_revenue, SUM(v.fb_revenue) AS fb_revenue,
    SUM(v.total_revenue) AS total_revenue, AVG(v.number_of_nights) AS roomnights,
    MAX(v.country) AS country, MAX(v.state) AS state, MAX(v.city) AS city,
    MIN(v.reservation_date) AS reservation_date, MIN(v.arrival_date) AS arrival_date,
    MAX(v.departure_date) AS departure_date,
    EXTRACT(MONTH FROM MAX(v.departure_date))::int AS departure_month,
    EXTRACT(YEAR FROM MAX(v.departure_date))::int AS departure_year,
    CASE WHEN MIN(v.reservation_date) IS NOT NULL AND MIN(v.arrival_date) IS NOT NULL
      THEN (MIN(v.arrival_date) - MIN(v.reservation_date)) ELSE NULL END AS lead_time_days
  FROM tmp_valid_rows v
  GROUP BY v.confirmation_number, v.property_name;

  CREATE INDEX idx_tmp_totals_cn_pn ON tmp_reservation_totals (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_group_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(v.rate_code_desc_normalized ~ 'grupo') AS has_group
  FROM tmp_valid_rows v GROUP BY v.confirmation_number, v.property_name;
  CREATE INDEX idx_tmp_group_cn_pn ON tmp_group_flags (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_channel_mapping ON COMMIT DROP AS
  SELECT
    LOWER(extensions.unaccent(BTRIM(cm.canal))) AS canal_normalized,
    CASE UPPER(BTRIM(cm.segmento))
      WHEN 'AGENCIA' THEN 'Outras agências' WHEN 'OPERADORA' THEN 'Operadoras'
      WHEN 'EMPRESAS' THEN 'Empresas' WHEN 'GRUPOS' THEN 'Grupos'
      WHEN 'LAYOVER' THEN 'Layover' WHEN 'PARTICULAR' THEN 'Particular'
      ELSE 'Outras receitas (PM e PF)'
    END AS segmento_standard,
    CASE UPPER(BTRIM(cm.segmento))
      WHEN 'OPERADORA' THEN 2 WHEN 'LAYOVER' THEN 3 WHEN 'AGENCIA' THEN 6
      WHEN 'EMPRESAS' THEN 7 WHEN 'GRUPOS' THEN 5 WHEN 'PARTICULAR' THEN 9 ELSE 10
    END AS priority
  FROM public.channel_mapping cm
  WHERE cm.tenant_id = p_tenant_id AND UPPER(BTRIM(cm.segmento)) <> 'OTA';

  UPDATE tmp_channel_mapping
  SET segmento_standard = 'Clube de férias', priority = 4
  WHERE segmento_standard = 'Outras receitas (PM e PF)'
    AND EXISTS (
      SELECT 1 FROM public.channel_mapping cm2
      WHERE cm2.tenant_id = p_tenant_id
        AND LOWER(extensions.unaccent(BTRIM(cm2.canal))) = tmp_channel_mapping.canal_normalized
        AND UPPER(BTRIM(cm2.segmento)) IN ('CLUBE DE FÉRIAS', 'CLUBE DE FERIAS')
    );

  CREATE TEMP TABLE tmp_row_matches ON COMMIT DROP AS
  SELECT DISTINCT ON (v.confirmation_number, v.property_name, m.canal_normalized)
    v.confirmation_number, v.property_name, v.company_name, v.travel_agent_name, v.source_name,
    m.segmento_standard, m.priority AS mapping_priority,
    v.travel_agent_name IS NOT NULL AS has_agent,
    v.company_name IS NOT NULL AS has_company,
    v.source_name IS NOT NULL AS has_source
  FROM tmp_valid_rows v
  INNER JOIN tmp_channel_mapping m ON POSITION(m.canal_normalized IN v.combined_text) > 0;

  CREATE TEMP TABLE tmp_best_mapping ON COMMIT DROP AS
  SELECT DISTINCT ON (confirmation_number, property_name)
    confirmation_number, property_name, segmento_standard, mapping_priority
  FROM tmp_row_matches
  ORDER BY confirmation_number, property_name, mapping_priority;

  CREATE TEMP TABLE tmp_operational_signals ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    MAX(v.company_name) AS agg_company, MAX(v.travel_agent_name) AS agg_agent,
    BOOL_OR(v.travel_agent_name IS NOT NULL) AS has_agent,
    BOOL_OR(v.company_name IS NOT NULL) AS has_company,
    BOOL_OR(v.source_name IS NOT NULL) AS has_source,
    TRUE AS has_operational_room
  FROM tmp_valid_rows v
  WHERE v.room_type_normalized NOT IN ('pm', 'pf', 'pz')
  GROUP BY v.confirmation_number, v.property_name;
  CREATE INDEX idx_tmp_ops_cn_pn ON tmp_operational_signals (confirmation_number, property_name);

  CREATE TEMP TABLE tmp_ota_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(POSITION('booking' IN v.combined_text) > 0
         OR POSITION('expedia' IN v.combined_text) > 0
         OR POSITION('decolar' IN v.combined_text) > 0) AS is_ota
  FROM tmp_valid_rows v GROUP BY v.confirmation_number, v.property_name;

  CREATE TEMP TABLE tmp_layover_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(
      (POSITION('azul linhas aereas' IN v.combined_text) > 0
       OR POSITION('azul linhas global master' IN v.combined_text) > 0)
      AND POSITION('azul viagens' IN v.combined_text) = 0
    ) OR BOOL_OR(POSITION('layover' IN v.combined_text) > 0) AS is_layover
  FROM tmp_valid_rows v GROUP BY v.confirmation_number, v.property_name;

  CREATE TEMP TABLE tmp_operadora_flags ON COMMIT DROP AS
  SELECT v.confirmation_number, v.property_name,
    BOOL_OR(POSITION('e-htl' IN v.combined_text) > 0
         OR POSITION('ehtl' IN v.combined_text) > 0
         OR POSITION('e htl' IN v.combined_text) > 0
         OR POSITION('azul viagens' IN v.combined_text) > 0) AS is_operadora
  FROM tmp_valid_rows v GROUP BY v.confirmation_number, v.property_name;

  -- Only delete this tenant's processed rows
  DELETE FROM public.processed_reservations WHERE tenant_id = p_tenant_id;

  INSERT INTO public.processed_reservations (
    tenant_id, confirmation_number, property_name, company_name, travel_agent_name,
    sales_channel, room_revenue, fb_revenue, total_revenue, roomnights,
    country, state, city, reservation_date, arrival_date, departure_date,
    departure_month, departure_year, lead_time_days
  )
  SELECT
    p_tenant_id, t.confirmation_number, t.property_name, s.agg_company, s.agg_agent,
    CASE
      WHEN COALESCE(ota.is_ota, false) THEN 'OTA'
      WHEN COALESCE(op.is_operadora, false) THEN 'Operadoras'
      WHEN COALESCE(ly.is_layover, false) THEN 'Layover'
      WHEN bm.segmento_standard IS NOT NULL THEN bm.segmento_standard
      WHEN COALESCE(g.has_group, false) THEN 'Grupos'
      WHEN COALESCE(s.has_agent, false) OR COALESCE(s.has_company, false) THEN 'Empresas'
      WHEN s.has_operational_room IS NULL OR s.has_operational_room = false THEN 'Outras receitas (PM e PF)'
      ELSE 'Particular'
    END,
    t.room_revenue, t.fb_revenue, t.total_revenue, t.roomnights,
    t.country, t.state, t.city, t.reservation_date, t.arrival_date,
    t.departure_date, t.departure_month, t.departure_year, t.lead_time_days
  FROM tmp_reservation_totals t
  LEFT JOIN tmp_operational_signals s ON s.confirmation_number = t.confirmation_number AND s.property_name = t.property_name
  LEFT JOIN tmp_best_mapping bm ON bm.confirmation_number = t.confirmation_number AND bm.property_name = t.property_name
  LEFT JOIN tmp_group_flags g ON g.confirmation_number = t.confirmation_number AND g.property_name = t.property_name
  LEFT JOIN tmp_ota_flags ota ON ota.confirmation_number = t.confirmation_number AND ota.property_name = t.property_name
  LEFT JOIN tmp_layover_flags ly ON ly.confirmation_number = t.confirmation_number AND ly.property_name = t.property_name
  LEFT JOIN tmp_operadora_flags op ON op.confirmation_number = t.confirmation_number AND op.property_name = t.property_name;

  -- OTA safety net for this tenant
  UPDATE public.processed_reservations pr
  SET sales_channel = CASE
    WHEN EXISTS (SELECT 1 FROM tmp_operadora_flags op WHERE op.confirmation_number = pr.confirmation_number AND op.property_name = pr.property_name AND op.is_operadora) THEN 'Operadoras'
    WHEN EXISTS (SELECT 1 FROM tmp_layover_flags ly WHERE ly.confirmation_number = pr.confirmation_number AND ly.property_name = pr.property_name AND ly.is_layover) THEN 'Layover'
    WHEN EXISTS (SELECT 1 FROM tmp_best_mapping bm WHERE bm.confirmation_number = pr.confirmation_number AND bm.property_name = pr.property_name) THEN
      (SELECT bm2.segmento_standard FROM tmp_best_mapping bm2 WHERE bm2.confirmation_number = pr.confirmation_number AND bm2.property_name = pr.property_name)
    WHEN EXISTS (SELECT 1 FROM tmp_group_flags g WHERE g.confirmation_number = pr.confirmation_number AND g.property_name = pr.property_name AND g.has_group) THEN 'Grupos'
    WHEN pr.company_name IS NOT NULL OR pr.travel_agent_name IS NOT NULL THEN 'Empresas'
    ELSE 'Particular'
  END
  WHERE pr.tenant_id = p_tenant_id
    AND pr.sales_channel = 'OTA'
    AND NOT EXISTS (
      SELECT 1 FROM tmp_valid_rows v
      WHERE v.confirmation_number = pr.confirmation_number
        AND v.property_name = pr.property_name
        AND (POSITION('booking' IN v.combined_text) > 0
          OR POSITION('expedia' IN v.combined_text) > 0
          OR POSITION('decolar' IN v.combined_text) > 0)
    );

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.upload_batches
    SET status = 'completed', completed_at = NOW(),
        processed_rows = (SELECT COUNT(*) FROM public.processed_reservations WHERE tenant_id = p_tenant_id)
    WHERE id = p_batch_id;
  END IF;
END;
$$;
