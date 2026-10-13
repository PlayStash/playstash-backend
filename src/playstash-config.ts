import { type ConfigService } from "@nestjs/config";
import { AppConfiguration, CONFIG_NAMESPACE } from "./configuration.js";

export const PLAYSTASH_CONFIG = Symbol("PLAYSTASH_CONFIG");

export function getPlaystashConfig(
  configService: ConfigService,
): AppConfiguration {
  return configService.getOrThrow<AppConfiguration>(CONFIG_NAMESPACE);
}
