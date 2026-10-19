import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from './openaiProvider.js'

const provider = new OpenAICompatibleProvider({ mode: 'live', baseUrl: 'https://upstream.example/v1', apiKey: 'top-secret', model: 'example' })
afterEach(() => vi.unstubAllGlobals())

describe('OpenAICompatibleProvider models', () => {
  it('200 응답의 data 누락은 ping과 목록에서 형식 오류다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    expect(await provider.ping()).toEqual({ ok: false, detail: '응답 형식 오류' })
    await expect(provider.listModels()).rejects.toThrow('응답 형식 오류')
  })
  it('문자열이 아닌 모델 id도 형식 오류다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 123 }] }), { status: 200 })))
    expect(await provider.ping()).toEqual({ ok: false, detail: '응답 형식 오류' })
    await expect(provider.listModels()).rejects.toThrow('응답 형식 오류')
  })
  it('500 응답은 두 경로 모두 실패하고 본문을 노출하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('top-secret https://upstream.example/v1', { status: 500 })))
    expect(await provider.ping()).toEqual({ ok: false, detail: 'HTTP 500' })
    await expect(provider.listModels()).rejects.toMatchObject({ message: 'HTTP 500' })
  })
  it('네트워크 예외는 목록에서 고정 오류를 낸다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('top-secret https://upstream.example/v1') }))
    await expect(provider.listModels()).rejects.toMatchObject({ message: '모델 목록 네트워크 오류' })
  })
  it('정상 data에서 id 목록을 반환한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'fake-general' }, { id: 'fake-writer' }] }), { status: 200 })))
    expect(await provider.ping()).toEqual({ ok: true, detail: '모델 2개 확인' })
    expect(await provider.listModels()).toEqual(['fake-general', 'fake-writer'])
  })
})

function sseResponse(frames: string[], extra: { cancel?: () => void } = {}) {
  const encoder = new TextEncoder()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= frames.length) { controller.close(); return }
      controller.enqueue(encoder.encode(frames[index++]!))
    },
    cancel: extra.cancel,
  }, { highWaterMark: 0 })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
async function collect(iterable: AsyncIterable<{ type: string }>) {
  const out: Array<{ type: string }> = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

describe('OpenAICompatibleProvider limits', () => {
  it('ping·listModels는 리다이렉트를 차단하고 location을 노출하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 307, headers: { location: 'https://evil.example/top-secret' } })))
    const ping = await provider.ping()
    expect(ping.ok).toBe(false)
    expect(ping.detail).not.toMatch(/evil|top-secret|HTTP 307/)
    await expect(provider.listModels()).rejects.toMatchObject({ message: ping.detail })
  })
  it('listModels는 응답 상한을 넘으면 절단하지 않고 실패한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"data":[' + '{"id":"m"},'.repeat(600_000) + '{"id":"z"}]}', { status: 200 })))
    await expect(provider.listModels()).rejects.toMatchObject({ message: '응답 크기 한도 초과' })
  })
  it('stream은 limits.timeoutMs를 넘기면 시간 초과 오류 청크를 낸다', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], limits: { timeoutMs: 20 } }))
    expect(chunks).toEqual([{ type: 'error', message: '응답 시간 초과' }])
  })
  it('stream은 SSE 프레임이 maxFrameBytes를 넘으면 명시적으로 실패하고 읽기를 중단한다', async () => {
    const cancel = vi.fn()
    const huge = `data: {"choices":[{"delta":{"content":"${'x'.repeat(200)}`
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', huge, 'y'.repeat(50)], { cancel })))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], limits: { maxFrameBytes: 128 } }))
    expect(chunks).toEqual([{ type: 'delta', text: 'ok' }, { type: 'error', message: '응답 프레임 크기 초과' }])
    expect(cancel).toHaveBeenCalled()
  })
  it('limits가 없으면(일반 채팅) 큰 SSE 프레임도 그대로 통과한다 — OpenWebUI RAG sources 프레임', async () => {
    const big = 'y'.repeat(1_500_000)
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([`data: {"sources":[{"document":["${big}"]}],"choices":[{"delta":{"content":"ok"}}]}\n\n`, 'data: [DONE]\n\n'])))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
    expect(chunks).toEqual([{ type: 'delta', text: 'ok' }, { type: 'done' }])
    const limited = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], limits: { maxFrameBytes: 64 * 1024 } }))
    expect(limited).toEqual([{ type: 'error', message: '응답 프레임 크기 초과' }])
  })
  it('stream은 limits.maxResponseBytes를 넘으면 실패하고 chat/completions도 redirect: manual로 부른다', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"more"}}]}\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], limits: { maxResponseBytes: 60 } }))
    expect(chunks).toEqual([{ type: 'delta', text: 'ok' }, { type: 'error', message: '응답 크기 한도 초과' }])
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/chat\/completions$/), expect.objectContaining({ redirect: 'manual' }))
  })
  it('stream은 리다이렉트 응답을 오류 청크로 바꾼다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/top-secret' } })))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ type: 'error' })
    expect(JSON.stringify(chunks)).not.toMatch(/evil|top-secret|302/)
  })
  it('[DONE] 뒤 연결이 열려 있어도(OpenWebUI outlet 필터 대기) 바로 끝낸다 — middleware.py 6748-6760', async () => {
    const encoder = new TextEncoder()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"끝"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n'))
      },
      cancel,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
    expect(chunks).toEqual([{ type: 'delta', text: '끝' }, { type: 'tool_call', call: { id: 'c1', name: 'f', arguments: '{}' } }, { type: 'done' }])
    expect(cancel).toHaveBeenCalled()
  })
  it('stream 기본 동작은 그대로다 — 델타·툴콜·done', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"안녕"}}]}\n\n', 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{}"}}]}}]}\n\n', 'data: [DONE]\n\n'])))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
    expect(chunks).toEqual([{ type: 'delta', text: '안녕' }, { type: 'tool_call', call: { id: 'c1', name: 'f', arguments: '{}' } }, { type: 'done' }])
  })
})

