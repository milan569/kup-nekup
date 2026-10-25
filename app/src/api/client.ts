import type {
  Alternative,
  AlternativesRequest,
  AlternativesResearchRequest,
  AlternativesResearchResponse,
  CompareRequest,
  CompareResponse,
  EanLookupRequest,
  IngredientInfoResponse,
  InsightRequest,
  InsightResponse,
  ManualLookupRequest,
  ManufacturerInfo,
  ManufacturerRequest,
  PhotoLookupRequest,
  ProductResult,
  QuickInsightResponse,
  SearchCandidate,
} from "./types";
import { DEFAULT_API_URL, DEFAULT_APP_TOKEN } from "../storage/settings";

let baseUrl = DEFAULT_API_URL;
let appToken = DEFAULT_APP_TOKEN;

export function setBaseUrl(url: string): void {
  baseUrl = url.trim().replace(/\/+$/, "") || DEFAULT_API_URL;
}

export function getBaseUrl(): string {
  return baseUrl;
}

/**
 * Phone keyboards add surprises when typing the token: a capital first
 * letter, trailing spaces, typographic dashes. Same normalisation as the server.
 */
export function normalizeToken(raw: string): string {
  // trims and lower-cases for display/storage; the server additionally treats
  // the "kupnekup-" prefix and dashes as optional
  return raw
    .normalize("NFKC")
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function setAppToken(token: string): void {
  appToken = normalizeToken(token);
}

export function getAppToken(): string {
  return appToken;
}

export class ApiError extends Error {
  /** "auth" = the server rejected the access token (401/403) */
  readonly kind: "timeout" | "network" | "http" | "auth";
  readonly status?: number;
  /** machine-readable code from the error body, e.g. "in_store_code" */
  readonly code?: string;
  constructor(kind: ApiError["kind"], message: string, status?: number, code?: string) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Short Czech message for the UI; never a stack trace. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message.split("\n")[0];
  return "Neznámá chyba.";
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs: number;
  baseUrlOverride?: string;
  tokenOverride?: string;
}

async function request<T>(path: string, opts: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const url = (opts.baseUrlOverride ?? baseUrl) + path;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const token = normalizeToken(opts.tokenOverride ?? appToken);
  if (token) headers["x-app-token"] = token;
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body == null ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const serverMsg =
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : null;
      const msg =
        serverMsg ??
        (res.status === 401 || res.status === 403
          ? "Server odmítl přístup. Zkontrolujte přístupový klíč v Nastavení serveru."
          : `Server vrátil chybu ${res.status}.`);
      const code =
        data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string"
          ? (data as { code: string }).code
          : undefined;
      throw new ApiError(res.status === 401 || res.status === 403 ? "auth" : "http", msg, res.status, code);
    }
    // Streamed endpoints (insight) send HTTP 200 before the work is done; a failure
    // then arrives as a body that is exactly { "error": "…" }.
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const keys = Object.keys(data);
      const errorValue = (data as { error?: unknown }).error;
      if (keys.length === 1 && keys[0] === "error" && typeof errorValue === "string") {
        throw new ApiError("http", errorValue);
      }
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError("timeout", "Server neodpověděl včas. Zkuste to znovu.");
    }
    throw new ApiError(
      "network",
      "Nepodařilo se připojit k serveru. Zkontrolujte připojení a adresu serveru v Profilu.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface HealthResponse {
  ok: boolean;
  model: string;
  hasKey: boolean;
}

export const api = {
  health(baseUrlOverride?: string, tokenOverride?: string): Promise<HealthResponse> {
    return request<HealthResponse>("/api/health", { timeoutMs: 6000, baseUrlOverride, tokenOverride });
  },

  /** Verifies the access token (health is public and does not check it). */
  authCheck(baseUrlOverride?: string, tokenOverride?: string): Promise<{ ok: boolean; tokenRequired: boolean }> {
    return request<{ ok: boolean; tokenRequired: boolean }>("/api/auth-check", { timeoutMs: 8000, baseUrlOverride, tokenOverride });
  },

  lookupEan(body: EanLookupRequest): Promise<ProductResult> {
    return request<ProductResult>("/api/lookup/ean", { method: "POST", body, timeoutMs: 8000 });
  },

  lookupPhoto(body: PhotoLookupRequest): Promise<ProductResult> {
    return request<ProductResult>("/api/lookup/photo", { method: "POST", body, timeoutMs: 25000 });
  },

  lookupManual(body: ManualLookupRequest): Promise<ProductResult> {
    return request<ProductResult>("/api/lookup/manual", { method: "POST", body, timeoutMs: 20000 });
  },

  search(q: string, countries: string[]): Promise<{ candidates: SearchCandidate[] }> {
    const params = new URLSearchParams({ q });
    if (countries.length) params.set("countries", countries.join(","));
    return request<{ candidates: SearchCandidate[] }>(`/api/search?${params.toString()}`, {
      timeoutMs: 8000,
    });
  },

  manufacturer(body: ManufacturerRequest): Promise<ManufacturerInfo> {
    return request<ManufacturerInfo>("/api/manufacturer", { method: "POST", body, timeoutMs: 25000 });
  },

  alternatives(body: AlternativesRequest): Promise<{ alternatives: Alternative[] }> {
    return request<{ alternatives: Alternative[] }>("/api/alternatives", {
      method: "POST",
      body,
      timeoutMs: 15000,
    });
  },

  /** fast first opinion with a short web check (10–20 s); streamed like the deep insight */
  quickInsight(body: InsightRequest): Promise<QuickInsightResponse> {
    return request<QuickInsightResponse>("/api/insight/quick", { method: "POST", body, timeoutMs: 90000 });
  },

  /** closest alternatives of the same kind in one country (web research, up to ~1 min) */
  alternativesResearch(body: AlternativesResearchRequest): Promise<AlternativesResearchResponse> {
    return request<AlternativesResearchResponse>("/api/alternatives/research", { method: "POST", body, timeoutMs: 180000 });
  },

  /** quick comparison of the basket (rules + short web check, 10–20 s) */
  compareQuick(body: CompareRequest): Promise<CompareResponse> {
    return request<CompareResponse>("/api/compare/quick", { method: "POST", body, timeoutMs: 90000 });
  },

  /** deep comparison: full research of every product first (1–3 min) */
  compare(body: CompareRequest): Promise<CompareResponse> {
    return request<CompareResponse>("/api/compare", { method: "POST", body, timeoutMs: 420000 });
  },

  /** ingredient list in Czech (foreign lists are translated once on the server and cached) */
  translateIngredients(body: { text: string }): Promise<{ text: string; translated: boolean; cached: boolean; items: { text: string; severity: number }[] }> {
    return request("/api/ingredients/translate", { method: "POST", body, timeoutMs: 30000 });
  },

  /** health impact of one tapped ingredient (lookup on the server, no AI cost) */
  ingredientInfo(body: { q?: string; ref?: string; context?: string }): Promise<IngredientInfoResponse> {
    return request<IngredientInfoResponse>("/api/ingredient", { method: "POST", body, timeoutMs: 10000 });
  },

  insight(body: InsightRequest): Promise<InsightResponse> {
    // research takes 1–3 minutes; the server streams whitespace while it works
    return request<InsightResponse>("/api/insight", { method: "POST", body, timeoutMs: 240000 });
  },
};
