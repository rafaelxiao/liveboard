import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../../test/server';
import SeriesListPage from '../SeriesListPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/series']}>
        <SeriesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SeriesListPage create form (L2)', () => {
  it('requires base_currency and session_tz before submit is enabled', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /new series/i }));
    const submit = screen.getByRole('button', { name: /create/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/name/i), 'New-Book');
    expect(submit).toBeDisabled(); // currency + tz still required
    await userEvent.selectOptions(screen.getByLabelText(/base currency/i), 'USD');
    await userEvent.selectOptions(screen.getByLabelText(/time zone/i), 'America/New_York');
    expect(submit).toBeEnabled();
  });

  it('posts base_currency and session_tz and refreshes the list', async () => {
    let body: any = null;
    server.use(http.post('/api/series', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ series_id: 99 }, { status: 201 });
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /new series/i }));
    await userEvent.type(screen.getByLabelText(/name/i), 'New-Book');
    await userEvent.selectOptions(screen.getByLabelText(/base currency/i), 'EUR');
    await userEvent.selectOptions(screen.getByLabelText(/time zone/i), 'Europe/London');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(body).toMatchObject({
      name: 'New-Book', base_currency: 'EUR', session_tz: 'Europe/London',
    }));
  });
});
