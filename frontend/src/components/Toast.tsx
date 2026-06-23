import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as RToast from "@radix-ui/react-toast";

interface ToastCtx {
  notify: (message: string) => void;
}
const ToastContext = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const notify = useCallback((msg: string) => {
    setMessage(msg);
    setOpen(true);
  }, []);
  return (
    <ToastContext.Provider value={{ notify }}>
      <RToast.Provider swipeDirection="right">
        {children}
        <RToast.Root open={open} onOpenChange={setOpen}
          className="rounded-md border border-success-ui bg-surface-2 px-3 py-2 text-sm text-success-ui">
          <RToast.Title>{message}</RToast.Title>
        </RToast.Root>
        <RToast.Viewport className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" />
      </RToast.Provider>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
