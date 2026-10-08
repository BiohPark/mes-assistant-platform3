import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { IoBadges } from './StatusBadges'
import { TooltipProvider } from './ui/tooltip'

it('limits I/O badges to two plus the remaining count and reveals every value on keyboard focus', async () => {
  render(<TooltipProvider><IoBadges inputs={['First', 'Second', 'Third', 'Fourth']} outputs={[]} /></TooltipProvider>)
  expect(screen.getByText('+2')).toBeInTheDocument()
  expect(screen.queryByText('Third')).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.tab()
  expect(await screen.findByRole('tooltip')).toHaveTextContent('First, Second, Third, Fourth')
  expect(within(screen.getByLabelText('입력: First, Second, Third, Fourth')).getAllByText(/First|Second/)).toHaveLength(2)
})
