import { fromUnknownError, success } from "@/lib/api/response";
import { getPriceBook } from "@/lib/services/billing-v2";

export async function GET(request: Request) {
  try {
    const data = await getPriceBook(new URL(request.url).searchParams);
    return success(data, { count: data.versions.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}
