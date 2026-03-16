import { fromUnknownError, success } from "@/lib/api/response";
import { AppError } from "@/lib/api/types";
import { backofficeSeed } from "@/lib/services/backoffice";

export async function POST(request: Request) {
  try {
    const required = process.env.BACKOFFICE_ADMIN_KEY;
    const provided = request.headers.get("x-backoffice-key");
    if (!required || provided !== required) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or missing x-backoffice-key");
    }
    const data = await backofficeSeed();
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}

