import { z } from 'zod'

export const AssistantSchema = z.object({
  id: z.string(), name: z.string(), level1: z.string(), level2: z.string(),
  level1CodeId: z.string(), level2CodeId: z.string(), summary: z.string(), order: z.number().int(),
  modelId: z.string().optional(), link1: z.string().optional(), docUrl: z.string().optional(),
  expectedInputs: z.array(z.string()), expectedOutputs: z.array(z.string()), ownerId: z.string(),
  status: z.enum(['open', 'developing', 'testing', 'retired']), usageExample: z.string(),
  imageId: z.string().optional(), color: z.string(),
  checklistTemplate: z.array(z.object({ id: z.string(), label: z.string(), required: z.boolean() })),
  createdBy: z.string(), createdAt: z.string(), updatedAt: z.string(), revision: z.number().int(),
})
export type Assistant = z.infer<typeof AssistantSchema>

export const AssistantStatsSchema = z.object({
  assistantId: z.string(), open: z.number().int(), inProgress: z.number().int(),
  onHold: z.number().int(), done: z.number().int(),
})
export type AssistantStats = z.infer<typeof AssistantStatsSchema>

export const CatalogUserSchema = z.object({
  id: z.string(), name: z.string(), initials: z.string(), color: z.string(),
  isSystemOwner: z.boolean(), isBusinessOwner: z.boolean(),
})
export type CatalogUser = z.infer<typeof CatalogUserSchema>

export const CodeSchema = z.object({
  id: z.string(), groupKey: z.string(), code: z.string(), name: z.string(), sortOrder: z.number().int(), active: z.boolean(),
})
export type CatalogCode = z.infer<typeof CodeSchema>
