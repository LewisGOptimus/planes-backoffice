import { fromUnknownError, success } from "@/lib/api/response";
import { ensureCopCurrency } from "@/lib/services/backoffice";

export async function POST() {
  try {
    const data = await ensureCopCurrency();
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
