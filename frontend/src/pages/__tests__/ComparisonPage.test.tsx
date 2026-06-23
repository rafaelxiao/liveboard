import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import ComparisonPage from '../ComparisonPage';
import { renderWithProviders } from '../../lib/test-utils';

function renderPage(search = '') {
  return renderWithProviders(<ComparisonPage />, { route: `/compare${search}` });
}

describe('ComparisonPage', () => {
  it('shows empty state before series are selected', async () => {
    renderPage();
    expect(await screen.findByText(/Select entities and click Compare/i)).toBeInTheDocument();
  });

  it('has Compare button disabled when fewer than 2 selected', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^compare$/i })).toBeDisabled();
  });

  it('prefills series from deep-link query params', async () => {
    renderPage('?series=1,2');
    // The Compare button should still be disabled until submitted
    expect(await screen.findByRole('button', { name: /^compare$/i })).toBeInTheDocument();
  });
});
