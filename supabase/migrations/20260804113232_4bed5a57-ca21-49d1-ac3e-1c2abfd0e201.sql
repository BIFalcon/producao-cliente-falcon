DO $$
DECLARE v_tenant uuid;
BEGIN
  SET LOCAL statement_timeout = '600s';
  SELECT id INTO v_tenant FROM public.tenants WHERE name = 'Falcon - Demais';

  CREATE TEMP TABLE tmp_ota_keys ON COMMIT DROP AS
  SELECT DISTINCT r.confirmation_number, r.property_name
  FROM public.raw_reservations r
  WHERE r.tenant_id = v_tenant
    AND lower(
      coalesce(r.company_name,'') || ' ' || coalesce(r.travel_agent_name,'') || ' ' ||
      coalesce(r.source_name,'') || ' ' || coalesce(r.individual_first_name,'')
    ) ~ 'booking|expedia|decolar';

  CREATE INDEX ON tmp_ota_keys (confirmation_number, property_name);

  UPDATE public.processed_reservations p
  SET sales_channel = 'OTA'
  FROM tmp_ota_keys k
  WHERE p.tenant_id = v_tenant
    AND p.confirmation_number = k.confirmation_number
    AND p.property_name = k.property_name
    AND p.sales_channel <> 'OTA';
END $$;