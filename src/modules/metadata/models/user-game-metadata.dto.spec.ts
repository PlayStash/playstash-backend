import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateGameDto } from "../../games/models/update-game.dto.js";
import { UpdateGameUserMetadataDto } from "./user-game-metadata.dto.js";

describe("shared game metadata validation", () => {
  it("accepts optional fields and relative launch profiles in a nested game update", async () => {
    const dto = plainToInstance(UpdateGameDto, {
      user_metadata: {
        archive_password: "secret",
        system_requirements_minimum: "**RAM:** 4 GB",
        system_requirements_recommended: "**RAM:** 8 GB",
        launch_profiles: [
          {
            name: "Single player",
            executable: "gzdoom/gzdoom.exe",
            parameters: "-iwad DOOM2/DOOM2.WAD",
          },
        ],
      },
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.user_metadata).toBeInstanceOf(UpdateGameUserMetadataDto);
  });

  it.each([
    "../outside.exe",
    "game/../../outside.exe",
    "C:\\Windows\\cmd.exe",
    "/usr/bin/sh",
    "\\\\server\\share\\app.exe",
  ])(
    "rejects a launch profile outside the installation: %s",
    async (executable) => {
      const dto = plainToInstance(UpdateGameUserMetadataDto, {
        launch_profiles: [{ name: "Unsafe", executable }],
      });
      expect(await validate(dto)).not.toEqual([]);
    },
  );

  it("rejects duplicate profile names ignoring case and whitespace", async () => {
    const dto = plainToInstance(UpdateGameUserMetadataDto, {
      launch_profiles: [
        { name: "Play", executable: "game.exe" },
        { name: " play ", executable: "other.exe" },
      ],
    });
    expect(await validate(dto)).not.toEqual([]);
  });

  it("rejects malformed nested profiles without throwing a validation exception", async () => {
    const dto = plainToInstance(UpdateGameUserMetadataDto, {
      launch_profiles: [{ name: 123, executable: true }],
    });
    expect(await validate(dto)).not.toEqual([]);
  });

  it("accepts explicit clearing of shared defaults", async () => {
    const dto = plainToInstance(UpdateGameUserMetadataDto, {
      archive_password: "",
      launch_profiles: [],
      system_requirements_minimum: "",
    });
    expect(await validate(dto)).toEqual([]);
  });

  it("accepts save folder paths and an empty list that clears them", async () => {
    for (const save_paths of [
      ["%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing", "%INSTALLDIR%/saves"],
      [],
    ]) {
      const dto = plainToInstance(UpdateGameUserMetadataDto, { save_paths });
      expect(await validate(dto)).toEqual([]);
    }
  });

  it.each([[[""]], [["x".repeat(1025)]], [[42]], ["not-an-array"]])(
    "rejects invalid save folder paths: %j",
    async (save_paths) => {
      const dto = plainToInstance(UpdateGameUserMetadataDto, { save_paths });
      expect(await validate(dto)).not.toEqual([]);
    },
  );
});
