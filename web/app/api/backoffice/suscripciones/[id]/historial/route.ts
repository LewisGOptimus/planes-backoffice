import { fromUnknownError, success } from "@/lib/api/response";
import { getSubscriptionPlanHistoryWithBilling } from "@/lib/services/backoffice";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const data = await getSubscriptionPlanHistoryWithBilling(id);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
