import { fromUnknownError, success } from "@/lib/api/response";
import { readJson, requireDate, requireString, requireUuid } from "@/lib/api/validation";
import { renewExpiredSubscription } from "@/lib/services/backoffice";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    const data = await renewExpiredSubscription({
      subscriptionId: requireUuid(id, "id"),
      fechaInicio: requireDate(payload.fecha_inicio, "fecha_inicio"),
      precioPlanId: requireUuid(payload.precio_plan_id, "precio_plan_id"),
      billingCycle: requireString(payload.billing_cycle, "billing_cycle"),
    });
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
