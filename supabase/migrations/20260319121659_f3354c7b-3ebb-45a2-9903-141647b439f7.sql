
-- Update get_dashboard_kpis: ADR with outlier filtering
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_property text DEFAULT NULL, p_year integer DEFAULT NULL, p_channel text DEFAULT NULL)
 RETURNS TABLE(total_revenue numeric, total_reservations bigint, avg_lead_time numeric, total_roomnights numeric, adr numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH base AS (
    SELECT pr.total_revenue AS t_rev, pr.room_revenue AS r_rev, pr.roomnights AS rn, pr.lead_time_days
    FROM public.processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
      AND (p_year IS NULL OR pr.departure_year = p_year)
      AND (p_channel IS NULL OR pr.sales_channel = p_channel)
      AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
  ),
  adr_valid AS (
    SELECT SUM(r_rev) AS adr_room_rev, SUM(rn) AS adr_rn
    FROM base
    WHERE r_rev IS NOT NULL AND r_rev > 0 AND rn > 0
      AND (r_rev / rn) >= 50 AND (r_rev / rn) <= 3000
  )
  SELECT SUM(b.t_rev), COUNT(*)::BIGINT, AVG(b.lead_time_days)::NUMERIC,
    SUM(b.rn)::NUMERIC,
    CASE WHEN av.adr_rn > 0 THEN ROUND(av.adr_room_rev / av.adr_rn, 2) ELSE NULL END
  FROM base b CROSS JOIN adr_valid av;
END;
$function$;

-- Update get_company_table: ADR with outlier filtering
CREATE OR REPLACE FUNCTION public.get_company_table(p_property text DEFAULT NULL, p_current_year integer DEFAULT NULL, p_previous_year integer DEFAULT NULL, p_channel text DEFAULT NULL)
 RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, revenue_share numeric, roomnights_current numeric, room_revenue_current numeric, adr_current numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH current_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev,
           SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 50 AND (pr.room_revenue / pr.roomnights) <= 3000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 50 AND (pr.room_revenue / pr.roomnights) <= 3000 THEN pr.roomnights ELSE 0 END) AS adr_rn
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
  grand_total AS (
    SELECT SUM(pr.total_revenue) AS t
    FROM public.processed_reservations pr
    WHERE (p_property IS NULL OR pr.property_name = p_property)
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
$function$;

-- Update get_agent_comparison: ADR with outlier filtering
CREATE OR REPLACE FUNCTION public.get_agent_comparison(p_property text DEFAULT NULL, p_current_year integer DEFAULT NULL, p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL)
 RETURNS TABLE(travel_agent_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev,
           SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 50 AND (pr.room_revenue / pr.roomnights) <= 3000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 50 AND (pr.room_revenue / pr.roomnights) <= 3000 THEN pr.roomnights ELSE 0 END) AS adr_rn
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
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.ag = p.ag
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;

-- Update get_agent_companies: ADR with outlier filtering
CREATE OR REPLACE FUNCTION public.get_agent_companies(p_agent text, p_property text DEFAULT NULL, p_current_year integer DEFAULT NULL, p_previous_year integer DEFAULT NULL, p_month integer DEFAULT NULL)
 RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev,
           SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 50 AND (pr.room_revenue / pr.roomnights) <= 3000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 50 AND (pr.room_revenue / pr.roomnights) <= 3000 THEN pr.roomnights ELSE 0 END) AS adr_rn
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
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.co = p.co
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;
