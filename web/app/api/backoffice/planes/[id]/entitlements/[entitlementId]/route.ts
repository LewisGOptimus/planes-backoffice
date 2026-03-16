import { fromUnknownError, success } from "@/lib/api/response";
import { removePlanEntitlement } from "@/lib/services/entitlements-admin";

type RouteContext = {
  params:
    | Promise<{ id: string; entitlementId: string }>
    | { id: string; entitlementId: string };
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id, entitlementId } = await context.params;
    const data = await removePlanEntitlement(id, entitlementId);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}

