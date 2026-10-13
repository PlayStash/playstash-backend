import { Global, Module } from "@nestjs/common";
import { ExternalNotificationsService } from "./external-notifications.service.js";

@Global()
@Module({
  providers: [ExternalNotificationsService],
  exports: [ExternalNotificationsService],
})
export class NotificationsModule {}
