import { Module, forwardRef } from "@nestjs/common";
import { GamesModule } from "../games/games.module.js";
import { UsersModule } from "../users/users.module.js";
import { OtpController } from "./otp.controller.js";
import { OtpService } from "./otp.service.js";

@Module({
  imports: [forwardRef(() => GamesModule), forwardRef(() => UsersModule)],
  controllers: [OtpController],
  exports: [OtpService],
  providers: [OtpService],
})
export class OtpModule {}
