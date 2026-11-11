INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('bill-documents', 'bill-documents', false, 10485760, ARRAY['application/pdf']);

-- A signed-in user may only create files under pending/<their user_id>/.
CREATE POLICY "bill documents: upload own pending"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bill-documents'
    AND (storage.foldername(name))[1] = 'pending'
    AND (storage.foldername(name))[2] = (
      SELECT user_id::text FROM public.users WHERE auth_user_id = (SELECT auth.uid())
    )
  );

-- Signed-in users can read bill documents (the function and future View Bill).
CREATE POLICY "bill documents: read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'bill-documents');