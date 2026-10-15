import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { HelpTip } from './HelpTip'

it('긴 설명은 접근 가능한 이름의 작은 아이콘 뒤 툴팁으로 둔다(공급자 없이도 동작)', async () => {
  render(<HelpTip text="첨부는 한 번만 갑니다" />)
  const trigger = screen.getByRole('button', { name: '첨부는 한 번만 갑니다' })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  await userEvent.hover(trigger)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('첨부는 한 번만 갑니다')
})
