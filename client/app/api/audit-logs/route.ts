import type { NextRequest } from 'next/server';
import {
  AUDIT_FORBIDDEN,
  encodeCursor,
  INVALID_RANGE,
  PAGE_SIZE,
  parseAuditQuery,
} from '@/lib/audit-logs';
import { createUserClient, reply, replyWithError } from '@/lib/supabase';

const LOAD_FAILED = "Couldn't load the audit history. Try again.";

const AUDIT_SELECT =
  'audit_log_id, created_at, name, description, actor_type, agent, entity_type, entity_id, details, actor:users(user_id, name)';

/**
 * The audit log, newest first, PAGE_SIZE rows at a time (DC-104). ?from= and ?to= are ISO
 * timestamps: created_at >= from and < to. ?cursor= is next_cursor from the previous page
 * and keeps that page's range. Only financial approvers and system admins may read it.
 */
export async function GET(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  // RLS would only return no rows, so ask first (the same check as the select policy).
  const { data: allowed, error: roleError } = await supabase.rpc('is_vendor_manager');
  if (roleError) return replyWithError(roleError, LOAD_FAILED);
  if (allowed !== true) return reply(AUDIT_FORBIDDEN);

  const query = parseAuditQuery(request.nextUrl.searchParams);
  if (!query) return reply(INVALID_RANGE);

  // One row past the page says whether there is a next one.
  let rows = supabase
    .from('audit_logs')
    .select(AUDIT_SELECT)
    .order('created_at', { ascending: false })
    .order('audit_log_id', { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (query.from) rows = rows.gte('created_at', query.from);
  if (query.to) rows = rows.lt('created_at', query.to);
  if (query.after) {
    // Both values were checked in parseAuditQuery, so they can't change the filter.
    const { at, id } = query.after;
    rows = rows.or(`created_at.lt."${at}",and(created_at.eq."${at}",audit_log_id.lt.${id})`);
  }

  const { data, error } = await rows;
  if (error) return replyWithError(error, LOAD_FAILED);
  const page = data.slice(0, PAGE_SIZE);
  const next_cursor = data.length > PAGE_SIZE ? encodeCursor(query, page[page.length - 1]) : null;
  return reply({ body: { audit_logs: page, next_cursor } });
}
