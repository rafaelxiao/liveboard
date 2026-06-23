import { useTranslation } from "react-i18next";

interface AlertBannerProps {
  variant?: "error" | "success";
  message: string;
  onRetry?: () => void;
  children?: React.ReactNode;
}

export default function AlertBanner({ variant = "error", message, onRetry, children }: AlertBannerProps) {
  const { t } = useTranslation();
  const tone = variant === "error" ? "border-danger-ui text-danger-ui" : "border-success-ui text-success-ui";
  return (
    <div role="alert" aria-live="assertive" className={`rounded-md border ${tone} bg-surface-2 px-3 py-2 text-sm`}>
      <span>{message}</span>
      {children}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 underline">
          {t("Retry")}
        </button>
      )}
    </div>
  );
}
