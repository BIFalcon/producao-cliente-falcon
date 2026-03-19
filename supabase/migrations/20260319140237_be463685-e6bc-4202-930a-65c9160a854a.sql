
-- Update ADR thresholds from 50-3000 to 20-2000 in all 5 functions

-- 1. get_dashboard_kpis
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_property text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(total_revenue numeric, total_reservations bigint, avg_lead_time numeric, total_roomnights numeric, adr numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[]; v_total_revenue numeric; v_total_reservations bigint; v_avg_lead_time numeric; v_total_roomnights numeric; v_adr numeric;
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  SELECT SUM(pr.total_revenue), COUNT(*)::BIGINT, AVG(pr.lead_time_days)::NUMERIC, SUM(pr.roomnights)::NUMERIC
  INTO v_total_revenue, v_total_reservations, v_avg_lead_time, v_total_roomnights
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed));
  SELECT CASE WHEN SUM(pr.roomnights) > 0 THEN ROUND(SUM(pr.room_revenue) / SUM(pr.roomnights), 2) ELSE NULL END
  INTO v_adr
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    AND pr.room_revenue > 0 AND pr.roomnights > 0
    AND (pr.room_revenue / pr.roomnights) >= 20
    AND (pr.room_revenue / pr.roomnights) <= 2000;
  RETURN QUERY SELECT v_total_revenue, v_total_reservations, v_avg_lead_time, v_total_roomnights, v_adr;
END;
$function$;

-- 2. get_company_table
CREATE OR REPLACE FUNCTION public.get_company_table(p_property text DEFAULT NULL::text, p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, revenue_share numeric, roomnights_current numeric, room_revenue_current numeric, adr_current numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH current_yr AS (
    SELECT pr.company_name AS cn, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
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

-- 3. get_agent_comparison
CREATE OR REPLACE FUNCTION public.get_agent_comparison(p_property text DEFAULT NULL::text, p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_month integer DEFAULT NULL::integer)
 RETURNS TABLE(travel_agent_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT pr.travel_agent_name AS ag, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
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

-- 4. get_agent_companies
CREATE OR REPLACE FUNCTION public.get_agent_companies(p_agent text, p_property text DEFAULT NULL::text, p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_month integer DEFAULT NULL::integer)
 RETURNS TABLE(company_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());
  RETURN QUERY
  WITH cur AS (
    SELECT pr.company_name AS co, SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
           SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
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

-- 5. get_channel_drilldown
CREATE OR REPLACE FUNCTION public.get_channel_drilldown(p_channel text, p_property text DEFAULT NULL::text, p_current_year integer DEFAULT NULL::integer, p_previous_year integer DEFAULT NULL::integer, p_month integer DEFAULT NULL::integer)
 RETURNS TABLE(item_name text, revenue_current numeric, revenue_previous numeric, absolute_change numeric, pct_change numeric, roomnights_current numeric, adr_current numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
      SUM(pr.total_revenue) AS rev, SUM(pr.roomnights) AS rn, SUM(pr.room_revenue) AS room_rev,
      SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.room_revenue ELSE 0 END) AS adr_room_rev,
      SUM(CASE WHEN pr.room_revenue > 0 AND pr.roomnights > 0 AND (pr.room_revenue / pr.roomnights) >= 20 AND (pr.room_revenue / pr.roomnights) <= 2000 THEN pr.roomnights ELSE 0 END) AS adr_rn
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
    CASE WHEN COALESCE(c.adr_rn, 0) > 0 THEN ROUND(c.adr_room_rev / c.adr_rn, 2) ELSE NULL END
  FROM cur c FULL OUTER JOIN prev p ON c.nm = p.nm
  ORDER BY COALESCE(c.rev, 0) DESC;
END;
$function$;
