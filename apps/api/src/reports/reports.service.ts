import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { assistantStats, completionBuckets, feedbackDigest, inefficiencySignals, inputFlow, srLeadDays, srStatusDistribution, tagUsage, userActivityStats, type ActivityLog, type Assistant, type Granularity, type ServiceRequest, type User } from '@mes/domain'
import { asc, eq, isNull } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { activityLog, appUser, assistant, fileObject, serviceRequest } from '../db/schema.js'
import { DbTasksService } from '../tasks/tasks.service.js'

@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(DbTasksService) private readonly tasks: DbTasksService) {}

  async get(days: number, granularity: Granularity, actor: string, userId?: string) {
    const [viewer] = await this.db.select({ isBusinessOwner: appUser.isBusinessOwner, isSystemOwner: appUser.isSystemOwner }).from(appUser).where(eq(appUser.id, actor))
    if (!viewer || (viewer.isBusinessOwner && !viewer.isSystemOwner)) throw new ForbiddenException('리포트 권한이 없습니다')
    const [allTasks, activities, files, srs, assistants, users] = await Promise.all([
      this.tasks.list(),
      this.db.select().from(activityLog).orderBy(asc(activityLog.at)),
      this.db.select({ id: fileObject.id, name: fileObject.originalName, version: fileObject.version,
        previousId: fileObject.previousId, originTaskId: fileObject.originTaskId }).from(fileObject).where(isNull(fileObject.deletedAt)),
      this.db.select().from(serviceRequest),
      this.db.select().from(assistant),
      this.db.select().from(appUser),
    ])
    const tasks = userId ? allTasks.filter((row) => row.ownerId === userId || row.assigneeIds.includes(userId)) : allTasks
    const taskIds = new Set(tasks.map((row) => row.id))
    const activity: ActivityLog[] = activities.filter((row) => !row.taskId || taskIds.has(row.taskId)).map((row) => ({ id: row.id, type: row.type as ActivityLog['type'], userId: row.userId,
      ...(row.taskId && { taskId: row.taskId }), ...(row.assistantId && { assistantId: row.assistantId }),
      ...(row.srId && { srId: row.srId }), payload: row.payload as Record<string, unknown>, at: row.at.toISOString() }))
    const completedAt = new Map<string, string>()
    for (const row of activity) if (row.type === 'task.completed' && row.taskId) completedAt.set(row.taskId, row.at)
    const reportTasks = tasks.map((row) => row.status === 'done' && completedAt.has(row.id)
      ? { ...row, completedAt: completedAt.get(row.id)! } : row)
    const fileRows = files.map((row) => ({ id: row.id, name: row.name, version: row.version,
      ...(row.previousId && { previousId: row.previousId }), ...(row.originTaskId && { originTaskId: row.originTaskId }) }))
    const assistantRows: Assistant[] = assistants.map((row) => ({ id: row.id, name: row.name, color: row.color, status: row.status as Assistant['status'],
      ownerId: row.ownerId, level1: row.level1CodeId, level2: row.level2CodeId, summary: row.summary, order: row.sortOrder,
      expectedInputs: [], expectedOutputs: [], usageExample: row.usageExample, checklistTemplate: [], createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), ...(row.imageFileId && { imageId: row.imageFileId }) }))
    const userRows = users.map((row) => ({ id: row.id, name: row.name, role: row.role, initials: row.initials, color: row.color })) as User[]
    const srRows = srs.map((row) => ({ id: row.id, status: row.status, submittedAt: row.submittedAt?.toISOString() })) as ServiceRequest[]
    const done = reportTasks.filter((row) => row.status === 'done' && row.completedAt)
    const leads = done.map((row) => (new Date(row.completedAt!).getTime() - new Date(row.startedAt ?? row.createdAt).getTime()) / 86_400_000)
    const checks = done.flatMap((row) => row.checklist)
    return {
      days, granularity, userId,
      kpi: {
        done: done.length,
        avgLead: leads.length ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length * 10) / 10 : undefined,
        reopens: activity.filter((row) => row.type === 'task.reopened').length,
        checkRate: checks.length ? Math.round(checks.filter((row) => row.checked).length / checks.length * 100) : undefined,
        srLead: srLeadDays(srRows, activity),
      },
      buckets: completionBuckets(reportTasks, days, granularity),
      assistantStats: assistantStats(reportTasks, assistantRows),
      userStats: userActivityStats(activity, userRows, days),
      flow: inputFlow(tasks, fileRows, allTasks).slice(0, 10),
      tags: tagUsage(reportTasks).slice(0, 12),
      srDist: srStatusDistribution(srRows),
      signals: inefficiencySignals(reportTasks, activity, fileRows),
      digest: feedbackDigest(reportTasks, assistantRows, userRows),
      assistants: assistantRows,
      users: userRows,
    }
  }
}
