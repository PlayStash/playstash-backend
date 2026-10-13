import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class FolderTagRuleDto {
  @ApiProperty({
    description:
      "Folder prefix relative to the game library; matches the folder itself and its descendants.",
  })
  @IsString()
  @MaxLength(1024)
  folder_prefix!: string;

  @ApiProperty({ type: String, isArray: true, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags!: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class FolderTagRulesDto {
  @ApiProperty({ type: FolderTagRuleDto, isArray: true, maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FolderTagRuleDto)
  rules!: FolderTagRuleDto[];
}

export class FolderTagRulesResultDto extends FolderTagRulesDto {
  @ApiProperty({
    description: "Games refreshed by this update; zero when reading the rules.",
  })
  applied_games!: number;
  @ApiProperty({
    description:
      "Games that could not be refreshed. A later reindex retries them.",
  })
  failed_games!: number;
}
