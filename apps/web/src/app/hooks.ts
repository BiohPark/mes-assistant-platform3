import { useQuery } from '@tanstack/react-query'
import type { Assistant } from '@mes/contracts'
import { listAssistants, listUsers } from '@/lib/catalog'
import { useMe } from './auth'

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: listUsers }).data ?? []
}

export function useUserMap() {
  return new Map(useUsers().map((user) => [user.id, user]))
}

export function useCurrentUserId() { return useMe().id }
export function useCurrentUser() {
  const me = useMe()
  return useUsers().find((user) => user.id === me.id)
}
export function useActor() { return { userId: useCurrentUserId() } }
export function useAssistants() { return useQuery({ queryKey: ['assistants'], queryFn: listAssistants }).data ?? [] }
export function useAssistantMap(): Map<string, Assistant> { return new Map(useAssistants().map((item) => [item.id, item])) }
