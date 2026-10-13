import type { PendingAttachment } from './Composer'

/** 빠른 전환으로 떠난 대화의 입력창 상태. 메모리에만 두어 새로고침하면 사라지고, 로그아웃하면 비운다 */
export interface ComposerDraft {
  text: string
  pending: PendingAttachment[]
  discussion: boolean
}

const drafts = new Map<string, ComposerDraft>()

export const getDraft = (key: string) => drafts.get(key)
export function setDraft(key: string, draft: ComposerDraft) {
  if (!draft.text && !draft.pending.length && !draft.discussion) drafts.delete(key)
  else drafts.set(key, draft)
}
export const clearDrafts = () => drafts.clear()

let owner: string | undefined
/** 로그인 사용자가 바뀌면(세션 만료 뒤 같은 탭에서 다른 계정 로그인) 이전 사용자의 초안을 폐기한다. 같은 사용자면 유지 */
export function bindDraftsToUser(userId: string) {
  if (owner !== undefined && owner !== userId) drafts.clear()
  owner = userId
}
