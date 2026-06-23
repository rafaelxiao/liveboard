import { Moon, Sun } from "lucide-react";

import { useThemeStore } from "../state/themeStore";

export default function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch theme (current: ${theme})`}
      className="rounded-md p-2 text-secondary hover:bg-surface-2"
    >
      {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
