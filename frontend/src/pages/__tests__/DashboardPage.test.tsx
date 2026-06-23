import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../DashboardPage';

function renderPage(search = '?series=1&level=account') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/dashboard${search}`]}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  it('renders series overview when no series param', async () => {
    renderPage('');
    expect(await screen.findByText(/no series yet/i)).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching', () => {
    renderPage();
    // Should render the controls bar (date picker) immediately while data loads
    expect(screen.getByText(/1W/i)).toBeInTheDocument();
  });
});
