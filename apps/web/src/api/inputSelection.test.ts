import { expect, it } from 'vitest'
import { inputSelection, lockInputSend, saveInputSelection } from './inputSelection'

it('locks by conversation through saving and refresh, including overlapping operations and failures', async () => {
  let finish!: () => void
  const first = saveInputSelection('t', () => new Promise<void>(resolve => { finish = resolve }))
  expect(inputSelection.getState().byTask.t?.pending).toBe(1)
  const other = saveInputSelection('other', async () => {})
  await expect(saveInputSelection('t', async () => { throw new Error('failed') })).rejects.toThrow('failed')
  expect(inputSelection.getState().byTask.t?.pending).toBe(1)
  finish()
  await Promise.all([first, other])
  expect(inputSelection.getState().byTask.t).toMatchObject({ pending: 0, revision: 2 })
})

it('keeps selections stable through async preflight and submission and releases on completion', async () => {
  const release = lockInputSend('send-lock')!
  expect(release).toBeTypeOf('function')
  expect(lockInputSend('send-lock')).toBeUndefined()
  await expect(saveInputSelection('send-lock', async () => {})).rejects.toThrow('MATERIALS_SENDING')
  release()
  await expect(saveInputSelection('send-lock', async () => 1)).resolves.toBe(1)
})
