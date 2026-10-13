import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

/** Shared launch defaults; the client executes them only inside its game installation. */
export class LaunchProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @ApiProperty({
    description: "Display name of the launch profile.",
    example: "Single player",
  })
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  @Matches(/^(?![\\/])(?!.*:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\r\n\0]+$/, {
    message:
      "The executable must be a relative path inside the game installation.",
  })
  @ApiProperty({
    description: "Executable path relative to the game installation.",
    example: "gzdoom/gzdoom.exe",
  })
  executable!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  @ApiPropertyOptional({
    description: "Arguments passed to the executable.",
    example: "-iwad DOOM2/DOOM2.WAD",
  })
  parameters?: string;
}
