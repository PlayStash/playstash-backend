import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getDataSourceToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

import { AppModule } from "./app.module.js";
import { createPlaystashApiDocument } from "./openapi.js";

/**
 * Extracts the literal names of the path parameters from a route template.
 * For `/api/users/{user_id}` this returns `["user_id"]`.
 */
function extractPathParameterNames(routePath: string): string[] {
  const names: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(routePath)) !== null) {
    names.push(match[1]);
  }
  return names;
}

describe("OpenAPI specification", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(new DataSource({ type: "postgres" }))
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    // We intentionally skip `app.init()`: booting runs module
    // `OnApplicationBootstrap` hooks (file index, admin seeding, ...) that
    // require a running database. The OpenAPI document is derived purely from
    // controller metadata, which is available right after compilation.
  });

  afterAll(async () => {
    await app.close();
  });

  it("declares a path parameter for every path template placeholder", () => {
    const document = createPlaystashApiDocument(app);

    const errors: string[] = [];

    for (const [routePath, pathItem] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (typeof operation !== "object" || operation === null) {
          continue;
        }

        const op = operation as {
          parameters?: Array<{ name?: string; in?: string }>;
        };
        const declaredPathParams = (op.parameters ?? [])
          .filter((param) => param.in === "path" && param.name)
          .map((param) => param.name as string);

        for (const placeholder of extractPathParameterNames(routePath)) {
          if (!declaredPathParams.includes(placeholder)) {
            errors.push(
              `Path parameter "${placeholder}" of ${method.toUpperCase()} ${routePath} is not declared.`,
            );
          }
        }
      }
    }

    expect(errors).toEqual([]);
  });
});
