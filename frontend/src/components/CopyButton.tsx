import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({ value, label = "Copy", copiedLabel = "Copied ✓" }: { value: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button type="button" onClick={onCopy}
      className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-sm text-secondary hover:bg-surface-2">
      {copied ? <Check size={14} className="text-success-ui" aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? copiedLabel : label}
    </button>
  );
}
