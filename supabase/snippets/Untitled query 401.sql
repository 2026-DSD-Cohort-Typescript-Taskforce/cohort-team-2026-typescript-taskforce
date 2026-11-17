select t as table_name,
       has_table_privilege('anon',          'public.' || t, 'TRUNCATE') as anon_truncate,
       has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') as auth_truncate
from unnest(array['approvals','bank_accounts','cards','payment_methods',
                  'payments','properties','bills','vendors']) as t;
