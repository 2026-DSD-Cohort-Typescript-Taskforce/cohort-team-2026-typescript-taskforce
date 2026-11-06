SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.bills_normalize_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
begin
  new.invoice_number := nullif(btrim(new.invoice_number), '');
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.sync_user_email_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  update public.users
     set user_email = new.email
   where auth_user_id = new.id;
  return null;
end
$function$;