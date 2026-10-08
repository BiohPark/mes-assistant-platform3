import { z } from 'zod'

export const ClassificationSchema = z.object({
  level1: z.string(), level2: z.string(), level1CodeId: z.string().min(1), level2CodeId: z.string().min(1),
}).strict()
export type Classification = z.infer<typeof ClassificationSchema>
const codeName = z.string().transform(value => value.trim().replace(/\s+/gu, ' ').normalize('NFC')).pipe(z.string().min(1).max(191))
const codeId = z.string().trim().min(1).max(191)
export const ClassificationInputSchema = z.union([
  z.object({ level1CodeId: codeId, level2CodeId: codeId }).strict(),
  z.object({ level1: codeName, level2: codeName }).strict(),
])
export const ClassificationsInputSchema = z.array(ClassificationInputSchema).min(1)
export type ClassificationInput = z.infer<typeof ClassificationInputSchema>

export const AssistantSchema = z.object({
  classifications: z.array(ClassificationSchema).min(1).optional(),
  id: z.string(), name: z.string(), level1: z.string(), level2: z.string(),
  level1CodeId: z.string(), level2CodeId: z.string(), summary: z.string(), order: z.number().int(),
  modelId: z.string().optional(), link1: z.string().optional(), docUrl: z.string().optional(),
  expectedInputs: z.array(z.string()), expectedOutputs: z.array(z.string()), ownerId: z.string(),
  status: z.enum(['open', 'developing', 'testing', 'retired']), usageExample: z.string(),
  imageId: z.string().optional(), color: z.string(),
  checklistTemplate: z.array(z.object({ id: z.string(), label: z.string(), required: z.boolean() })),
  createdBy: z.string(), createdAt: z.string(), updatedAt: z.string(), revision: z.number().int(),
}).transform(row => {
  // Legacy single-path DTOs are decoded during the consumer rollout; output is always nonempty.
  const classifications = row.classifications ?? [{ level1: row.level1, level2: row.level2, level1CodeId: row.level1CodeId, level2CodeId: row.level2CodeId }]
  return { ...row, classifications, ...classifications[0]! }
})
export type Assistant = Omit<z.infer<typeof AssistantSchema>, 'classifications'> & { classifications?: Classification[] }

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
  id: z.string(), groupKey: z.string(), code: z.string(), name: z.string(), sortOrder: z.number().int(), active: z.boolean(), isAuto: z.boolean().default(false),
})
export type CatalogCode = z.infer<typeof CodeSchema>
