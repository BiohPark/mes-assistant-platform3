import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common'
import { PasswordSchema, UserNameSchema } from '@mes/contracts'
import { z } from 'zod'
import type { AuthedRequest } from '../auth/guards.js'
import { Roles } from '../auth/roles.decorator.js'
import { AccountsService } from './accounts.service.js'

const booleanBody = z.object({ enabled: z.boolean() }).strict()
const nameBody = z.object({ name: UserNameSchema }).strict()
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
  return result.data
}
@Controller('users')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Get()
  @Roles('system_owner')
  users() { return this.accounts.users() }
  @Patch('me')
  ownName(@Req() req: AuthedRequest, @Body() body: unknown) { return this.accounts.name(req.user!.id, parse(nameBody, body).name) }
  @Patch(':id')
  @Roles('system_owner')
  name(@Param('id') id: string, @Body() body: unknown) { return this.accounts.name(id, parse(nameBody, body).name) }
  @Put(':id/system-owner')
  @Roles('system_owner')
  @HttpCode(204)
  systemOwner(@Param('id') id: string, @Body() body: unknown) { return this.accounts.role(id, 'isSystemOwner', parse(booleanBody, body).enabled) }
  @Put(':id/business-owner')
  @Roles('system_owner')
  @HttpCode(204)
  businessOwner(@Param('id') id: string, @Body() body: unknown) { return this.accounts.role(id, 'isBusinessOwner', parse(booleanBody, body).enabled) }
  @Put(':id/active')
  @Roles('system_owner')
  @HttpCode(204)
  active(@Param('id') id: string, @Body() body: unknown) { return this.accounts.active(id, parse(booleanBody, body).enabled) }
  @Post(':id/temporary-password')
  @Roles('system_owner')
  temporary(@Param('id') id: string) { return this.accounts.temporaryPassword(id) }
}
@Controller('auth')
export class PasswordController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Post('password')
  @HttpCode(204)
  change(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(z.object({ currentPassword: PasswordSchema, newPassword: PasswordSchema }).strict(), body)
    return this.accounts.changePassword(req.user!.id, input.currentPassword, input.newPassword)
  }
}
