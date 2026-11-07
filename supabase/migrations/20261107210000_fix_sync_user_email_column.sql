CREATE OR REPLACE FUNCTION public.sync_user_email_from_auth()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  update public.users
     set email = new.email
   where auth_user_id = new.id;
  return null;
end
$function$;
