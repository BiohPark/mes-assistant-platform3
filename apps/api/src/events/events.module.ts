import { Global, Module } from '@nestjs/common'
import { EventsController, TypingController } from './events.controller.js'
import { EventsService } from './events.service.js'

@Global()
@Module({ controllers: [EventsController, TypingController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
