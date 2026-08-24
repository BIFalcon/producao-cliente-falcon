CREATE POLICY "crm attachments read own tenant"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'crm-attachments'
    AND (storage.foldername(name))[1] = public.get_current_tenant_id()::text
    AND public.can_view_crm(auth.uid(), public.get_current_tenant_id())
  );

CREATE POLICY "crm attachments insert own tenant"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crm-attachments'
    AND (storage.foldername(name))[1] = public.get_current_tenant_id()::text
    AND public.can_manage_crm(auth.uid(), public.get_current_tenant_id())
  );

CREATE POLICY "crm attachments delete own tenant"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'crm-attachments'
    AND (storage.foldername(name))[1] = public.get_current_tenant_id()::text
    AND public.can_manage_crm(auth.uid(), public.get_current_tenant_id())
  );