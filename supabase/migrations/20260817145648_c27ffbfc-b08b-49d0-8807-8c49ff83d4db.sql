ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gerente_geral';
ALTER TYPE public.crm_visit_type ADD VALUE IF NOT EXISTS 'reuniao_comercial_interna';
ALTER TYPE public.crm_visit_type ADD VALUE IF NOT EXISTS 'treinamento';
ALTER TYPE public.crm_visit_type ADD VALUE IF NOT EXISTS 'eventos_feiras';
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS sub_segment text;