import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { Assistant, CatalogCode } from '@mes/contracts'
import { CodeInput } from '@/components/CodeInput'

const codes: CatalogCode[] = [
  { id: 'popular', groupKey: 'assistant_level2', code: 'P', name: 'Popular', active: true, sortOrder: 1, isAuto: false },
  { id: 'paired', groupKey: 'assistant_level2', code: 'T', name: 'Together', active: true, sortOrder: 2, isAuto: false },
]
it('counts distinct assistants across all paths and recommends Lv2 only from a matching pair', async () => {
  const assistants = [
    { level1: 'Selected', level2CodeId: 'popular', classifications: [
      { level1: 'Selected', level2: 'Other', level1CodeId: 's', level2CodeId: 'other' },
      { level1: 'Other', level2: 'Popular', level1CodeId: 'o', level2CodeId: 'popular' },
      { level1: 'Third', level2: 'Popular', level1CodeId: 't', level2CodeId: 'popular' },
    ] },
    { level1: 'Other', level2CodeId: 'popular', classifications: [
      { level1: 'Other', level2: 'Popular', level1CodeId: 'o', level2CodeId: 'popular' },
      { level1: 'Selected', level2: 'Together', level1CodeId: 's', level2CodeId: 'paired' },
    ] },
  ] as Assistant[]
  render(<CodeInput group="assistant_level2" codes={codes} assistants={assistants} level1="Selected" value="" onChange={() => undefined} aria-label="Code" />)
  fireEvent.focus(screen.getByRole('combobox'))
  expect((await screen.findAllByRole('option')).map(option => option.textContent)).toEqual(['Together사용 1', 'Popular사용 2'])
})
