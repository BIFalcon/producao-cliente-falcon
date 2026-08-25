REVOKE EXECUTE ON FUNCTION public.process_reservations(uuid, uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debug_process_reservations(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.block_upload_batch() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, PUBLIC;

ALTER FUNCTION public.block_upload_batch() SET search_path = public;
ALTER FUNCTION public.debug_process_reservations(uuid, text) SET search_path = public;

CREATE POLICY "crm attachments update own tenant"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'crm-attachments'
  AND (storage.foldername(name))[1] = (public.get_current_tenant_id())::text
  AND public.can_manage_crm(auth.uid(), public.get_current_tenant_id())
)
WITH CHECK (
  bucket_id = 'crm-attachments'
  AND (storage.foldername(name))[1] = (public.get_current_tenant_id())::text
  AND public.can_manage_crm(auth.uid(), public.get_current_tenant_id())
);