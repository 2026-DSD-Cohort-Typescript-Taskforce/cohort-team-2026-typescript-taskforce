-- DC-55: editing users. update_user(). Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Setup (as postgres): an admin (S), a billing operator (O), a pending user (T) on property
-- one, and three properties.
insert into public.properties (property_id, name) values
  (956001, 'DC-55 edit property one'),
  (956002, 'DC-55 edit property two'),
  (956003, 'DC-55 edit property three');
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000056a1', 'dc55-edit-admin@example.test', now()),
  ('00000000-0000-4000-8000-0000000056a2', 'dc55-edit-operator@example.test', now());
insert into public.users (user_id, name, email, phone, role, auth_user_id) values
  (956001, 'Edit Admin', 'dc55-edit-admin@example.test', null, 'system_admin', '00000000-0000-4000-8000-0000000056a1'),
  (956002, 'Edit Operator', 'dc55-edit-operator@example.test', null, 'billing_operator', '00000000-0000-4000-8000-0000000056a2'),
  (956003, 'Edit Target', 'dc55-edit-target@example.test', '555-0100', 'viewer', null);
insert into public.user_properties (user_id, property_id) values (956003, 956001);

-- Schema
select has_function('public', 'update_user', ARRAY['integer', 'text', 'text', 'text', 'integer[]'], 'update_user exists');
select is_definer('public', 'update_user', ARRAY['integer', 'text', 'text', 'text', 'integer[]'], 'update_user is security definer');
select ok(
  not has_function_privilege('anon', 'public.update_user(integer, text, text, text, integer[])', 'execute'),
  'anon cannot execute update_user'
);

-- A billing operator is refused.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000056a2","role":"authenticated"}';
select throws_ok(
  $$select public.update_user(956003, 'Hacked', null, 'system_admin', '{}')$$,
  'PT403', 'forbidden', 'a billing operator cannot edit users'
);
reset role;

-- The admin edits T.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000056a1","role":"authenticated"}';
select lives_ok(
  $$select public.update_user(956003, '  New Name ', '  ', 'financial_approver', '{956002,956003,956002}')$$,
  'the admin edits a user'
);
reset role;
select is(
  (select row(name, email, phone, role)::text from public.users where user_id = 956003),
  row('New Name', 'dc55-edit-target@example.test', null::text, 'financial_approver')::text,
  'name is trimmed, blank phone is null, role changes and email is untouched'
);
select set_eq(
  'select property_id from public.user_properties where user_id = 956003',
  ARRAY[956002, 956003],
  'the property links are replaced, each once'
);

-- A failed edit changes nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000056a1","role":"authenticated"}';
select throws_ok(
  $$select public.update_user(956003, 'Changed', null, 'viewer', '{956001,999999999}')$$,
  '23503', null, 'an unknown property is refused'
);
select throws_ok(
  $$select public.update_user(956003, 'Changed', null, 'superuser', '{}')$$,
  '23514', null, 'an unknown role is refused by the role CHECK'
);
reset role;
select is((select name from public.users where user_id = 956003)::text, 'New Name', 'the refused edits left the name');
select set_eq(
  'select property_id from public.user_properties where user_id = 956003',
  ARRAY[956002, 956003],
  'and the property links'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000056a1","role":"authenticated"}';
select lives_ok(
  $$select public.update_user(956003, 'New Name', null, 'financial_approver', '{}')$$,
  'an empty list removes every property'
);
select throws_ok(
  $$select public.update_user(999999999, 'Nobody', null, 'viewer', '{}')$$,
  'PT404', 'not_found', 'an unknown user is refused'
);
-- The last admin could otherwise lock everyone out.
select throws_ok(
  $$select public.update_user(956001, 'Edit Admin', null, 'viewer', '{}')$$,
  'PT409', 'own_role', 'an admin cannot remove their own system_admin role'
);
select lives_ok(
  $$select public.update_user(956001, 'Edit Admin Renamed', null, 'system_admin', '{956001}')$$,
  'an admin can edit their own details while keeping the role'
);
reset role;
select is((select count(*)::int from public.user_properties where user_id = 956003), 0, 'T has no properties left');

select * from finish();
rollback;
