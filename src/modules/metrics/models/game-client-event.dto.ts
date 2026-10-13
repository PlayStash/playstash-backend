import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export enum GameClientEventType {
  DOWNLOADED = "downloaded",
  INSTALLED = "installed",
  UNINSTALLED = "uninstalled",
  PLAYED = "played",
}

export class CreateGameClientEventDto {
  @IsUUID(4)
  @ApiProperty({
    description:
      "Client-generated UUID v4; reuse it when retrying the same event",
  })
  event_id!: string;

  @IsEnum(GameClientEventType)
  @ApiProperty({ enum: GameClientEventType })
  type!: GameClientEventType;

  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ description: "The exact game version, when known" })
  version_id?: number;

  @IsUUID(4)
  @IsOptional()
  @ApiPropertyOptional({
    description: "Device installation UUID, when available",
  })
  installation_id?: string;

  @IsDateString()
  @IsOptional()
  @ApiPropertyOptional({
    type: String,
    format: "date-time",
    description: "Client occurrence time; defaults to server time",
  })
  occurred_at?: string;

  @IsInt()
  @Min(0)
  @Max(10080)
  @IsOptional()
  @ApiPropertyOptional({
    description:
      "Completed session duration in minutes, only for a played event",
  })
  minutes_played?: number;
}

export class GameClientEventAcceptedDto {
  @ApiProperty() event_id!: string;
  @ApiProperty({
    description:
      "False when reporting is disabled or the event is outside retention",
  })
  accepted!: boolean;
}

export class GameClientEventDto {
  @ApiProperty() id!: number;
  @ApiProperty() event_id!: string;
  @ApiProperty({ enum: GameClientEventType }) type!: GameClientEventType;
  @ApiProperty() user_id!: number;
  @ApiProperty() game_id!: number;
  @ApiPropertyOptional() version_id?: number;
  @ApiPropertyOptional() installation_id?: string;
  @ApiProperty({ type: String, format: "date-time" }) occurred_at!: Date;
  @ApiProperty() minutes_played!: number;
}

export class GameMetricsSummaryDto {
  @ApiProperty() downloaded!: number;
  @ApiProperty() installed!: number;
  @ApiProperty() uninstalled!: number;
  @ApiProperty() played!: number;
  @ApiProperty() minutes_played!: number;
}
