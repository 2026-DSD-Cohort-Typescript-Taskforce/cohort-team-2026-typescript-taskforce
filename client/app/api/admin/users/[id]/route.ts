import { forward } from '@/lib/forward';

// DC-55: edit a user. Express checks that the caller is a system admin.
export async function PATCH(request: Request, ctx: RouteContext<'/api/admin/users/[id]'>) {
  const { id } = await ctx.params;
  return forward(request, `/api/admin/users/${encodeURIComponent(id)}`);
}
