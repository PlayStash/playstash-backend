import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  PLAYSTASH_CONFIG,
  getPlaystashConfig,
} from "../../playstash-config.js";

@Global()
@Module({
  providers: [
    {
      provide: PLAYSTASH_CONFIG,
      inject: [ConfigService],
      useFactory: getPlaystashConfig,
    },
  ],
  exports: [PLAYSTASH_CONFIG],
})
export class PlaystashConfigModule {}
