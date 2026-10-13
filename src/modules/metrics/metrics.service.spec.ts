import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { MetricsService } from "./metrics.service.js";
import {
  CreateGameClientEventDto,
  GameClientEventType,
} from "./models/game-client-event.dto.js";

describe("client lifecycle metrics", () => {
  let service: MetricsService;
  let events: any;
  let versions: any;
  let games: any;
  let config: any;
  const requester = {
    id: 7,
    username: "viewer",
    role: 1,
    report_game_metrics: true,
  } as any;
  const dto = {
    event_id: "a163a30d-f4e5-4f2d-8ef1-e7dacde76ace",
    type: GameClientEventType.INSTALLED,
    version_id: 3,
  };
  beforeEach(() => {
    events = {
      findOne: vi.fn(async () => null),
      save: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      createQueryBuilder: vi.fn(),
    };
    versions = { findOneBy: vi.fn(async () => ({ id: 3 })) };
    games = {
      findOneByGameIdOrFail: vi.fn(async () => ({
        id: 42,
        access_restricted: false,
      })),
    };
    config = { METRICS: { ENABLED: true, RETENTION_DAYS: 365 } };
    service = new MetricsService(
      events,
      versions,
      games,
      { findUserAgeByUsername: vi.fn(async () => undefined) } as any,
      config,
    );
  });
  const existing = () => ({
    event_id: dto.event_id,
    type: dto.type,
    user: requester,
    game: { id: 42 },
    version: { id: 3 },
    minutes_played: 0,
    occurred_at: new Date(),
  });
  it("records the authenticated user's event and exact game version", async () => {
    expect(await service.record(42, dto, requester)).toEqual({
      event_id: dto.event_id,
      accepted: true,
    });
    expect(events.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user: requester,
        game: { id: 42, access_restricted: false },
        version: { id: 3 },
        type: "installed",
      }),
    );
    expect(games.findOneByGameIdOrFail).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ requestingUser: requester }),
    );
  });
  it("replays an identical UUID without double-counting and normalizes UUID casing", async () => {
    events.findOne.mockResolvedValue(existing());
    expect(
      (
        await service.record(
          42,
          { ...dto, event_id: dto.event_id.toUpperCase() },
          requester,
        )
      ).accepted,
    ).toBe(true);
    expect(events.save).not.toHaveBeenCalled();
  });
  it("rejects reused UUIDs belonging to another user or payload", async () => {
    events.findOne.mockResolvedValue({ ...existing(), user: { id: 9 } });
    await expect(service.record(42, dto, requester)).rejects.toBeInstanceOf(
      ConflictException,
    );
    events.findOne.mockResolvedValue(existing());
    await expect(
      service.record(
        42,
        { ...dto, type: GameClientEventType.UNINSTALLED },
        requester,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("accepts concurrent identical retries after the unique insert races", async () => {
    events.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing());
    events.save.mockRejectedValue(new Error("unique event UUID"));
    expect((await service.record(42, dto, requester)).accepted).toBe(true);
  });
  it("honors user/server opt-out and rejects dates beyond the clock tolerance", async () => {
    expect(
      (
        await service.record(42, dto, {
          ...requester,
          report_game_metrics: false,
        })
      ).accepted,
    ).toBe(false);
    config.METRICS.ENABLED = false;
    expect((await service.record(42, dto, requester)).accepted).toBe(false);
    config.METRICS.ENABLED = true;
    await expect(
      service.record(
        42,
        { ...dto, occurred_at: new Date(Date.now() + 3600000).toISOString() },
        requester,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(events.save).not.toHaveBeenCalled();
  });
  it("rejects foreign versions and minutes on non-session events", async () => {
    versions.findOneBy.mockResolvedValue(null);
    await expect(service.record(42, dto, requester)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.record(42, { ...dto, minutes_played: 20 }, requester),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it("denies non-administrator drilldown even on direct service calls", async () => {
    await expect(service.list(42, requester)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.summary(42, requester)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it("preserves restricted-game privacy in administrative drilldown", async () => {
    games.findOneByGameIdOrFail.mockResolvedValue({
      id: 42,
      access_restricted: true,
    });
    const query: any = {
      innerJoinAndSelect: vi.fn().mockReturnThis(),
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getMany: vi.fn(async () => []),
    };
    events.createQueryBuilder.mockReturnValue(query);
    await service.list(42, { ...requester, role: 3 }, 20, 100, 9);
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("share_restricted_activity"),
      { requesterId: 7, sharing: true },
    );
    expect(query.andWhere).toHaveBeenCalledWith("user.id = :userId", {
      userId: 9,
    });
    expect(query.take).toHaveBeenCalledWith(20);
  });
  it("purges old events and permits deliberate unlimited retention", async () => {
    await service.purgeExpiredEvents();
    expect(events.delete).toHaveBeenCalledOnce();
    config.METRICS.RETENTION_DAYS = 0;
    events.delete.mockClear();
    await service.purgeExpiredEvents();
    expect(events.delete).not.toHaveBeenCalled();
  });
  it("validates client UUIDs, event types and bounded session minutes", async () => {
    expect(
      await validate(plainToInstance(CreateGameClientEventDto, dto)),
    ).toEqual([]);
    expect(
      (
        await validate(
          plainToInstance(CreateGameClientEventDto, {
            ...dto,
            event_id: "invalid",
            type: "unknown",
            minutes_played: -1,
          }),
        )
      ).length,
    ).toBe(3);
  });
});
