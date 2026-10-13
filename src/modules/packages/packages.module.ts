import { Module } from "@nestjs/common";
import { GamesModule } from "../games/games.module.js";
import { UsersModule } from "../users/users.module.js";
import { PackagesController } from "./packages.controller.js";
import { PackagesService } from "./packages.service.js";

@Module({
  imports: [GamesModule, UsersModule],
  controllers: [PackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
