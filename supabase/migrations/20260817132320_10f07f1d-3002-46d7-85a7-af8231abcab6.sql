-- 1. Correção retroativa: OTA tem prioridade máxima
UPDATE public.processed_reservations pr
SET sales_channel = 'OTA'
WHERE pr.sales_channel <> 'OTA'
  AND LOWER(COALESCE(pr.travel_agent_name, '') || ' ' || COALESCE(pr.company_name, '')) ~ 'booking|expedia|decolar';

-- 2. Função para reaplicar as regras fixas de canal (OTA > Operadoras > Layover)
CREATE OR REPLACE FUNCTION public.reclassify_tenant_channels(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
  v_n integer;
BEGIN
  IF NOT (public.is_super_admin(auth.uid())
          OR public.has_role_in_tenant(auth.uid(), 'master_admin', p_tenant_id)) THEN
    RAISE EXCEPTION 'Acesso restrito a Master Admin';
  END IF;

  UPDATE public.processed_reservations pr
  SET sales_channel = 'OTA'
  WHERE pr.tenant_id = p_tenant_id
    AND pr.sales_channel <> 'OTA'
    AND LOWER(COALESCE(pr.travel_agent_name, '') || ' ' || COALESCE(pr.company_name, '')) ~ 'booking|expedia|decolar';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  UPDATE public.processed_reservations pr
  SET sales_channel = 'Operadoras'
  WHERE pr.tenant_id = p_tenant_id
    AND pr.sales_channel NOT IN ('OTA', 'Operadoras')
    AND LOWER(COALESCE(pr.travel_agent_name, '') || ' ' || COALESCE(pr.company_name, '')) ~ 'e-htl|ehtl|e htl|azul viagens';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  UPDATE public.processed_reservations pr
  SET sales_channel = 'Layover'
  WHERE pr.tenant_id = p_tenant_id
    AND pr.sales_channel NOT IN ('OTA', 'Operadoras', 'Layover')
    AND LOWER(COALESCE(pr.travel_agent_name, '') || ' ' || COALESCE(pr.company_name, '')) ~ 'layover|azul linhas aereas|azul linhas global master'
    AND LOWER(COALESCE(pr.travel_agent_name, '') || ' ' || COALESCE(pr.company_name, '')) NOT LIKE '%azul viagens%';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reclassify_tenant_channels(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reclassify_tenant_channels(uuid) TO authenticated;