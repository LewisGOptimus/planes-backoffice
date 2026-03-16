import { fromUnknownError, success } from "@/lib/api/response";
import { optionalDate, readJson } from "@/lib/api/validation";
import { updateSubscriptionEntitlementWindow } from "@/lib/services/entitlements-admin";

type RouteContext = {
  params:
    | Promise<{ id: string; entitlementId: string; efectivoDesde: string }>
    | { id: string; entitlementId: string; efectivoDesde: string };
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, entitlementId, efectivoDesde } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    const data = await updateSubscriptionEntitlementWindow({
      subscriptionId: id,
      entitlementId,
      efectivoDesde,
      efectivoHasta: optionalDate(payload.efectivo_hasta, "efectivo_hasta"),
    });
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}

