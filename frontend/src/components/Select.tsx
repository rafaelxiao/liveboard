import type { SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
};

export default function Select({ label, className = "", children, ...props }: Props) {
  return (
    <label className="text-xs text-secondary">
      {label}
      <select
        {...props}
        className={`mt-1 block h-8 rounded border border-border-default bg-surface px-2 text-xs text-primary ${className}`}
      >
        {children}
      </select>
    </label>
  );
}
