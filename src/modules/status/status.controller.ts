import { Controller, Get, Request } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { SkipGuards } from "../../decorators/skip-guards.decorator.js";
import { PlaystashUser } from "../users/playstash-user.entity.js";
import { Role } from "../users/models/role.enum.js";
import { Status } from "./models/status.model.js";
import { StatusService } from "./status.service.js";

@Controller("status")
@ApiTags("status")
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Get()
  @ApiOkResponse({ type: () => Status })
  @ApiOperation({
    summary: "returns the status of the server",
    operationId: "getStatus",
  })
  @SkipGuards()
  async getStatus(@Request() req?: { user: PlaystashUser }): Promise<Status> {
    return (req?.user?.role ?? 0) < Role.ADMIN
      ? this.statusService.get()
      : this.statusService.getExtensive();
  }
}
