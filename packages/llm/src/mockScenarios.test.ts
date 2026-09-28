import { describe, it, expect } from 'vitest'
import { isStartMessage, scenarioFor, startReply } from './mockScenarios.js'

describe('mock scenarios', () => {
  it('detects start messages', () => {
    expect(isStartMessage('시작')).toBe(true)
    expect(isStartMessage(' 안녕하세요! ')).toBe(true)
    expect(isStartMessage('시작 전에 URS 정리해줘')).toBe(false)
  })
  it('asks agent-specific opening questions', () => {
    expect(startReply('deviation-drafter', 'Deviation', 'Deviation 초안 도우미')).toContain('즉시 조치 여부')
    expect(startReply('cc-item-builder', 'Change Control(CC) Item', 'X')).toContain('대상 CC 번호')
    expect(startReply('unknown', '기타', 'X')).toContain('작업 목적')
  })
  it('routes catalog agents to matching scenarios (db compare is not FDS)', () => {
    expect(scenarioFor('deploy-verifier', '배포')).toBe(scenarioFor('deploy', '배포'))
    expect(scenarioFor('cc-item-builder', 'Change Control(CC) Item')).not.toBe(scenarioFor('cc-writer', 'Change Control(CC)'))
  })
})
