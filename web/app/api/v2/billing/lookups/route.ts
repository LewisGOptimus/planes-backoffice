import { fromUnknownError, success } from "@/lib/api/response";
import { getBillingLookups } from "@/lib/services/billing-v2";

export async function GET() {
  try {
    const data = await getBillingLookups();
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
