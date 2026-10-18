import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { MaterialCandidateCount } from '@mes/contracts'
import type { Db } from '../db/db.module.js'

/** Count picker rows in SQL: no material text, snapshots or message steps leave the DB. */
export async function materialCandidateCount(db: Db, actor: string, taskId: string): Promise<MaterialCandidateCount> {
  const [rows] = await db.execute(sql`
    with recursive
    viewer as (select id, is_business_owner and not is_system_owner as restricted from app_user where id = ${actor}),
    target as (select t.id, t.sr_id,
      (not v.restricted or t.created_by = v.id or t.owner_id = v.id or exists
        (select 1 from task_assignee a where a.task_id = t.id and a.user_id = v.id)) as can_read
      from task t cross join viewer v where t.id = ${taskId} and t.deleted_at is null),
    sources as (select distinct t.id from task t join task_tag their on their.task_id = t.id
      join task_tag mine on mine.tag_key = their.tag_key join target x on mine.task_id = x.id
      where t.id <> x.id and t.deleted_at is null and x.can_read),
    linked_srs as (select s.id, s.requester_id from service_request s cross join target x
      where x.can_read and (s.id = x.sr_id or exists (select 1 from task_tag tt where tt.task_id = x.id and tt.tag_key = lower(s.code)))),
    file_chain (ancestor, descendant) as (
      select f.previous_id, f.id from file_object f join sources s on s.id = f.origin_task_id where f.previous_id is not null
      union distinct
      select c.ancestor, f.id from file_chain c join file_object f on f.previous_id = c.descendant),
    materials as (
      select concat('file:', f.id) as material from file_object f cross join target x
      where x.can_read and f.deleted_at is null and (
        f.origin_task_id = x.id
        or (f.origin_sr_id in (select id from linked_srs) and f.kind in ('sr_attachment', 'ai_output'))
        or (f.origin_task_id in (select id from sources) and f.kind in ('task_file', 'ai_output')
          and (not exists (select 1 from file_chain c join file_object newer on newer.id = c.descendant
            where c.ancestor = f.id and newer.deleted_at is null)
            or exists (select 1 from task_input i where i.task_id = x.id and i.file_id = f.id))
          and (not (select restricted from viewer) or exists (
            select 1 from shared_result_file rf join shared_result r on r.id = rf.result_id
            join service_request sr on sr.id = r.sr_id where rf.file_id = f.id and sr.requester_id = ${actor}))))
      union all select concat('sr:', s.id) from linked_srs s cross join viewer v
        where not v.restricted or s.requester_id = v.id
      union all select concat('conversation:', s.id) from sources s join task t on t.id = s.id cross join viewer v
        where not v.restricted or t.created_by = v.id or t.owner_id = v.id or exists
          (select 1 from task_assignee a where a.task_id = t.id and a.user_id = v.id)
    )
    select x.can_read, (select count(distinct material) from materials) as count from target x
  `) as unknown as [Array<{ can_read: number; count: number | string }>, unknown]
  const row = rows[0]
  if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
  if (!row.can_read) throw new ForbiddenException('내부 대화에 접근할 수 없습니다')
  return { count: Number(row.count) }
}
