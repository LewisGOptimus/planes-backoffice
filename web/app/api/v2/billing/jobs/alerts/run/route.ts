import { fromUnknownError, success } from "@/lib/api/response";
import { runAlertsBatch } from "@/lib/services/billing-v2";

export async function POST() {
  try {
    const data = await runAlertsBatch();
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
