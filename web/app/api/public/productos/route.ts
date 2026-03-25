import { fromUnknownError, success } from "@/lib/api/response";
import { listPublicProducts } from "@/lib/services/product-catalog";

export async function GET(request: Request) {
  try {
    const data = await listPublicProducts(new URL(request.url).searchParams);
    return success(data, { count: data.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}
