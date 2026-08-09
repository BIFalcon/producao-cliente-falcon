-- 1. Novo enum de estágios
CREATE TYPE public.crm_account_stage_new AS ENUM (
  'prospeccao',
  'lead_identificado',
  'contato_realizado',
  'oportunidade',
  'proposta_enviada',
  'negociacao',
  'fechamento'
);

-- 2. Novo enum de status da conta
CREATE TYPE public.crm_account_status AS ENUM ('ativo', 'inativo');

-- 3. Migrar coluna stage para o novo enum
ALTER TABLE public.crm_accounts ALTER COLUMN stage DROP DEFAULT;

ALTER TABLE public.crm_accounts
  ALTER COLUMN stage TYPE public.crm_account_stage_new
  USING (
    CASE stage::text
      WHEN 'prospectado'   THEN 'prospeccao'
      WHEN 'contatado'     THEN 'contato_realizado'
      WHEN 'em_negociacao' THEN 'negociacao'
      WHEN 'cliente_ativo' THEN 'fechamento'
      WHEN 'inativo'       THEN 'fechamento'
      ELSE 'prospeccao'
    END
  )::public.crm_account_stage_new;

ALTER TABLE public.crm_accounts
  ALTER COLUMN stage SET DEFAULT 'prospeccao'::public.crm_account_stage_new;

-- 4. Trocar os tipos de nome
DROP TYPE public.crm_account_stage;
ALTER TYPE public.crm_account_stage_new RENAME TO crm_account_stage;

-- 5. Novo campo Status da Conta (só preenchido em Fechamento)
ALTER TABLE public.crm_accounts
  ADD COLUMN account_status public.crm_account_status;

-- Contas que já eram clientes ativos/inativos herdam o status correspondente
UPDATE public.crm_accounts SET account_status = 'ativo'::public.crm_account_status
WHERE stage = 'fechamento'::public.crm_account_stage AND account_status IS NULL;

-- 6. Trigger: status nasce como Ativo ao chegar em Fechamento e é limpo ao sair
CREATE OR REPLACE FUNCTION public.crm_accounts_sync_account_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.stage = 'fechamento'::public.crm_account_stage THEN
    IF NEW.account_status IS NULL THEN
      NEW.account_status := 'ativo'::public.crm_account_status;
    END IF;
  ELSE
    NEW.account_status := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_accounts_sync_account_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crm_accounts_sync_account_status ON public.crm_accounts;
CREATE TRIGGER trg_crm_accounts_sync_account_status
BEFORE INSERT OR UPDATE OF stage, account_status ON public.crm_accounts
FOR EACH ROW EXECUTE FUNCTION public.crm_accounts_sync_account_status();