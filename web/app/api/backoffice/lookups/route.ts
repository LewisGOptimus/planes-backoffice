import { fromUnknownError, success } from "@/lib/api/response";
import { getBackofficeLookups } from "@/lib/services/backoffice";

export async function GET() {
  try {
    const data = await getBackofficeLookups();
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}

