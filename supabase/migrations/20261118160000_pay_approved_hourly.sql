-- Hourly sweep through bill-mcp. The job reads vault secrets at run time:
-- project_url (https://<ref>.supabase.co) and bill_mcp_token.
-- A database without pg_cron or pg_net skips the job so local reset can continue.

do $schedule$
begin
  create extension if not exists pg_cron with schema extensions;
  create extension if not exists pg_net with schema extensions;
  if exists (select 1 from cron.job where jobname = 'pay-approved-hourly') then
    perform cron.unschedule('pay-approved-hourly');
  end if;
  perform cron.schedule(
    'pay-approved-hourly',
    '0 * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/bill-mcp',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bill_mcp_token')
      ),
      body := '{"method":"sweep_approved_payments"}'::jsonb
    );
    $job$
  );
exception
  when others then
    raise notice 'pay-approved-hourly was not scheduled: %', sqlerrm;
end
$schedule$;
