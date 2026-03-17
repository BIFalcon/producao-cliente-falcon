
-- 1. Channel comparison (YoY by period)
CREATE OR REPLACE FUNCTION public.get_channel_comparison(
  p_property text DEFAULT NULL,
  p_current_year int DEFAULT NULL,
  p_previous_year int DEFAULT NULL,
  p_month int DEFAULT NULL
)
RETURNS TABLE(sales_channel text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH cur AS (
    SELECT pr.sales_channel AS ch, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
    GROUP BY pr.sales_channel
  ),
  prev AS (
    SELECT pr.sales_channel AS ch, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
    GROUP BY pr.sales_channel
  )
  SELECT COALESCE(c.ch, p.ch), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.ch = p.ch
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- 2. Channel drill-down (breakdown within a channel)
CREATE OR REPLACE FUNCTION public.get_channel_drilldown(
  p_channel text,
  p_property text DEFAULT NULL,
  p_current_year int DEFAULT NULL,
  p_previous_year int DEFAULT NULL,
  p_month int DEFAULT NULL
)
RETURNS TABLE(item_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH cur AS (
    SELECT
      CASE WHEN p_channel IN ('OTA','Operadoras','Empresas','Layover')
           THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
           ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
      END AS nm,
      SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.sales_channel = p_channel
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
    GROUP BY nm
  ),
  prev AS (
    SELECT
      CASE WHEN p_channel IN ('OTA','Operadoras','Empresas','Layover')
           THEN COALESCE(NULLIF(pr.company_name,''), pr.travel_agent_name, 'Sem nome')
           ELSE COALESCE(NULLIF(pr.travel_agent_name,''), pr.company_name, 'Sem nome')
      END AS nm,
      SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.sales_channel = p_channel
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
    GROUP BY nm
  )
  SELECT COALESCE(c.nm, p.nm), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.nm = p.nm
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- 3. Agent comparison (YoY)
CREATE OR REPLACE FUNCTION public.get_agent_comparison(
  p_property text DEFAULT NULL,
  p_current_year int DEFAULT NULL,
  p_previous_year int DEFAULT NULL,
  p_month int DEFAULT NULL
)
RETURNS TABLE(travel_agent_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH cur AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
    GROUP BY pr.travel_agent_name
  ),
  prev AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.travel_agent_name IS NOT NULL AND pr.travel_agent_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_previous_year IS NULL OR pr.departure_year = p_previous_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
    GROUP BY pr.travel_agent_name
  )
  SELECT COALESCE(c.ag, p.ag), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.ag = p.ag
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- 4. Agent companies drill-down
CREATE OR REPLACE FUNCTION public.get_agent_companies(
  p_agent text,
  p_property text DEFAULT NULL,
  p_current_year int DEFAULT NULL,
  p_previous_year int DEFAULT NULL,
  p_month int DEFAULT NULL
)
RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH cur AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev
    FROM processed_reservations pr
    WHERE pr.travel_agent_name = p_agent
      AND pr.company_name IS NOT NULL AND pr.company_name != ''
      AND (p_property IS NULL OR pr.property_name = p_property)
      AND (p_current_year IS NULL OR pr.departure_year = p_current_year)
      AND (p_month IS NULL OR pr.departure_month = p_month)
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
    GROUP BY pr.company_name
  )
  SELECT COALESCE(c.co, p.co), COALESCE(c.rev, 0), COALESCE(p.rev, 0),
    COALESCE(c.rev, 0) - COALESCE(p.rev, 0),
    CASE WHEN COALESCE(p.rev, 0) > 0 THEN ROUND((COALESCE(c.rev, 0) - p.rev) / p.rev * 100, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.co = p.co
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$$;

-- 5. Guest city analytics
CREATE OR REPLACE FUNCTION public.get_guest_city_analytics(
  p_property text DEFAULT NULL,
  p_year int DEFAULT NULL,
  p_month int DEFAULT NULL,
  p_channel text DEFAULT NULL
)
RETURNS TABLE(city text, state text, revenue numeric, reservations bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT pr.city, pr.state, SUM(pr.total_revenue), COUNT(*)::BIGINT
  FROM processed_reservations pr
  WHERE pr.city IS NOT NULL AND pr.city != ''
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
  GROUP BY pr.city, pr.state
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

-- 6. Company city analytics
CREATE OR REPLACE FUNCTION public.get_company_city_analytics(
  p_property text DEFAULT NULL,
  p_year int DEFAULT NULL,
  p_month int DEFAULT NULL,
  p_channel text DEFAULT NULL
)
RETURNS TABLE(city text, state text, company_count bigint, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT pr.city, pr.state, COUNT(DISTINCT pr.company_name), SUM(pr.total_revenue)
  FROM processed_reservations pr
  WHERE pr.city IS NOT NULL AND pr.city != ''
    AND pr.company_name IS NOT NULL AND pr.company_name != ''
    AND (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_month IS NULL OR pr.departure_month = p_month)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
  GROUP BY pr.city, pr.state
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;

-- 7. Company city drill-down
CREATE OR REPLACE FUNCTION public.get_company_city_drilldown(
  p_city text,
  p_state text DEFAULT NULL,
  p_property text DEFAULT NULL,
  p_year int DEFAULT NULL,
  p_month int DEFAULT NULL,
  p_channel text DEFAULT NULL
)
RETURNS TABLE(company_name text, revenue numeric, reservations bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
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
  GROUP BY pr.company_name
  ORDER BY SUM(pr.total_revenue) DESC;
END;
$$;
