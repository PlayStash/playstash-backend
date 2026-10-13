import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import {
  CreateGameRequestDto,
  FeedbackPageDto,
  PutGameReviewDto,
  RequestPageDto,
  UpdateGameRequestDto,
} from "./feedback.dto.js";

describe("feedback input validation", () => {
  it.each(["", "   ", "x".repeat(257), 5])(
    "rejects an invalid requested title %s",
    async (title) => {
      expect(
        await validate(plainToInstance(CreateGameRequestDto, { title })),
      ).not.toHaveLength(0);
    },
  );
  it("trims requests without converting a string to an anonymous flag", async () => {
    const input = plainToInstance(CreateGameRequestDto, {
      title: " Game ",
      note: " Notes ",
      anonymous: false,
    });
    expect(await validate(input)).toHaveLength(0);
    expect(input.title).toBe("Game");
    expect(input.note).toBe("Notes");
    expect(
      await validate(
        plainToInstance(CreateGameRequestDto, {
          title: "Game",
          anonymous: "false",
        }),
      ),
    ).not.toHaveLength(0);
  });
  it.each([0, 6, 2.5, "5", null])(
    "rejects invalid ratings %s",
    async (rating) => {
      expect(
        await validate(plainToInstance(PutGameReviewDto, { rating })),
      ).not.toHaveLength(0);
    },
  );
  it("accepts five stars and a trimmed review", async () => {
    const input = plainToInstance(PutGameReviewDto, {
      rating: 5,
      comment: " Great ",
    });
    expect(await validate(input)).toHaveLength(0);
    expect(input.comment).toBe("Great");
  });
  it("rejects oversized text and unsupported request states", async () => {
    expect(
      await validate(
        plainToInstance(PutGameReviewDto, {
          rating: 3,
          comment: "x".repeat(4001),
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateGameRequestDto, {
          status: "anything",
          game_id: -1,
        }),
      ),
    ).not.toHaveLength(0);
  });
  it("parses bounded pagination and explicit mine flags", async () => {
    const input = plainToInstance(RequestPageDto, {
      page: "2",
      limit: "25",
      mine: "false",
    });
    expect(await validate(input)).toHaveLength(0);
    expect(input).toMatchObject({ page: 2, limit: 25, mine: false });
    expect(
      await validate(plainToInstance(RequestPageDto, { mine: "yes" })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(FeedbackPageDto, { page: 0, limit: 101 })),
    ).not.toHaveLength(0);
  });
});
