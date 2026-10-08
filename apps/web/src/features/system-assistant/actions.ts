import { createT, type Translator } from '@/i18n'
import { newId } from '@/lib/ids'
import { normalizeTag } from '@mes/domain'
import { SystemAssistantToolArgs } from '@mes/contracts'
import { createAssistant } from '@/api/admin'
import { addTag, listTasks, startConversation, updateTask, type Actor } from '@/api/tasks'
import { queryClient } from '@/api/queryClient'
import { listAssistants, listUsers } from '@/lib/catalog'

export interface ProposedAction {
  id: string
  name: string
  args: Record<string, unknown>
  summary: string
  invalidReason?: string
  applied?: { ok: boolean; message: string; link?: string }
}

interface ToolCall { id: string; name: string; arguments: string }

const str = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const strList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

export function toProposal(call: ToolCall, t: Translator = createT('ko')): ProposedAction {
  let parsed: unknown
  try {
    parsed = JSON.parse(call.arguments || '{}') as unknown
  } catch { return { id: call.id, name: call.name, args: {}, summary: t('systemAssistant.invalidArgs'), invalidReason: t('systemAssistant.invalidJson') } }
  const schema = SystemAssistantToolArgs[call.name as keyof typeof SystemAssistantToolArgs]
  if (!schema) return { id: call.id, name: call.name, args: {}, summary: t('systemAssistant.invalidTool'), invalidReason: t('systemAssistant.unknownTool', { name: call.name }) }
  const result = schema.safeParse(parsed)
  if (!result.success) return { id: call.id, name: call.name, args: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}, summary: t('systemAssistant.invalidArgs'), invalidReason: result.error.issues.map((issue) => `${issue.path.join('.') || t('systemAssistant.argument')}: ${issue.message}`).join('; ') }
  const args: Record<string, unknown> = result.data
  const tags = strList(args.tags)
  const summaries: Record<string, () => string> = {
    start_conversation: () => `${t('systemAssistant.startSummary', { name: str(args.assistantName) })}${args.title ? ` — "${str(args.title)}"` : ''}${tags.length ? ` · ${t('systemAssistant.summaryTags', { tags: tags.join(', ') })}` : ''}${args.priority ? ` · ${t('systemAssistant.summaryPriority', { priority: str(args.priority) })}` : ''}`,
    create_assistant: () => `${t('admin.createAssistantProposal', { name: str(args.name), level1: str(args.level1), level2: str(args.level2) })}${args.summary ? ` · ${t('systemAssistant.summaryDescription', { value: str(args.summary) })}` : ''}${args.ownerName ? ` · ${t('systemAssistant.summaryOwner', { name: str(args.ownerName) })}` : ''}${args.modelId ? ` · ${t('systemAssistant.summaryModel', { model: str(args.modelId) })}` : ''}`,
    add_tag: () => t('systemAssistant.addTagSummary', { code: str(args.taskCode), tag: normalizeTag(str(args.tag)) }),
  }
  return { id: call.id, name: call.name, args, summary: summaries[call.name]?.() ?? call.name }
}

export async function applyProposal(actor: Actor, proposal: ProposedAction, t: Translator = createT('ko')): Promise<NonNullable<ProposedAction['applied']>> {
  if (proposal.invalidReason) return { ok: false, message: proposal.invalidReason }
  const args = proposal.args
  try {
    switch (proposal.name) {
      case 'start_conversation': {
        const name = str(args.assistantName).trim()
        const all = await listAssistants()
        const want = name.toLowerCase()
        const assistant = name && (all.find((row) => row.name.toLowerCase() === want) ?? all.find((row) => row.name.toLowerCase().includes(want) || want.includes(row.name.toLowerCase())))
        if (!assistant) return { ok: false, message: t('systemAssistant.assistantNotFound', { name }) }
        const { task } = await startConversation(actor, { assistantId: assistant.id, title: str(args.title) || undefined, tags: strList(args.tags) }, `system-assistant:${proposal.id}`)
        const priority = args.priority
        if (priority === 'low' || priority === 'high' || priority === 'urgent') {
          try { await updateTask(task.id, { priority }) }
          catch (error) { return { ok: true, message: t('systemAssistant.priorityFailed', { code: task.code, error: error instanceof Error ? error.message : t('systemAssistant.applyFailed') }), link: `/c/${task.id}` } }
        }
        return { ok: true, message: t('systemAssistant.started', { code: task.code, assistant: assistant.name }), link: `/c/${task.id}` }
      }
      case 'create_assistant': {
        const users = await listUsers()
        const owner = users.find((row) => row.name === str(args.ownerName))
        const created = await createAssistant({
          ...(typeof args.id === 'string' && { id: args.id }), name: str(args.name, '새 에이전트'), level1: str(args.level1), level2: str(args.level2),
          summary: str(args.summary), ownerId: owner?.id ?? actor.userId, status: 'developing', usageExample: '',
          expectedInputs: [], expectedOutputs: [], checklistTemplate: [['입력 자료 선택', true], ['결과 검토', true], ['산출물 저장', false]].map(([label, required]) => ({ id: newId(), label: String(label), required: Boolean(required) })), modelId: str(args.modelId) || undefined,
        })
        void queryClient.invalidateQueries({ queryKey: ['assistants'] })
        void queryClient.invalidateQueries({ queryKey: ['managed-codes'] })
        return { ok: true, message: t('systemAssistant.assistantCreated', { name: created.name }), link: '/assistants/manage' }
      }
      case 'add_tag': {
        const code = str(args.taskCode)
        const task = (await listTasks()).find((row) => row.code === code)
        if (!task) return { ok: false, message: t('systemAssistant.conversationNotFound', { code }) }
        const tag = normalizeTag(str(args.tag))
        if (!tag) return { ok: false, message: t('systemAssistant.emptyTag') }
        if (task.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) return { ok: true, message: t('systemAssistant.tagExists', { code, tag }), link: `/c/${task.id}` }
        await addTag(actor, task.id, tag)
        return { ok: true, message: t('systemAssistant.tagAdded', { code, tag }), link: `/c/${task.id}` }
      }
      default: return { ok: false, message: t('systemAssistant.unknownTool', { name: proposal.name }) }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : t('systemAssistant.applyFailed') }
  }
}
