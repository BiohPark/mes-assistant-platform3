import { ThemeProvider } from 'next-themes'
import { ProfileProvider } from './app/profile'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import './index.css'
import { router } from './app/router'
import { queryClient } from './api/queryClient'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="mes-theme">
        <ProfileProvider><RouterProvider router={router} /></ProfileProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
