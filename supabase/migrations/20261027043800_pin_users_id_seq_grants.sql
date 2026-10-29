-- users_id_seq privileges as on the live project. Without this, a fresh replay
-- depends on the local image's default privileges when the users migration runs.
grant select, update, usage on sequence public.users_id_seq to anon, authenticated, service_role;
