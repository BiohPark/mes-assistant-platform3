import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { assistantStats, completionBuckets, feedbackDigest, inefficiencySignals, inputFlow, srLeadDays, srStatusDistribution, tagUsage, userActivityStats, type ActivityLog, type Assistant, type Granularity, type ServiceRequest, type User } from '@mes/domain'
import { and, asc, eq, gte, inArray, isNull, max, or } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { activityLog, appUser, fileObject, serviceRequest, task } from '../db/schema.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'
import { DbTasksService } from '../tasks/tasks.service.js'

@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(DbTasksService) private readonly tasks: DbTasksService) {}

  async get(days: number, granularity: Granularity, actor: string, userId?: string) {
    const [viewer] = await this.db.select({ isBusinessOwner: appUser.isBusinessOwner, isSystemOwner: appUser.isSystemOwner }).from(appUser).where(eq(appUser.id, actor))
    if (!viewer || (viewer.isBusinessOwner && !viewer.isSystemOwner)) throw new ForbiddenException('리포트 권한이 없습니다')
    const tasks = await this.tasks.list(userId ? { mine: userId } : {})
    const taskIds = tasks.map((row) => row.id)
    const activityScope = or(isNull(activityLog.taskId), ...(taskIds.length ? [inArray(activityLog.taskId, taskIds)] : []))
    const activityColumns = { id: activityLog.id, type: activityLog.type, userId: activityLog.userId, taskId: activityLog.taskId,
      assistantId: activityLog.assistantId, srId: activityLog.srId, payload: activityLog.payload, at: activityLog.at }
    const historyColumns = { type: activityLog.type, taskId: activityLog.taskId, srId: activityLog.srId, payload: activityLog.payload, at: activityLog.at }
    const from = new Date(Date.now() - (days - 1) * 86_400_000)
    const [sourceTasks, activities, lastActivityRows, recentActivities, files, srs, assistants, users] = await Promise.all([
      userId ? this.db.select({ id: task.id, assistantId: task.assistantId }).from(task).where(isNull(task.deletedAt)) : Promise.resolve(tasks),
      this.db.select(historyColumns).from(activityLog).where(and(activityScope,
        inArray(activityLog.type, ['task.completed', 'task.reopened', 'sr.status_changed']))).orderBy(asc(activityLog.at)),
      taskIds.length ? this.db.select({ taskId: activityLog.taskId, at: max(activityLog.at) }).from(activityLog)
        .where(inArray(activityLog.taskId, taskIds)).groupBy(activityLog.taskId) : Promise.resolve([]),
      this.db.select(activityColumns).from(activityLog).where(and(activityScope, gte(activityLog.at, from))).orderBy(asc(activityLog.at)),
      this.db.select({ id: fileObject.id, name: fileObject.originalName, version: fileObject.version,
        previousId: fileObject.previousId, originTaskId: fileObject.originTaskId }).from(fileObject).where(isNull(fileObject.deletedAt)),
      this.db.select({ id: serviceRequest.id, status: serviceRequest.status, submittedAt: serviceRequest.submittedAt }).from(serviceRequest),
      new DbCatalogReader(this.db).assistants(),
      this.db.select({ id: appUser.id, name: appUser.name, role: appUser.role, initials: appUser.initials, color: appUser.color }).from(appUser),
    ])
    const mapActivity = (rows: typeof recentActivities): ActivityLog[] => rows.map((row) => ({ id: row.id, type: row.type as ActivityLog['type'], userId: row.userId,
      ...(row.taskId && { taskId: row.taskId }), ...(row.assistantId && { assistantId: row.assistantId }),
      ...(row.srId && { srId: row.srId }), payload: row.payload as Record<string, unknown>, at: row.at.toISOString() }))
    const activity = activities.map((row) => ({ type: row.type as ActivityLog['type'], ...(row.taskId && { taskId: row.taskId }),
      ...(row.srId && { srId: row.srId }), payload: row.payload as Record<string, unknown>, at: row.at.toISOString() }))
    const lastActivity = new Map(lastActivityRows.filter((row) => row.taskId && row.at).map((row) => [row.taskId!, row.at!.toISOString()]))
    const completedAt = new Map<string, string>()
    for (const row of activity) if (row.type === 'task.completed' && row.taskId) completedAt.set(row.taskId, row.at)
    const reportTasks = tasks.map((row) => row.status === 'done' && completedAt.has(row.id)
      ? { ...row, completedAt: completedAt.get(row.id)! } : row)
    const fileRows = files.map((row) => ({ id: row.id, name: row.name, version: row.version,
      ...(row.previousId && { previousId: row.previousId }), ...(row.originTaskId && { originTaskId: row.originTaskId }) }))
    const assistantRows: Assistant[] = assistants
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
      userStats: userActivityStats(mapActivity(recentActivities), userRows, days),
      flow: inputFlow(tasks, fileRows, sourceTasks).slice(0, 10),
      tags: tagUsage(reportTasks).slice(0, 12),
      srDist: srStatusDistribution(srRows),
      signals: inefficiencySignals(reportTasks, activity, fileRows, new Date(), lastActivity),
      digest: feedbackDigest(reportTasks, assistantRows, userRows),
      assistants: assistantRows,
      users: userRows,
    }
  }
}
