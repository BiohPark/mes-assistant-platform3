import { normalizeTag } from '@mes/domain'
import { createAssistant } from '@/api/admin'
import { addTag, listTasks, startConversation, updateTask, type Actor } from '@/api/tasks'
import { queryClient } from '@/api/queryClient'
import { listAssistants, listCodes, listUsers } from '@/lib/catalog'

export interface ProposedAction {
  id: string
  name: string
  args: Record<string, unknown>
  summary: string
  applied?: { ok: boolean; message: string; link?: string }
}

interface ToolCall { id: string; name: string; arguments: string }

const str = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const strList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

export function toProposal(call: ToolCall): ProposedAction {
  let args: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(call.arguments || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
  } catch { /* 잘못된 도구 인자는 빈 값으로 표시 */ }
  const tags = strList(args.tags)
  const summaries: Record<string, () => string> = {
    start_conversation: () => `대화 시작: ${str(args.assistantName, '?')}${args.title ? ` — "${str(args.title)}"` : ''}${tags.length ? ` · 태그 ${tags.join(', ')}` : ''}`,
    create_assistant: () => `에이전트 등록: ${str(args.name)} (${str(args.id)}) — ${str(args.level1)} › ${str(args.level2)}`,
    add_tag: () => `태그 추가: ${str(args.taskCode)} ← ${normalizeTag(str(args.tag))}`,
  }
  return { id: call.id, name: call.name, args, summary: summaries[call.name]?.() ?? call.name }
}

export async function applyProposal(actor: Actor, proposal: ProposedAction): Promise<NonNullable<ProposedAction['applied']>> {
  const args = proposal.args
  try {
    switch (proposal.name) {
      case 'start_conversation': {
        const name = str(args.assistantName).trim()
        const all = await listAssistants()
        const want = name.toLowerCase()
        const assistant = name && (all.find((row) => row.name.toLowerCase() === want) ?? all.find((row) => row.name.toLowerCase().includes(want) || want.includes(row.name.toLowerCase())))
        if (!assistant) return { ok: false, message: `"${name}" 에이전트를 찾을 수 없습니다.` }
        const { task } = await startConversation(actor, { assistantId: assistant.id, title: str(args.title) || undefined, tags: strList(args.tags) })
        const priority = args.priority
        if (priority === 'low' || priority === 'high' || priority === 'urgent') {
          try { await updateTask(task.id, { priority }) }
          catch (error) { return { ok: true, message: `${task.code} 대화를 시작했지만 우선순위를 반영하지 못했습니다: ${error instanceof Error ? error.message : '적용 실패'}`, link: `/c/${task.id}` } }
        }
        return { ok: true, message: `${task.code} 대화를 ${assistant.name}와 시작했습니다.`, link: `/c/${task.id}` }
      }
      case 'create_assistant': {
        const [codes, users] = await Promise.all([listCodes(), listUsers()])
        const findCode = (group: string, value: string) => codes.find((row) => row.groupKey === group && [row.id, row.code, row.name].some((candidate) => candidate.toLowerCase() === value.toLowerCase()))
        const level1 = findCode('assistant_level1', str(args.level1))
        const level2 = findCode('assistant_level2', str(args.level2))
        if (!level1 || !level2) return { ok: false, message: '분류 코드를 찾을 수 없습니다. 관리에서 분류를 확인하세요.' }
        const owner = users.find((row) => row.name === str(args.ownerName))
        const created = await createAssistant({
          id: str(args.id), name: str(args.name, '새 에이전트'), level1CodeId: level1.id, level2CodeId: level2.id,
          summary: str(args.summary), ownerId: owner?.id ?? actor.userId, status: 'developing', usageExample: '',
          expectedInputs: [], expectedOutputs: [], checklistTemplate: [['입력 자료 선택', true], ['결과 검토', true], ['산출물 저장', false]].map(([label, required]) => ({ id: crypto.randomUUID(), label: String(label), required: Boolean(required) })), modelId: str(args.modelId) || undefined,
        })
        void queryClient.invalidateQueries({ queryKey: ['assistants'] })
        return { ok: true, message: `"${created.name}" 에이전트를 카탈로그 끝에 등록했습니다. 관리에서 모델·링크를 매핑하세요.`, link: '/assistants/manage' }
      }
      case 'add_tag': {
        const code = str(args.taskCode)
        const task = (await listTasks()).find((row) => row.code === code)
        if (!task) return { ok: false, message: `대화 ${code}를 찾을 수 없습니다.` }
        const tag = normalizeTag(str(args.tag))
        if (!tag) return { ok: false, message: '태그가 비어 있습니다.' }
        if (task.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) return { ok: true, message: `${code}에는 이미 ${tag} 태그가 있습니다.`, link: `/c/${task.id}` }
        await addTag(actor, task.id, tag)
        return { ok: true, message: `${code}에 ${tag} 태그를 붙였습니다.`, link: `/c/${task.id}` }
      }
      default: return { ok: false, message: `알 수 없는 도구: ${proposal.name}` }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '적용 실패' }
  }
}
