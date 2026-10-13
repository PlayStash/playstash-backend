import { Test } from "@nestjs/testing";
import { getDataSourceToken } from "@nestjs/typeorm";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import "reflect-metadata";
import { DataSource } from "typeorm";

// Export route/model metadata without connecting to a database or starting jobs.
process.env.DB_SYSTEM = "POSTGRESQL";
process.env.WEB_UI_ENABLED = "false";
const { AppModule } = await import("../dist/src/app.module.js");
const { createPlaystashApiDocument } = await import("../dist/src/openapi.js");
const inertDatabase = new DataSource({ type: "postgres" });
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(getDataSourceToken())
  .useValue(inertDatabase)
  .compile();
const app = module.createNestApplication();

try {
  app.setGlobalPrefix("api");
  const document = createPlaystashApiDocument(app);
  const output = resolve(process.argv[2] ?? "playstash.openapi.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Exported PlayStash API schema to ${output}`);
} finally {
  await app.close();
}
