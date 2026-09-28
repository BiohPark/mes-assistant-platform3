import { Module } from '@nestjs/common'
import { CatalogController } from './catalog.controller.js'
import { CATALOG, DbCatalogReader } from './catalog.service.js'

@Module({ controllers: [CatalogController], providers: [DbCatalogReader, { provide: CATALOG, useExisting: DbCatalogReader }] })
export class CatalogModule {}
