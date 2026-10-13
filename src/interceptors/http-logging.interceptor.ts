import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { type Request, type Response } from "express";
import { type Observable } from "rxjs";
import { tap } from "rxjs/operators";

import type { AppConfiguration } from "../configuration.js";
import { InjectPlaystashConfig } from "../decorators/inject-playstash-config.decorator.js";
import { logPath, redactLogValue } from "../security-log.js";

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(this.constructor.name);
  constructor(
    @InjectPlaystashConfig() private readonly config: AppConfiguration,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.config.TESTING.LOG_HTTP_TRAFFIC_ENABLED) {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    // Skip logging for /api/status route
    if (
      request.url.includes("/api/status") ||
      request.url.includes("/api/health")
    ) {
      return next.handle();
    }

    const requestLog = {
      context: "HTTP Traffic",
      direction: "incoming",
      method: request.method,
      url: logPath(request.url),
      headers: this.sanitizeHeaders(request.headers),
      body: this.sanitizeBody(request.body),
      params: redactLogValue(request.params),
      ip: request.ip,
    };

    this.logger.debug(requestLog);

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          const responseLog = {
            context: "HTTP Traffic",
            direction: "outgoing",
            method: request.method,
            url: logPath(request.url),
            statusCode: response.statusCode,
            headers: this.sanitizeHeaders(response.getHeaders()),
            body: this.sanitizeBody(responseBody),
            durationMs: Date.now() - startTime,
          };

          this.logger.debug(responseLog);
        },
        error: (error) => {
          const errorResponseLog = {
            context: "HTTP Traffic",
            direction: "outgoing",
            method: request.method,
            url: logPath(request.url),
            statusCode: error.status || 500,
            error: error.message,
            durationMs: Date.now() - startTime,
          };

          this.logger.debug(errorResponseLog);
        },
      }),
    );
  }

  private sanitizeHeaders(
    headers: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitized = { ...headers };
    const sensitiveHeaders = [
      "authorization",
      "cookie",
      "x-api-key",
      "set-cookie",
    ];

    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = "**REDACTED**";
      }
    }

    return sanitized;
  }

  private sanitizeBody(body: unknown): unknown {
    return typeof body === "string" ? "**OMITTED**" : redactLogValue(body);
  }
}
