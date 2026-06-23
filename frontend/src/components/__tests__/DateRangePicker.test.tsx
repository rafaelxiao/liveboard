import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateRangePicker from '../DateRangePicker';

describe('DateRangePicker', () => {
  it('clears the range when "All" preset is chosen', async () => {
    const onChange = vi.fn();
    render(<DateRangePicker from="2026-01-01" to="2026-06-18" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /^all$/i }));
    expect(onChange).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });
});
