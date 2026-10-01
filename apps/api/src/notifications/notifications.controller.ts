import { Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common'
import type { AuthedRequest } from '../auth/guards.js'
import { NotificationsService } from './notifications.service.js'

@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}
  @Get()
  list(@Req() req: AuthedRequest) { return this.notifications.list(req.user!.id) }
  @Get('unread-count')
  async unreadCount(@Req() req: AuthedRequest) { return { count: await this.notifications.unreadCount(req.user!.id) } }
  @Patch(':id/read')
  read(@Req() req: AuthedRequest, @Param('id') id: string) { return this.notifications.markRead(req.user!.id, id) }
  @Post('read-all')
  readAll(@Req() req: AuthedRequest) { return this.notifications.markAllRead(req.user!.id) }
}
