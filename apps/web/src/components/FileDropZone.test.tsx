import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FileDropZone, filesFromDataTransfer } from './FileDropZone'

const toastWarning = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { warning: toastWarning } }))
afterEach(() => toastWarning.mockClear())

const fileDrag = (files: File[] = []) => ({ dataTransfer: { types: ['Files'], files, items: [] } })
const textDrag = { dataTransfer: { types: ['text/plain'], files: [], items: [] } }

it('shows an aria-hidden overlay while files are dragged over and hides it when the drag leaves', () => {
  render(<FileDropZone label="놓으면 첨부" onFiles={() => undefined} data-testid="zone"><p>내용</p></FileDropZone>)
  const zone = screen.getByTestId('zone')
  expect(screen.queryByText('놓으면 첨부')).not.toBeInTheDocument()
  fireEvent.dragEnter(zone, fileDrag())
  const overlay = screen.getByText('놓으면 첨부')
  expect(overlay).toHaveAttribute('aria-hidden', 'true')
  expect(overlay.className).not.toMatch(/(?:bg|text|border)-(?:amber|violet|sky|blue|gray)-\d/)
  // 자식 요소를 지나며 enter/leave가 겹쳐도 바깥으로 완전히 나갈 때만 사라진다
  fireEvent.dragEnter(screen.getByText('내용'), fileDrag())
  fireEvent.dragLeave(screen.getByText('내용'), fileDrag())
  expect(screen.getByText('놓으면 첨부')).toBeInTheDocument()
  fireEvent.dragLeave(zone, fileDrag())
  expect(screen.queryByText('놓으면 첨부')).not.toBeInTheDocument()
})

it('ignores drags that carry no files', () => {
  const onFiles = vi.fn()
  render(<FileDropZone label="놓으면 첨부" onFiles={onFiles} data-testid="zone"><p>내용</p></FileDropZone>)
  fireEvent.dragEnter(screen.getByTestId('zone'), textDrag)
  expect(screen.queryByText('놓으면 첨부')).not.toBeInTheDocument()
  fireEvent.drop(screen.getByTestId('zone'), textDrag)
  expect(onFiles).not.toHaveBeenCalled()
})

it('passes dropped files on, closes the overlay, and reports folders and empty files', () => {
  const onFiles = vi.fn()
  render(<FileDropZone label="놓으면 첨부" onFiles={onFiles} data-testid="zone"><p>내용</p></FileDropZone>)
  const zone = screen.getByTestId('zone')
  const note = new File(['abc'], 'note.txt', { type: 'text/plain' })
  const empty = new File([], 'empty.txt', { type: 'text/plain' })
  fireEvent.dragEnter(zone, fileDrag([note, empty]))
  fireEvent.drop(zone, fileDrag([note, empty]))
  expect(onFiles).toHaveBeenCalledWith([note])
  expect(toastWarning).toHaveBeenCalledWith('폴더·빈 파일 1개는 올릴 수 없어 제외했습니다.')
  expect(screen.queryByText('놓으면 첨부')).not.toBeInTheDocument()
})

it('does not call back when every dropped item is rejected', () => {
  const onFiles = vi.fn()
  render(<FileDropZone label="놓으면 첨부" onFiles={onFiles}><p>내용</p></FileDropZone>)
  fireEvent.drop(screen.getByText('내용'), fileDrag([new File([], 'a'), new File([], 'b')]))
  expect(onFiles).not.toHaveBeenCalled()
  expect(toastWarning).toHaveBeenCalledWith('폴더·빈 파일 2개는 올릴 수 없어 제외했습니다.')
})

it('does nothing while disabled', () => {
  const onFiles = vi.fn()
  render(<FileDropZone label="놓으면 첨부" onFiles={onFiles} disabled data-testid="zone"><p>내용</p></FileDropZone>)
  fireEvent.dragEnter(screen.getByTestId('zone'), fileDrag())
  expect(screen.queryByText('놓으면 첨부')).not.toBeInTheDocument()
  fireEvent.drop(screen.getByTestId('zone'), fileDrag([new File(['abc'], 'note.txt')]))
  expect(onFiles).not.toHaveBeenCalled()
  expect(toastWarning).not.toHaveBeenCalled()
})

it('treats a directory entry as rejected even when the browser reports it as a file', () => {
  const folder = new File(['x'], 'folder')
  const note = new File(['abc'], 'note.txt')
  const items = [{ webkitGetAsEntry: () => ({ isDirectory: true }) }, { webkitGetAsEntry: () => ({ isDirectory: false }) }]
  expect(filesFromDataTransfer({ files: [folder, note], items } as unknown as DataTransfer)).toEqual({ files: [note], rejected: 1 })
})
