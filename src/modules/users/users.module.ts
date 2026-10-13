import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { GamesModule } from "../games/games.module.js";
import { MediaModule } from "../media/media.module.js";
import { ActivityGateway } from "./activity.gateway.js";
import { ApiKeyService } from "./api-key.service.js";
import { ChatService } from "./chat.service.js";
import { PlaystashUser } from "./playstash-user.entity.js";
import { UserStatusEvents } from "./user-status.events.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([PlaystashUser]),
    forwardRef(() => MediaModule),
    forwardRef(() => GamesModule),
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    ApiKeyService,
    ChatService,
    ActivityGateway,
    UserStatusEvents,
  ],
  exports: [UsersService, ApiKeyService],
})
export class UsersModule {}
