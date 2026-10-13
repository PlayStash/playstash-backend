import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PackageAssetDto {
  @ApiProperty({
    description: "Opaque asset ID used to download this extra or addon.",
  })
  id!: string;
  @ApiProperty({ description: "Relative path inside the game's folder." })
  path!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty({
    enum: ["extra", "manual", "soundtrack", "mod", "dlc", "patch"],
  })
  kind!: string;
  @ApiProperty({ description: "File size in bytes.", type: String })
  size!: string;
}

export class PackageDescriptorDto {
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description:
      "Validated schema_version 1 package manifest; recipes require local user consent.",
  })
  manifest?: Record<string, any>;
  @ApiProperty({ type: PackageAssetDto, isArray: true })
  extras!: PackageAssetDto[];
  @ApiProperty({ type: PackageAssetDto, isArray: true })
  addons!: PackageAssetDto[];
}
