export function fetchWithDeadline(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(url, { ...options, signal });
}

export async function readBoundedBody(response: Response, maximum: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new Error("La respuesta externa supera el tamaño permitido");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error("La respuesta externa supera el tamaño permitido");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

export async function readBoundedJson(response: Response, maximum = 8 * 1024 * 1024): Promise<unknown> {
  return JSON.parse((await readBoundedBody(response, maximum)).toString("utf8"));
}
