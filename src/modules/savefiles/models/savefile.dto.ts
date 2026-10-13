import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Metadata for one save archive. Absolute server filesystem paths are never exposed. */
export class SavefileDto {
  @ApiProperty({
    description:
      "Save archive filename; use it when downloading or deleting this version.",
  })
  filename!: string;

  @ApiProperty({ description: "Archive size in bytes." })
  size!: number;

  @ApiProperty({
    description: "Archive creation time.",
    type: String,
    format: "date-time",
  })
  created_at!: Date;

  @ApiPropertyOptional({
    description: "Installation UUID associated with this save archive.",
  })
  installation_id?: string;
}
