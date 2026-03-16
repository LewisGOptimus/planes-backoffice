import { fromUnknownError, success } from "@/lib/api/response";
import { getCustomerOverview } from "@/lib/services/billing-v2";

type RouteContext = { params: Promise<{ customerId: string }> | { customerId: string } };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { customerId } = await context.params;
    const data = await getCustomerOverview(customerId);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
