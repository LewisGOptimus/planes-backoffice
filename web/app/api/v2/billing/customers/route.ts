import { fromUnknownError, success } from "@/lib/api/response";
import { searchCustomers } from "@/lib/services/billing-v2";

export async function GET(request: Request) {
  try {
    const items = await searchCustomers(new URL(request.url).searchParams);
    return success(items, { count: items.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}
