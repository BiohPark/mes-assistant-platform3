import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../auth/guards.js'
import { DbFilesService } from './files.service.js'
import { isWindowsReservedName } from './fileStorage.service.js'

type Upload = { originalname: string; mimetype: string; buffer: Buffer; size: number }
const uploadBody = z.object({ originTaskId: z.string().min(1), isOutput: z.enum(['true', 'false']).optional() }).strict()
const outputBody = z.object({ name: z.string().min(1), content: z.string() }).strict()
const weightBody = z.object({ weight: z.enum(['main', 'reference']) }).strict()
const switchBody = z.object({ toFileId: z.string().min(1) }).strict()
const patchBody = z.object({ isOutput: z.boolean() }).strict()
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
  return result.data
}

export function contentDisposition(name: string, inline: boolean) {
  let safe = [...name.replace(/[<>:"\\/|?*]/g, '_')].map((char) => char.charCodeAt(0) < 32 ? '_' : char).join('').replace(/^[. ]+|[. ]+$/g, '') || 'download'
  if (isWindowsReservedName(safe)) safe = `_${safe}`
  const fallback = safe.replace(/[^\x20-\x7e]/g, '_')
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

@Controller('files')
export class FilesController {
  constructor(@Inject(DbFilesService) private readonly files: DbFilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(@Req() req: AuthedRequest, @UploadedFile() file: Upload | undefined, @Body() body: unknown) {
    const input = parse(uploadBody, body)
    if (!file) throw new BadRequestException('파일이 필요합니다')
    return input.isOutput === 'true'
      ? this.files.upload(req.user!.id, input.originTaskId, file.originalname, file.mimetype, file.buffer, true)
      : this.files.upload(req.user!.id, input.originTaskId, file.originalname, file.mimetype, file.buffer)
  }

  @Get(':id')
  get(@Param('id') id: string) { return this.files.get(id) }

  @Get(':id/content')
  async content(@Param('id') id: string, @Res() res: Response) {
    const meta = await this.files.get(id)
    let stream
    try { stream = await this.files.contentStream(id) }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new NotFoundException('파일을 찾을 수 없습니다')
      throw error
    }
    const inferredText = meta.mime === 'application/octet-stream' && /\.(md|txt|csv|json|sql|xml|ya?ml)$/i.test(meta.name)
    const inline = /^(text\/(plain|markdown|csv)|application\/(json|xml|x-yaml))$/.test(meta.mime) || inferredText
    res.setHeader('Content-Type', inferredText ? 'text/plain; charset=utf-8' : meta.mime)
    res.setHeader('Content-Disposition', contentDisposition(meta.name, inline))
    res.setHeader('Content-Length', meta.size)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    stream.on('error', (error) => {
      if (!res.headersSent) { res.removeHeader('Content-Length'); res.status(error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 404 : 500).end() }
      else res.destroy(error)
    })
    stream.pipe(res)
  }

  @Get(':id/versions')
  versions(@Param('id') id: string) { return this.files.versions(id) }

  @Patch(':id')
  @HttpCode(204)
  patch(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.files.setOutput(req.user!.id, id, parse(patchBody, body).isOutput)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) { return this.files.remove(id) }
}

@Controller('tasks')
export class TaskFilesController {
  constructor(@Inject(DbFilesService) private readonly files: DbFilesService) {}

  @Get(':id/files')
  own(@Param('id') id: string) { return this.files.filesForTask(id) }

  @Post(':id/outputs')
  saveOutput(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(outputBody, body)
    return this.files.saveOutput(req.user!.id, id, input.name, input.content)
  }

  @Get(':id/candidates')
  candidates(@Param('id') id: string) { return this.files.candidates(id) }

  @Put(':id/inputs/:fileId')
  @HttpCode(204)
  setInput(@Req() req: AuthedRequest, @Param('id') id: string, @Param('fileId') fileId: string, @Body() body: unknown) {
    return this.files.setInput(req.user!.id, id, fileId, parse(weightBody, body).weight)
  }

  @Delete(':id/inputs/:fileId')
  @HttpCode(204)
  removeInput(@Req() req: AuthedRequest, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.files.setInput(req.user!.id, id, fileId, null)
  }

  @Post(':id/inputs/:fileId/switch-version')
  @HttpCode(204)
  switchVersion(@Req() req: AuthedRequest, @Param('id') id: string, @Param('fileId') fileId: string, @Body() body: unknown) {
    return this.files.switchInputVersion(req.user!.id, id, fileId, parse(switchBody, body).toFileId)
  }
}
