import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameVersion } from "../games/game-version.entity.js";
import { GamesModule } from "../games/games.module.js";
import { UsersModule } from "../users/users.module.js";
import { GameClientEvent } from "./game-client-event.entity.js";
import { MetricsController } from "./metrics.controller.js";
import { MetricsService } from "./metrics.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([GameClientEvent, GameVersion]),
    GamesModule,
    UsersModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
