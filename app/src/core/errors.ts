import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DailyCapError } from "./usage";

/** Open Food Facts timed out, answered 5xx or 429 (the message says which). */
export class OffUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffUnavailableError";
  }
}

/**
 * One error shape for the UI (the former HTTP status codes of the server
 * became `status`; screens branch on `kind` and `code` as before).
 */
export class ApiError extends Error {
  /** "auth" = no Claude key or Claude rejected it */
  readonly kind: "timeout" | "network" | "http" | "auth";
  readonly status?: number;
  /** machine-readable code, e.g. "in_store_code", "no_key", "daily_cap" */
  readonly code?: string;
  constructor(kind: ApiError["kind"], message: string, status?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Short Czech message for the UI; never a stack trace. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message.split("\n")[0]!;
  return "Neznámá chyba.";
}

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("Chybí Claude API klíč. Zadejte ho v Profilu → Claude API klíč.");
    this.name = "ClaudeNotConfiguredError";
  }
}

export class ClaudeRefusedError extends Error {
  constructor() {
    super("Model odmítl požadavek zpracovat.");
    this.name = "ClaudeRefusedError";
  }
}

export const INVALID_KEY_MESSAGE =
  "Claude odmítl API klíč. V Profilu → Claude API klíč vložte celý klíč z Claude Console (Keys & access → Create key), bez mezer a uvozovek.";

/** Maps any failure to an ApiError with a short Czech message; details go to the console only. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof z.ZodError) {
    return new ApiError("http", "Neplatný požadavek: " + err.issues.map((i) => i.message).join("; "), 400);
  }
  if (err instanceof ClaudeNotConfiguredError) return new ApiError("auth", err.message, 401, "no_key");
  if (err instanceof DailyCapError) return new ApiError("http", err.message, 429, "daily_cap");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error(`[claude] ${err.status}: klíč má správný tvar, ale Anthropic ho nepřijal (zrušený, z jiné organizace, nebo bez kreditu?)`);
    return new ApiError("auth", INVALID_KEY_MESSAGE, err.status, "bad_key");
  }
  if (err instanceof ClaudeRefusedError) return new ApiError("http", err.message, 422);
  if (err instanceof OffUnavailableError) {
    const limited = /HTTP 429/.test(err.message);
    return new ApiError(
      "http",
      limited
        ? "Databáze produktů nás na chvíli brzdí kvůli počtu dotazů. Zkuste to za minutu, nebo vyfoťte etiketu."
        : "Databáze produktů je dočasně nedostupná. Zkuste fotku etikety nebo ruční zadání.",
      503,
    );
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ApiError("timeout", "AI neodpověděla včas. Zkuste to znovu.");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ApiError("network", "Nepodařilo se spojit s AI. Zkontrolujte připojení k internetu a zkuste to znovu.");
  }
  if (err instanceof Anthropic.APIError) {
    console.error(`[claude] HTTP ${err.status ?? "?"} request_id=${err.requestID ?? "?"}: ${err.message}`);
    if (err.status === 429 || err.status === 529 || (err.status ?? 0) >= 500) {
      return new ApiError("http", "AI je teď přetížená. Zkuste to za chvíli znovu, mezitím funguje čárový kód.", 503);
    }
    return new ApiError("http", `AI požadavek nezpracovala (chyba ${err.status ?? "?"}). Zkuste to znovu, případně čárový kód nebo ruční zadání.`, 502);
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new ApiError("timeout", "Odpověď nepřišla včas. Zkuste to znovu.");
  }
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return new ApiError("network", "Nepodařilo se připojit k internetu. Zkontrolujte připojení a zkuste to znovu.");
  }
  console.error(err);
  return new ApiError("http", err instanceof Error && err.message ? err.message.split("\n")[0]! : "Něco se pokazilo. Zkuste to znovu.", 500);
}
