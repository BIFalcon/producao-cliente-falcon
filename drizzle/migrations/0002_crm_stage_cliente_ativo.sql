ALTER TYPE public.crm_account_stage ADD VALUE IF NOT EXISTS 'cliente_ativo';

CREATE OR REPLACE FUNCTION public.crm_accounts_sync_account_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stage::text = 'fechamento' THEN
    IF NEW.account_status IS NULL THEN
      NEW.account_status := 'ativo'::public.crm_account_status;
    END IF;
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := CURRENT_DATE;
    END IF;
  ELSIF NEW.stage::text = 'cliente_ativo' THEN
    -- Cliente de carteira histórica: ativo, mas não é novo fechamento
    IF NEW.account_status IS NULL THEN
      NEW.account_status := 'ativo'::public.crm_account_status;
    END IF;
    NEW.closed_at := NULL;
  ELSE
    NEW.account_status := NULL;
  END IF;
  RETURN NEW;
END;
$function$;