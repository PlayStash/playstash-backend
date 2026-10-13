import { Injectable, Logger } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AppConfiguration } from "../../../configuration.js";
import { InjectPlaystashConfig } from "../../../decorators/inject-playstash-config.decorator.js";
import { UsersService } from "../../users/users.service.js";
import { type PlaystashJwtPayload } from "../models/playstash-jwt-payload.interface.js";
@Injectable()
export class AuthenticationStrategy extends PassportStrategy(Strategy, "auth") {
  private readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly usersService: UsersService,
    @InjectPlaystashConfig() config: AppConfiguration,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.AUTH.ACCESS_TOKEN.SECRET,
      ignoreExpiration: false,
    });
  }

  async validate(dto: { payload: PlaystashJwtPayload }) {
    return await this.usersService.findOneByUsernameOrFail(
      (
        await this.usersService.findUserForAuthOrFail({
          id: Number(dto.payload?.sub),
          username: dto.payload?.preferred_username,
          email: dto.payload?.email,
        })
      ).username,
    );
  }
}
