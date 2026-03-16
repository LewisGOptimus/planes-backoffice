import { fromUnknownError, success } from "@/lib/api/response";
import { listAlerts } from "@/lib/services/billing-v2";

export async function GET(request: Request) {
  try {
    const data = await listAlerts(new URL(request.url).searchParams);
    return success(data, { count: data.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}
