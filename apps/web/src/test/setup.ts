import '@testing-library/jest-dom/vitest'

Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, addListener() {}, removeListener() {} }) })

// jsdom has no layout observer; Radix form controls measure their hidden inputs.
Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} })
