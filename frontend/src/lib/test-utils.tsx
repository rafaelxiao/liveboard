import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/index";

interface RenderOptions {
  route?: string;
  wrapper?: (children: ReactNode) => ReactElement;
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const { route = "/", wrapper } = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const inner = wrapper ? wrapper(ui) : ui;
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[route]}>{inner}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}
