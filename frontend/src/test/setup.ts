import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// Recharts/ResponsiveContainer needs sizing + matchMedia in jsdom
class ResizeObserverStub {
  observe() { /* noop */ }
  unobserve() { /* noop */ }
  disconnect() { /* noop */ }
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? ResizeObserverStub;

if (!window.matchMedia) {
  window.matchMedia = (q: string) =>
    ({ matches: false, media: q, onchange: null, addEventListener() {},
       removeEventListener() {}, addListener() {}, removeListener() {},
       dispatchEvent() { return false; } }) as any;
}

// Clipboard stub (CopyButton / ApiKeyCreatedModal)
if (!navigator.clipboard) {
  Object.assign(navigator, {
    clipboard: { writeText: () => Promise.resolve() },
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

export { server };
