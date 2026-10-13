import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import configuration from "./configuration.js";
import { Activity } from "./modules/users/models/activity.dto.js";
import {
  ChatHistoryDto,
  ChatMessageDto,
  ChatSendDto,
} from "./modules/users/models/chat.dto.js";

export function createPlaystashApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("PlayStash Backend Server")
      .setContact(
        "PlayStash",
        "https://github.com/PlayStash/playstash-backend",
        "",
      )
      .setExternalDoc(
        "Documentation",
        "https://github.com/PlayStash/playstash-backend",
      )
      .setDescription(
        "Backend for PlayStash, the self-hosted gaming platform for drm-free games",
      )
      .setVersion(configuration.SERVER.VERSION)
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Access token obtained from /api/auth/*/login endpoint.",
        },
        "bearer",
      )
      .addBasicAuth(
        {
          type: "http",
          scheme: "basic",
          description: "Basic Authentication",
        },
        "basic",
      )
      .addApiKey(
        {
          type: "apiKey",
          name: "X-Api-Key",
          in: "header",
          description: "API-Key Authentication",
        },
        "apikey",
      )
      .addServer(
        `http://localhost:${configuration.SERVER.PORT}`,
        "Local PlayStash Server",
      )
      .setLicense(
        "Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)",
        "https://github.com/PlayStash/playstash-backend/blob/HEAD/LICENSE",
      )
      .build(),
    { extraModels: [Activity, ChatSendDto, ChatHistoryDto, ChatMessageDto] },
  );
}
