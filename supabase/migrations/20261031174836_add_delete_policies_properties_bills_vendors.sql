CREATE POLICY "authenticated users can delete bills"
ON public.bills 
FOR DELETE 
TO authenticated
USING (true);

CREATE POLICY "authenticated users can delete properties"
ON public.properties
FOR DELETE
TO authenticated
USING (true);

CREATE POLICY "authenticated users can delete vendors"
ON public.vendors
FOR DELETE
TO authenticated
USING (true);