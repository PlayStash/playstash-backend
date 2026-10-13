import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { RequestStatus } from "./game-request.entity.js";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateGameRequestDto {
  @ApiProperty({ maxLength: 256 })
  @Transform(trim)
  @IsString()
  @Matches(/\S/, { message: "A game title is required." })
  @MaxLength(256)
  title!: string;

  @ApiPropertyOptional({ maxLength: 4000, default: "" })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiPropertyOptional({
    default: false,
    description: "Hide the requester's identity from the administrator.",
  })
  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;
}

export class UpdateGameRequestDto {
  @ApiProperty({ enum: RequestStatus })
  @IsEnum(RequestStatus)
  status!: RequestStatus;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      "Optional game fulfilling the request; it must be accessible to the requester.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  game_id?: number;
}

export class PutGameReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, description: "Rating in stars." })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ maxLength: 4000, default: "" })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}

export class FeedbackPageDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RequestPageDto extends FeedbackPageDto {
  @ApiPropertyOptional({
    default: false,
    description:
      "Show only your own requests, including when you are an administrator.",
  })
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsOptional()
  @IsBoolean()
  mine?: boolean;
}

export class GameRequestViewDto {
  @ApiProperty() id!: number;
  @ApiProperty() title!: string;
  @ApiProperty() note!: string;
  @ApiProperty() anonymous!: boolean;
  @ApiProperty({ enum: RequestStatus }) status!: RequestStatus;
  @ApiPropertyOptional({ type: Number, nullable: true }) game_id!:
    number | null;
  @ApiPropertyOptional({ description: "Omitted for anonymous requests." })
  username?: string;
  @ApiPropertyOptional({ description: "Omitted for anonymous requests." })
  user_id?: number;
  @ApiProperty() mine!: boolean;
  @ApiProperty({
    description:
      "An administrator changed this request since you last acknowledged it.",
  })
  unread!: boolean;
  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}

export class GameRequestsViewDto {
  @ApiProperty({ type: GameRequestViewDto, isArray: true })
  requests!: GameRequestViewDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({
    description: "Total unread updates to your own requests, across all pages.",
  })
  unread_count!: number;
  @ApiProperty({
    description:
      "Open requests visible in the current scope, across all pages.",
  })
  open_count!: number;
}

export class GameReviewViewDto {
  @ApiProperty() id!: number;
  @ApiProperty() user_id!: number;
  @ApiProperty() username!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) rating!: number;
  @ApiProperty() comment!: string;
  @ApiProperty() mine!: boolean;
  @ApiProperty() updated_at!: Date;
}

export class GameReviewsViewDto {
  @ApiProperty({ type: GameReviewViewDto, isArray: true })
  reviews!: GameReviewViewDto[];
  @ApiPropertyOptional({ type: GameReviewViewDto, nullable: true })
  my_review!: GameReviewViewDto | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: "Average rating in stars; null if there are no reviews.",
  })
  average_rating!: number | null;
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
