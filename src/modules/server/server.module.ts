import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlaystashServer } from "./playstash-server.entity.js";
import { ServerService } from "./server.service.js";

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PlaystashServer])],
  providers: [ServerService],
  exports: [ServerService],
})
export class ServerModule {}
