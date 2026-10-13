import { readFile } from "node:fs/promises";
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("A semantic release version is required.");
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const sections = changelog.split(/^## /m).slice(1);
const section = sections.find((text) => text.split(/\r?\n/)[0].trim() === version);
if (!section) throw new Error(`CHANGELOG.md has no entry for ${version}.`);
console.log(section.slice(section.indexOf("\n") + 1).trim());
