import { fromUnknownError, success } from "@/lib/api/response";
import { getOperationsDashboard } from "@/lib/services/billing-v2";

export async function GET() {
  try {
    const data = await getOperationsDashboard();
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
