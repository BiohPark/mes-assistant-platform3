import { ThemeProvider } from 'next-themes'
import { ProfileProvider } from '@/app/profile'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

export function renderWithProviders(ui: ReactNode, { route = '/' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="mes-theme"><ProfileProvider><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></ProfileProvider></ThemeProvider>
    </QueryClientProvider>,
  )
}

export function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
