import { fromUnknownError, success } from "@/lib/api/response";
import { getCustomerTimeline } from "@/lib/services/billing-v2";

type RouteContext = { params: Promise<{ customerId: string }> | { customerId: string } };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { customerId } = await context.params;
    const data = await getCustomerTimeline(customerId, new URL(request.url).searchParams);
    return success(data, { count: data.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}
