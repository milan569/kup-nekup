import { useNavigation } from "@react-navigation/native";
import React from "react";
import type { ErrorKind } from "../api/client";
import type { RootNavigation } from "../navigationTypes";
import { ErrorBox } from "./ErrorBox";

interface Props {
  message: string;
  /** "auth" = no Claude key or a rejected one (api/client errorKindOf) */
  kind?: ErrorKind | null;
  title?: string;
  /** run the failed action again */
  onRetry?: () => void;
  retryLabel?: string;
  /** close the box without retrying */
  onDismiss?: () => void;
  dismissLabel?: string;
}

/**
 * Error box for a failed API call. An auth error gets a "Zadat klíč" button
 * leading to the key screen (a retry would fail the same way); any other
 * error the usual retry and close buttons.
 */
export function ApiErrorBox({ message, kind, title, onRetry, retryLabel = "Zkusit znovu", onDismiss, dismissLabel = "Zavřít" }: Props) {
  const navigation = useNavigation<RootNavigation>();
  if (kind === "auth") {
    return (
      <ErrorBox
        title={title ?? "Chybí nebo neplatí Claude klíč"}
        message={message}
        actionLabel="Zadat klíč"
        onAction={() => {
          onDismiss?.();
          navigation.navigate("ClaudeKey");
        }}
        onRetry={onDismiss}
        retryLabel={dismissLabel}
      />
    );
  }
  const both = !!onRetry && !!onDismiss;
  return (
    <ErrorBox
      title={title}
      message={message}
      actionLabel={both ? retryLabel : undefined}
      onAction={both ? onRetry : undefined}
      onRetry={onDismiss ?? onRetry}
      retryLabel={onDismiss ? dismissLabel : retryLabel}
    />
  );
}
