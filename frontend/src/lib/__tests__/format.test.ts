import { describe, expect, it } from 'vitest';
import {
  formatCurrency, formatPercent, formatRatio, formatSeconds,
  glyphFor, pnlClassFor,
} from '../format';

describe('format', () => {
  it('formats a decimal string as base currency, preserving sign', () => {
    expect(formatCurrency('48210.00', 'USD')).toBe('$48,210.00');
    expect(formatCurrency('-9100.00', 'USD')).toBe('-$9,100.00');
    expect(formatCurrency('1000.00', 'EUR')).toMatch(/€|EUR/);
  });

  it('formats a ratio string as a percent', () => {
    expect(formatPercent('0.142')).toBe('14.2%');
    expect(formatPercent('0.572')).toBe('57.2%');
  });

  it('formats a ratio to fixed decimals', () => {
    expect(formatRatio('1.84')).toBe('1.84');
  });

  it('formats seconds as h/m', () => {
    expect(formatSeconds(11520)).toBe('3h 12m');
  });

  it('chooses glyph from sign only', () => {
    expect(glyphFor(1)).toBe('▲');
    expect(glyphFor(-1)).toBe('▼');
    expect(glyphFor(0)).toBe('');
  });

  it('maps sign to gain/loss/neutral class regardless of scheme (hue resolved by CSS)', () => {
    expect(pnlClassFor('48210.00', 'red-up')).toBe('text-pnl-gain');
    expect(pnlClassFor('48210.00', 'green-up')).toBe('text-pnl-gain');
    expect(pnlClassFor('-9100.00', 'red-up')).toBe('text-pnl-loss');
    expect(pnlClassFor('0', 'red-up')).toBe('text-pnl-neutral');
  });

});

