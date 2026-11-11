import { Global, Injectable, Module, ServiceUnavailableException } from "@nestjs/common";
import { config } from "../config";

/** Thin client for the Python AI Gateway (apps/ai). */
@Injectable()
export class AiClient {
  async post<T>(path: string, body: object, timeoutMs = 60000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.aiUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ServiceUnavailableException(`AI gateway unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) throw new ServiceUnavailableException(`AI gateway ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** E42: replace gateway state owned by the API (inference routing policy). */
  async put<T>(path: string, body: object, timeoutMs = 10000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.aiUrl}${path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new ServiceUnavailableException(`AI gateway unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) throw new ServiceUnavailableException(`AI gateway ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${config.aiUrl}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new ServiceUnavailableException(`AI gateway ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }
}

@Global()
@Module({ providers: [AiClient], exports: [AiClient] })
export class AiModule {}
