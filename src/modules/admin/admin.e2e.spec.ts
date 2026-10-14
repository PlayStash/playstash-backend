import { Global, type INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { DatabaseModule } from "../database/database.module.js";
import { DatabaseService } from "../database/database.service.js";
import { ServerService } from "../server/server.service.js";
import { AdminLogsService } from "./admin-logs.service.js";
import { AdminModule } from "./admin.module.js";

@Global()
@Module({
  providers: [
    {
      provide: ServerService,
      useValue: {
        getServerUuid: () => "550e8400-e29b-41d4-a716-446655440000",
      },
    },
  ],
  exports: [ServerService],
})
class MockServerModule {}

@Module({})
class MockDatabaseModule {}

describe("Administrator API without a product frontend", () => {
  let app: INestApplication;
  let baseUrl: string;
  const records = [{ level: "info", message: "Server started." }];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MockServerModule, AdminModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideProvider(DatabaseService)
      .useValue({ backup: vi.fn(), restore: vi.fn() })
      .overrideProvider(AdminLogsService)
      .useValue({ getRecentLogs: async () => records })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps the health API available without loading a frontend", async () => {
    const response = await fetch(`${baseUrl}/api/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("status", "HEALTHY");
  });

  it("does not serve product pages, assets or the former frontend restart route", async () => {
    for (const [path, method] of [
      ["/", "GET"],
      ["/assets/index.js", "GET"],
      ["/api/admin/web-ui/restart", "POST"],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { method });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('id="root"');
    }
  });

  it("retains administrator log access without frontend services", async () => {
    const response = await fetch(`${baseUrl}/api/admin/logs`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(records);
  });
});
