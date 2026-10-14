import { Module } from '@nestjs/common'
import { LlmModule } from '../llm/llm.module.js'
import { CatalogController } from './catalog.controller.js'
import { CATALOG, DbCatalogReader } from './catalog.service.js'
import { FirstQuestionsService } from './first-questions.js'

@Module({ imports: [LlmModule], controllers: [CatalogController], providers: [DbCatalogReader, { provide: CATALOG, useExisting: DbCatalogReader }, FirstQuestionsService] })
export class CatalogModule {}
