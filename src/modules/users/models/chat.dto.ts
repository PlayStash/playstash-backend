import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ChatTargetDto {
  @ApiPropertyOptional({
    example: "lobby",
    description:
      "lobby or game:<positive game ID>; defaults to lobby. Mutually exclusive with recipient_user_id.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  room?: string;

  @ApiPropertyOptional({ description: "User ID for a direct conversation." })
  @IsOptional()
  @IsInt()
  @Min(1)
  recipient_user_id?: number;
}

export class ChatSendDto extends ChatTargetDto {
  @ApiProperty({
    maxLength: 2000,
    description: "Plain text; clients must render it as text, never HTML.",
  })
  @IsString()
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Optional UUID v4 for retry-safe delivery within retained history.",
  })
  @IsOptional()
  @IsUUID("4")
  client_message_id?: string;
}

export class ChatHistoryDto extends ChatTargetDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ChatMessageDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiPropertyOptional({ format: "uuid" }) client_message_id?: string;
  @ApiProperty() user_id!: number;
  @ApiProperty() username!: string;
  @ApiProperty() text!: string;
  @ApiPropertyOptional() room?: string;
  @ApiPropertyOptional() recipient_user_id?: number;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}
