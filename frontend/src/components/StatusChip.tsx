import type { UserStatus } from "../lib/types";

const DOT: Record<UserStatus, string> = {
  pending: "bg-warning",
  approved: "bg-success-ui",
  rejected: "bg-danger-ui",
};

export default function StatusChip({ status }: { status: UserStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} aria-hidden />
      {status}
    </span>
  );
}
