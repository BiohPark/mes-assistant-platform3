import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { renderWithProviders, jsonResponse } from '@/test/render'
import { ModelPicker } from './ModelPicker'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
const assistant = { id: 'a', name: '도우미', modelId: 'default-model' } as Assistant
afterEach(() => vi.unstubAllGlobals())

it('writes a selected model to the task and leaves the thread untouched', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['chosen-model'] })
    return jsonResponse(200, {})
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><ModelPicker task={task} assistant={assistant} /></MeContext>)
  fireEvent.click(screen.getByTitle('이 대화의 모델 변경'))
  fireEvent.click(await screen.findByRole('button', { name: 'chosen-model' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t' && init?.method === 'PATCH' && JSON.parse(String(init.body)).modelId === 'chosen-model')).toBe(true))
  expect(calls.some(([url]) => url.includes('/threads/'))).toBe(false)
})

it('shows the server default model when neither task nor assistant selects one', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/settings') return jsonResponse(200, { defaultModel: 'server-default' })
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['server-default'] })
    return jsonResponse(404)
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><ModelPicker task={task} assistant={{ ...assistant, modelId: undefined }} /></MeContext>)
  await waitFor(() => expect(screen.getByTitle('이 대화의 모델 변경')).toHaveTextContent('server-default'))
  expect(screen.getByTitle('이 대화의 모델 변경')).toHaveTextContent('공통 기본 모델')
})
