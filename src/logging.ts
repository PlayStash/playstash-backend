import { WinstonModule } from "nest-winston";
import winston from "winston";
import { consoleFormat } from "winston-console-format";
import DailyRotateFile from "winston-daily-rotate-file";

import configuration from "./configuration.js";
import { PlaystashGame } from "./modules/games/playstash-game.entity.js";
import { Media } from "./modules/media/media.entity.js";
import { type Metadata } from "./modules/metadata/models/metadata.interface.js";
import { type MetadataProvider } from "./modules/metadata/providers/abstract.metadata-provider.service.js";
import { Progress } from "./modules/progresses/progress.entity.js";
import { PlaystashUser } from "./modules/users/playstash-user.entity.js";
import { redactLogValue } from "./security-log.js";

const transports: winston.transport[] = [];

if (configuration.SERVER.LOG_LEVEL != "off") {
  transports.push(
    new winston.transports.Console({
      level: configuration.SERVER.LOG_LEVEL,
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.padLevels(),
        consoleFormat({
          inspectOptions: {
            depth: 3,
            colors: true,
            sorted: true,
          },
        }),
      ),
    }),
  );
}

if (
  configuration.SERVER.LOG_FILES_ENABLED &&
  !configuration.TESTING.MOCK_FILES
) {
  transports.push(
    new DailyRotateFile({
      level: "debug",
      filename: "playstash-backend-%DATE%.log",
      dirname: configuration.VOLUMES.LOGS,
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
      maxSize: "20m",
    }),
  );
}

/** Redact after splat expansion and before either JSON or console inspection. */
export function createBackendLogFormat() {
  return winston.format.combine(
    winston.format.timestamp(),
    winston.format.ms(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format((info) => redactLogValue(info) as typeof info)(),
    winston.format.json(),
  );
}

const logger = WinstonModule.createLogger({
  exitOnError: false,
  transports,
  handleExceptions: true,
  format: createBackendLogFormat(),
});

const stream = {
  write(message: string) {
    logger.log(message, "HTTP Request");
  },
};

function logPlaystashGame(game: PlaystashGame | undefined) {
  const resolvedPath =
    game?.file_path ||
    game?.versions?.find((version) => !!version.file_path)?.file_path;

  return {
    id: game?.id,
    title: game?.title,
    file_path: resolvedPath,
  };
}

function logPlaystashUser(user: PlaystashUser | undefined) {
  return {
    id: user?.id,
    username: user?.username,
    role: user?.role,
  };
}

function logMetadata(metadata: Metadata) {
  return {
    id: metadata?.id,
    provider_slug: metadata?.provider_slug,
    provider_data_id: metadata?.provider_data_id,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
  };
}

function logProgress(progress: Progress) {
  return {
    id: progress?.id,
    minutes_played: progress?.minutes_played,
    state: progress?.state,
    last_played_at: progress?.last_played_at,
    user: logPlaystashUser(progress?.user),
    game: logPlaystashGame(progress?.game),
  };
}

function logMetadataProvider(provider: MetadataProvider) {
  return {
    slug: provider?.slug,
    priority: provider?.priority,
    enabled: provider?.enabled,
    request_interval_ms: provider?.request_interval_ms,
  };
}

function logMedia(media: Media) {
  return {
    id: media?.id,
    file_path: media?.file_path,
    type: media?.type,
    uploader: logPlaystashUser(media?.uploader),
  };
}

export default logger;
export {
  logMedia,
  logMetadata,
  logMetadataProvider,
  logPlaystashGame,
  logPlaystashUser,
  logProgress,
  stream,
};
