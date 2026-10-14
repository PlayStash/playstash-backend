import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { StatusModule } from "../status/status.module.js";
import { AdminLogsService } from "./admin-logs.service.js";
import { AdminController } from "./admin.controller.js";

@Module({
  imports: [StatusModule, DatabaseModule],
  controllers: [AdminController],
  providers: [DatabaseService, AdminLogsService],
})
export class AdminModule {}
