import { ApiResult, ApiSuccessPayload, HttpMethod } from "@/lib/types/api";

type FetchOptions = {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function fetchJson<T>(path: string, options: FetchOptions = {}): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  const payload = (await response.json()) as ApiResult<T>;
  return payload;
}

export function isSuccess<T>(result: ApiResult<T>): result is ApiSuccessPayload<T> {
  return result.ok;
}
