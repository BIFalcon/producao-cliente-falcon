
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_property text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(total_revenue numeric, total_reservations bigint, avg_lead_time numeric, total_roomnights numeric, adr numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_allowed text[];
  v_total_revenue numeric;
  v_total_reservations bigint;
  v_avg_lead_time numeric;
  v_total_roomnights numeric;
  v_adr numeric;
BEGIN
  v_allowed := public.get_allowed_properties(auth.uid());

  -- Full dataset: all metrics except ADR
  SELECT SUM(pr.total_revenue), COUNT(*)::BIGINT, AVG(pr.lead_time_days)::NUMERIC, SUM(pr.roomnights)::NUMERIC
  INTO v_total_revenue, v_total_reservations, v_avg_lead_time, v_total_roomnights
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed));

  -- Filtered dataset: ADR only
  SELECT CASE WHEN SUM(pr.roomnights) > 0 THEN ROUND(SUM(pr.room_revenue) / SUM(pr.roomnights), 2) ELSE NULL END
  INTO v_adr
  FROM public.processed_reservations pr
  WHERE (p_property IS NULL OR pr.property_name = p_property)
    AND (p_year IS NULL OR pr.departure_year = p_year)
    AND (p_channel IS NULL OR pr.sales_channel = p_channel)
    AND (v_allowed IS NULL OR pr.property_name = ANY(v_allowed))
    AND pr.room_revenue > 0 AND pr.roomnights > 0
    AND (pr.room_revenue / pr.roomnights) >= 50
    AND (pr.room_revenue / pr.roomnights) <= 3000;

  RETURN QUERY SELECT v_total_revenue, v_total_reservations, v_avg_lead_time, v_total_roomnights, v_adr;
END;
$function$;
