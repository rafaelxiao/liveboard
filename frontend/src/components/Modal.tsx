import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export default function Modal({ open, onClose, title, children }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface rounded-lg border border-border-default shadow-xl max-w-md w-full mx-4 p-5 z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-primary">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-primary text-lg leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
