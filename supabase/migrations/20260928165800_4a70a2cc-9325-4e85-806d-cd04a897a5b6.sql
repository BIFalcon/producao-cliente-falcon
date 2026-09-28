ALTER TABLE public.upload_batches ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.increment_batch_metadata(p_batch_id uuid, p_key text, p_delta numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.upload_batches
  SET metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), ARRAY[p_key],
      to_jsonb(COALESCE((metadata->>p_key)::numeric, 0) + p_delta), true)
  WHERE id = p_batch_id;
$$;
REVOKE ALL ON FUNCTION public.increment_batch_metadata(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_batch_metadata(uuid, text, numeric) TO service_role;