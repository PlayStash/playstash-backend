import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  ExpressAdapter,
  type NestExpressApplication,
} from "@nestjs/platform-express";
import { SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import cookieparser from "cookie-parser";
import fsExtra from "fs-extra";
import helmet from "helmet";
import morgan from "morgan";
//import { AsyncApiDocumentBuilder, AsyncApiModule } from "nestjs-asyncapi";

import express, { type Request, type Response } from "express";
import session from "express-session";
import { createHash } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import { AppModule } from "./app.module.js";
import configuration, {
  getCensoredConfiguration,
  getMaxBodySizeInBytes,
} from "./configuration.js";
import { LoggingExceptionFilter } from "./filters/http-exception.filter.js";
import { configureHttpServerTimeouts } from "./http-server-timeouts.js";
import logger, { stream } from "./logging.js";
import { LegacyRoutesMiddleware } from "./middleware/legacy-routes.middleware.js";
import { createPlaystashApiDocument } from "./openapi.js";
import loadPlugins from "./plugin.js";
import { logPath } from "./security-log.js";
const { readFileSync } = fsExtra;

async function bootstrap(): Promise<void> {
  let httpsServer: ReturnType<typeof createHttpsServer> | undefined;

  // Load Modules & Plugins
  const builtinModules = Reflect.getOwnMetadata("imports", AppModule);
  const pluginModules = await loadPlugins();
  const modules = [...builtinModules, ...pluginModules];

  Reflect.defineMetadata("imports", modules, AppModule);
  // Create App
  const server = express();
  // Prevent Express from disclosing its version via the `X-Powered-By` header.
  server.disable("x-powered-by");
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    {
      logger,
    },
  );

  // To Support Reverse Proxies
  app.set("trust proxy", 1);
  // Pretty JSON only outside production to keep large payloads compact.
  if (process.env.NODE_ENV !== "production") {
    app.set("json spaces", 2);
  }
  // CORS Configuration
  app.enableCors({
    origin: configuration.SERVER.CORS_ALLOWED_ORIGINS.length
      ? configuration.SERVER.CORS_ALLOWED_ORIGINS
      : true,
    credentials: configuration.SERVER.CORS_ALLOWED_ORIGINS.length > 0,
    methods: "*",
    allowedHeaders: "*",
    exposedHeaders: "*",
  });
  // GZIP
  app.use(compression());

  // Set Max Body Size

  const maxBodySettings = {
    limit: `${getMaxBodySizeInBytes()}b`,
    extended: true,
  };
  app.useBodyParser("json", maxBodySettings);
  app.useBodyParser("urlencoded", maxBodySettings);
  app.useBodyParser("text", maxBodySettings);
  app.useBodyParser("raw", maxBodySettings);

  // Security Measurements
  app.use(helmet({ contentSecurityPolicy: false }));

  // Sessions
  app.use(
    session({
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: "auto",
        maxAge: 15 * 60 * 1000,
      },
      secret: createHash("sha256")
        .update(configuration.AUTH.SEED)
        .digest("hex"),
    }),
  );

  // Cookies
  app.use(cookieparser());

  // Support Legacy Routes
  app.use(new LegacyRoutesMiddleware().use);

  // Skips logs for /status and /health calls
  morgan.token("url", (request) => logPath(request.url));
  app.use(
    morgan(configuration.SERVER.REQUEST_LOG_FORMAT, {
      stream,
      skip: (req) =>
        !req.url || req.url.includes("/status") || req.url.includes("/health"),
    }),
  );

  // Validates incoming data
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  );
  // Logs HTTP 4XX and 5XX as warns and errors
  app.useGlobalFilters(new LoggingExceptionFilter());

  // Basepath
  app.setGlobalPrefix("api");

  // Provide API Specification
  SwaggerModule.setup("api/docs", app, createPlaystashApiDocument(app));

  // Redirect /health to /status
  app.use("/api/health", (_req: Request, res: Response) => {
    res.redirect(308, "/api/status");
  });

  await app.init();
  configureHttpServerTimeouts(app.getHttpServer());

  // Start HTTP server (Nest owns the http.Server here, so Socket.IO attaches to it)
  await app.listen(configuration.SERVER.PORT ?? 8080);

  // Additionally start HTTPS server if enabled
  if (configuration.SERVER.HTTPS.ENABLED) {
    // Validate required HTTPS certificate paths
    if (!configuration.SERVER.HTTPS.KEY_PATH) {
      throw new Error(
        "SERVER_HTTPS_KEY_PATH must be set when HTTPS is enabled.",
      );
    }
    if (!configuration.SERVER.HTTPS.CERT_PATH) {
      throw new Error(
        "SERVER_HTTPS_CERT_PATH must be set when HTTPS is enabled.",
      );
    }
    const httpsOptions: Record<string, Buffer> = {
      key: readFileSync(configuration.SERVER.HTTPS.KEY_PATH),
      cert: readFileSync(configuration.SERVER.HTTPS.CERT_PATH),
    };
    if (configuration.SERVER.HTTPS.CA_CERT_PATH) {
      httpsOptions.ca = readFileSync(configuration.SERVER.HTTPS.CA_CERT_PATH);
    }
    httpsServer = createHttpsServer(
      httpsOptions,
      app.getHttpAdapter().getInstance(),
    );
    configureHttpServerTimeouts(httpsServer);
    httpsServer.listen(configuration.SERVER.HTTPS.PORT);
  }

  logger.log({
    context: "Initialization",
    message: `Started PlayStash Server.`,
    version: configuration.SERVER.VERSION,
    port: configuration.SERVER.PORT,
    httpsPort: configuration.SERVER.HTTPS.ENABLED
      ? configuration.SERVER.HTTPS.PORT
      : undefined,
    config: getCensoredConfiguration(),
  });

  // Graceful shutdown: stop accepting connections, drain in-flight requests
  // (Nest 12 Express adapter) and close both servers before exiting.
  let isShuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.log({
      context: "Shutdown",
      message: `Received ${signal}. Shutting down gracefully.`,
    });
    try {
      await app.close();
      if (httpsServer) {
        await new Promise<void>((resolve) =>
          httpsServer?.close(() => resolve()),
        );
      }
    } catch (error) {
      logger.error({
        context: "Shutdown",
        message: "Error during graceful shutdown.",
        error,
      });
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

Error.stackTraceLimit = configuration.SERVER.STACK_TRACE_LIMIT ?? 10;
try {
  await bootstrap();
} catch (error) {
  logger.error({ message: "A fatal error occured", error });
  throw error;
}
