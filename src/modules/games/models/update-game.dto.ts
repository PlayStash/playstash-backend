import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from "class-validator";

import { UpdateGameUserMetadataDto } from "../../metadata/models/user-game-metadata.dto.js";
import { MapGameDto } from "./map-game.dto.js";

export class UpdateGameDto {
  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      "Restrict access to administrators and allowed users (administrators only)",
  })
  access_restricted?: boolean;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @IsOptional()
  @ApiPropertyOptional({
    description:
      "Replace allowed users; an empty array allows administrators only (administrators only)",
    type: Number,
    isArray: true,
  })
  allowed_user_ids?: number[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @ApiPropertyOptional({
    description:
      "The mapping requests. If not provided, the game will not be remapped or unmapped.",
    type: MapGameDto,
    isArray: true,
  })
  mapping_requests?: MapGameDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateGameUserMetadataDto)
  @ApiPropertyOptional({
    description:
      "The updated user metadata. If not provided, the games user_metadata will not be updated.",
    type: () => UpdateGameUserMetadataDto,
  })
  user_metadata?: UpdateGameUserMetadataDto;
}
