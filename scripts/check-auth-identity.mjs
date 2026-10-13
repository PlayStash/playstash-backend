import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import configuration from "../dist/src/configuration.js";
import { Role } from "../dist/src/modules/users/models/role.enum.js";
import { PlaystashUser } from "../dist/src/modules/users/playstash-user.entity.js";
import { UsersService } from "../dist/src/modules/users/users.service.js";

export async function checkAuthIdentity(source) {
  const repository = source.getRepository(PlaystashUser);
  const service = new UsersService(repository, {}, {}, configuration);
  const admin = await repository.save(
    repository.create({
      username: "audit_admin",
      api_key: randomBytes(32).toString("hex"),
      email: "alpha@example.test",
      password: "not-used-in-this-test",
      role: Role.ADMIN,
      activated: true,
    }),
  );
  const literal = await repository.save(
    repository.create({
      username: "___________",
      api_key: randomBytes(32).toString("hex"),
      email: "_____@example.test",
      password: "not-used-in-this-test",
      role: Role.USER,
      activated: true,
      sso_provider: "a".repeat(64),
      sso_subject: "provider-subject",
    }),
  );
  assert.equal(
    (
      await service.findOneByUsernameOrFail("___________", {
        loadRelations: false,
      })
    ).id,
    literal.id,
  );
  assert.equal(
    (
      await service.findOneByUsernameOrFail("AUDIT_ADMIN", {
        loadRelations: false,
      })
    ).id,
    admin.id,
  );
  assert.equal(
    (await service.findUserForAuthOrFail({ username: "___________" })).id,
    literal.id,
  );
  assert.equal(
    (await service.findUserForAuthOrFail({ email: "_____@example.test" })).id,
    literal.id,
  );
  assert.equal(
    (
      await service.findUserForAuthOrFail({
        id: literal.id,
        username: admin.username,
        email: admin.email,
      })
    ).id,
    literal.id,
  );
  assert.equal(
    (await service.findUserBySsoIdentity("a".repeat(64), "provider-subject"))
      .id,
    literal.id,
  );
  assert.equal(
    await service.findUserBySsoIdentity("b".repeat(64), "provider-subject"),
    null,
  );
  await assert.rejects(
    service.findUserForAuthOrFail({ username: "%", email: "%@example.test" }),
  );
  await assert.rejects(
    repository.save(
      repository.create({
        username: "second_sso",
        api_key: randomBytes(32).toString("hex"),
        password: "unused",
        role: Role.USER,
        activated: true,
        sso_provider: "a".repeat(64),
        sso_subject: "provider-subject",
      }),
    ),
  );
  // Literal underscore usernames must not be rejected because an admin matches a LIKE pattern.
  const newUser = await service.register({
    username: "__________",
    password: "audit-password",
  });
  assert.equal(newUser.username, "__________");
  assert.equal(newUser.role, Role.USER);
}