it('streams explicit reasoning and split think tags while skipping sources and malformed frames', async () => {
  const frames = [{ sources: [] }, { choices: [null] }, { choices: [{ delta: { reasoning_content: '첫 ' } }] }, { choices: [{ delta: { reasoning: '생각' } }] },
    ...['<thi', 'nk>검토</th', 'ink>최종 답'].map(content => ({ choices: [{ delta: { content } }] }))]
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`))))
  const chunks = await collect(provider.stream({ model: 'm', messages: [] }))
  expect(chunks).toEqual([{ type: 'reasoning', text: '첫 ' }, { type: 'reasoning', text: '생각' }, { type: 'reasoning', text: '\n검토' }, { type: 'delta', text: '최종 답' }, { type: 'done' }])
})

it('streams direct think/text/tool/text steps without moving fragmented calls to the end', async () => {
  const onStep = vi.fn()
  const frame = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
    frame({ content: '<think>검토</think>먼저' }),
    frame({ tool_calls: [{ index: 0, id: 'a', function: { name: 'lookup', arguments: '{"q":' } }] }),
    frame({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }),
    frame({ content: '나중' }), 'data: [DONE]\n\n',
  ])))
  await collect(provider.stream({ model: 'm', messages: [], onStep }))
  const latest = new Map(onStep.mock.calls.map(([index, step]) => [index, step]))
  expect([...latest].map(([index, step]) => [index, step.type])).toEqual([[0, 'reasoning'], [1, 'text'], [2, 'tool'], [3, 'text']])
  expect(latest.get(2)).toMatchObject({ name: 'lookup', input: '{"q":1}' })
})

it('retains direct sources frames without choices as ordered tool results', async () => {
  const onStep = vi.fn()
  const source = { source: { name: 'lookup' }, document: ['원문 검색 결과'], metadata: [{ url: 'https://example.test' }] }
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"앞"}}]}\n\n',
    `data: ${JSON.stringify({ sources: [source] })}\n\n`,
    'data: {"choices":[{"delta":{"content":"뒤"}}]}\n\ndata: [DONE]\n\n',
  ])))
  await collect(provider.stream({ model: 'm', messages: [], onStep }))
  expect(onStep.mock.calls.map(([index, step]) => [index, step.type])).toEqual([[0, 'text'], [1, 'tool'], [2, 'text']])
  expect(onStep.mock.calls[1]?.[1]).toMatchObject({ name: 'lookup', output: JSON.stringify(source), status: 'done', source: true })
})

it('marks in-flight direct tools as errored if the stream fails', async () => {
  const onStep = vi.fn()
  let sent = false
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull(controller) {
    if (sent) { controller.error(new Error('upstream lost')); return }
    sent = true
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"lookup","arguments":"{}"}}]}}]}\n\n'))
  } }))))
  const chunks = await collect(provider.stream({ model: 'm', messages: [], onStep }))
  expect(chunks.at(-1)?.type).toBe('error')
  expect(onStep.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'tool', status: 'error' })
})

it('parses fragmented direct details and think wrappers and captures bounded first/last raw frames', async () => {
  const fragments = ['before<det', 'ails type="reasoning" done="true"><summary>Think</summary>private</details>', '<details type="code_interpreter" done="true"><summary>Run</summary>\n```sh\necho hi\n```\n```output\nhi\n```\n</details>', '<think>more thinking</think>answer']
  const frames = fragments.map(content => JSON.stringify({ choices: [{ delta: { content } }] }))
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse([...frames.map(frame => `data: ${frame}\n\n`), 'data: [DONE]\n\n'])))
  const steps: import('@mes/domain').AnswerStep[] = []
  const onRawResponse = vi.fn()
  const chunks = await collect(provider.stream({ model: 'm', messages: [], owuiTools: 'off', owuiMode: 'direct', onRawResponse,
    onStep: (index, step, count) => { steps[index] = step; if (count !== undefined) steps.length = count } }))
  expect(chunks.at(-1)).toEqual({ type: 'done' })
  expect(steps.map(s => s.type)).toEqual(['text', 'reasoning', 'code', 'reasoning', 'text'])
  expect(steps[0]).toMatchObject({ text: 'before' })
  expect(steps[2]).toMatchObject({ code: 'echo hi', output: 'hi', status: 'done' })
  expect(steps.at(-1)).toMatchObject({ text: 'answer' })
  expect(onRawResponse).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'direct', frameCount: 5, firstFrames: [...frames, '[DONE]'], lastFrames: [] }))
})

describe('direct markup parsing stays incremental', () => {
  const run = async (fragments: string[]) => {
    const frames = fragments.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([frames.join('') + 'data: [DONE]\n\n'])))
    const steps: import('@mes/domain').AnswerStep[] = []
    const chunks = await collect(provider.stream({ model: 'm', messages: [], owuiTools: 'off', owuiMode: 'direct',
      onStep: (index, step, count) => { steps[index] = step; if (count !== undefined) steps.length = count } }))
    expect(chunks.at(-1)).toEqual({ type: 'done' })
    return steps
  }
  it('ends with the same steps as parsing the whole content, however the stream is cut', async () => {
    const { contentSteps } = await import('./contentSteps.js')
    const full = 'a <b> 앞\n<think>생각 <i>x</i></think>\n```\n<details type="reasoning">literal</details>\n```\n<details type="code_interpreter" done="true"><summary>Run</summary>\n```sh\necho 1\n```\n```output\n1\n```\n</details>\n<det 아님 < 끝 <details type="tool_calls" done="true" name="t" arguments="{}" result="r"></details>마지막'
    for (const size of [1, 2, 3, 5, 7, 11, full.length]) {
      const fragments: string[] = []
      for (let i = 0; i < full.length; i += size) fragments.push(full.slice(i, i + size))
      expect(await run(fragments)).toEqual(contentSteps(full))
    }
  })
  it('matches whole-content parsing for open reasoning with whitespace, quotes, entities and fences, however cut', async () => {
    const { contentSteps } = await import('./contentSteps.js')
    const samples = [
      '<think>  첫 생각  \n\n 둘째 &amp; 셋째 &am p;  </think>답',
      '앞<details type="reasoning" done="false"><summary>T</summary>\n> 인용 줄\n> 둘째\n평문 줄\n</details>뒤',
      '<think>코드 ```\n</think> 펜스 안\n``` 끝 ~~~ \t </think>본문',
      '<details type="reasoning" done="true"><summary>생각 중</summary>\n긴 생각 a b c   ',
    ]
    for (const full of samples) for (const size of [1, 2, 3, 4, 7]) {
      const fragments: string[] = []
      for (let i = 0; i < full.length; i += size) fragments.push(full.slice(i, i + size))
      expect(await run(fragments)).toEqual(contentSteps(full))
    }
  })
  it('streams a long open reasoning block in small deltas without re-reading it per delta', async () => {
    const body = '생각 줄 abc 계속\n'.repeat(10_000)
    const fragments: string[] = []
    const full = `<think>${body}</think>답`
    for (let i = 0; i < full.length; i += 4) fragments.push(full.slice(i, i + 4))
    const started = performance.now()
    expect(await run(fragments)).toEqual([{ type: 'reasoning', text: body.trim() }, { type: 'text', text: '답' }])
    expect(performance.now() - started).toBeLessThan(5_000)
  }, 60_000)
  it('handles a long plain answer in small deltas without re-reading everything per delta', async () => {
    const full = '가나다라 abc <b>\n'.repeat(20_000)
    const fragments: string[] = []
    for (let i = 0; i < full.length; i += 4) fragments.push(full.slice(i, i + 4))
    const started = performance.now()
    expect(await run(fragments)).toEqual([{ type: 'text', text: full }])
    expect(performance.now() - started).toBeLessThan(5_000)
  }, 60_000)
})
