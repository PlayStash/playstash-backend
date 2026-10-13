import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function checkFolderTags(source, context) {
  const { publicGame, service, gameRepository } = context;
  const { AutoTagsService } = await import("../dist/src/modules/metadata/auto-tags.service.js");
  const { MetadataService } = await import("../dist/src/modules/metadata/metadata.service.js");
  const { GameMetadata } = await import("../dist/src/modules/metadata/games/game.metadata.entity.js");
  const { GameMetadataService } = await import("../dist/src/modules/metadata/games/game.metadata.service.js");
  const services = [];
  for (const [folder, prefix] of [["developers", "developer"], ["publishers", "publisher"], ["tags", "tag"], ["genres", "genre"]]) {
    const { [prefix[0].toUpperCase() + prefix.slice(1) + "Metadata"]: Entity } = await import(`../dist/src/modules/metadata/${folder}/${prefix}.metadata.entity.js`);
    const { [prefix[0].toUpperCase() + prefix.slice(1) + "MetadataService"]: Service } = await import(`../dist/src/modules/metadata/${folder}/${prefix}.metadata.service.js`);
    services.push(new Service(source.getRepository(Entity)));
  }
  const metadata = new GameMetadataService(source.getRepository(GameMetadata), ...services);
  const folder = await mkdtemp(path.join(tmpdir(), "playstash-auto-tags-check-"));
  assert.equal(path.dirname(path.resolve(folder)), path.resolve(tmpdir()));
  assert(path.basename(folder).startsWith("playstash-auto-tags-check-"));
  try {
    const config = { VOLUMES: { CONFIG: folder, FILES: folder }, GAMES: { WINDOWS_SETUP_DEFAULT_INSTALL_PARAMETERS: "" } };
    const rules = new AutoTagsService(config);
    const manual = await metadata.save({ provider_slug: "user", provider_data_id: String(publicGame.id), tags: [{ name: "Manual", provider_slug: "user", provider_data_id: "manual" }] });
    await gameRepository.save({ id: publicGame.id, file_path: path.join(folder, "Arcade/Game.zip"), user_metadata: manual });
    const merger = new MetadataService(service, metadata, config, rules);
    await rules.setRules({ rules: [{ folder_prefix: "Arcade", tags: ["Classic"] }] });
    await merger.merge(publicGame.id, true);
    assert.deepEqual((await service.findOneByGameIdOrFail(publicGame.id, {})).metadata.tags.map((tag) => tag.name).sort(), ["Classic", "Manual"]);
    await rules.setRules({ rules: [] });
    await merger.merge(publicGame.id, true);
    assert.deepEqual((await service.findOneByGameIdOrFail(publicGame.id, {})).metadata.tags.map((tag) => tag.name), ["Manual"]);
    console.log("Folder tags: real metadata relations, automatic tags, rule removal and preservation of manual tags verified.");
  } finally { await rm(folder, { recursive: true, force: true }); }
}
