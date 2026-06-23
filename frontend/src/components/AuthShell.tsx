import type { ReactNode } from "react";
import LangToggle from "./LangToggle";

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-md rounded-lg border border-border-default bg-surface p-8">
        <h2 className="mb-6 text-center text-xl font-semibold text-primary">LiveBoard</h2>
        {children}
      </div>
      <div className="fixed top-4 right-4">
        <LangToggle />
      </div>
    </div>
  );
}
