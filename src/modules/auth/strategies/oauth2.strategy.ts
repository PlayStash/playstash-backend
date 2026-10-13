import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { createHash, randomBytes } from "node:crypto";
import { type VerifiedCallback } from "passport-jwt";
import { Strategy } from "passport-oauth2";
import type { AppConfiguration } from "../../../configuration.js";
import { InjectPlaystashConfig } from "../../../decorators/inject-playstash-config.decorator.js";
import { PlaystashUser } from "../../users/playstash-user.entity.js";
import { UsersService } from "../../users/users.service.js";
import { type OidcUserInfo } from "../models/oidc-user-info.interface.js";

@Injectable()
export class OAuth2Strategy extends PassportStrategy(Strategy, "oauth2", 6) {
  private readonly logger = new Logger(this.constructor.name);
  private readonly provider: string;

  constructor(
    private readonly usersService: UsersService,
    @InjectPlaystashConfig() private readonly configuration: AppConfiguration,
  ) {
    const { OAUTH2 } = configuration.AUTH;
    if (
      !OAUTH2.AUTH_URL ||
      !OAUTH2.TOKEN_URL ||
      !OAUTH2.CALLBACK_URL ||
      !OAUTH2.USERINFO_URL ||
      !OAUTH2.CLIENT_ID ||
      !OAUTH2.CLIENT_SECRET
    ) {
      throw new BadRequestException(
        "OAuth2 requires authorization, token, callback and UserInfo URLs, client ID and client secret.",
      );
    }
    for (const endpoint of [
      OAUTH2.AUTH_URL,
      OAUTH2.TOKEN_URL,
      OAUTH2.USERINFO_URL,
    ]) {
      const url = new URL(endpoint);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new BadRequestException(
          "OAuth2 endpoints must be HTTP(S) URLs without embedded credentials.",
        );
      }
    }
    super({
      passReqToCallback: true,
      authorizationURL: OAUTH2.AUTH_URL,
      tokenURL: OAUTH2.TOKEN_URL,
      clientID: OAUTH2.CLIENT_ID,
      clientSecret: OAUTH2.CLIENT_SECRET,
      callbackURL: OAUTH2.CALLBACK_URL,
      scope: OAUTH2.SCOPES,
      state: true,
    });
    this.provider = createHash("sha256")
      .update(new URL(OAUTH2.USERINFO_URL).href)
      .digest("hex");
  }

  private async fetchUserInfo(accessToken: string): Promise<OidcUserInfo> {
    try {
      const response = await fetch(
        this.configuration.AUTH.OAUTH2.USERINFO_URL!,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok || !response.body)
        throw new Error("UserInfo unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) throw new Error("UserInfo exceeds size limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const info: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!info || typeof info !== "object" || Array.isArray(info))
        throw new Error("Invalid UserInfo");
      const data = info as Record<string, unknown>;
      if (
        typeof data.sub !== "string" ||
        !data.sub.trim() ||
        data.sub.length > 255
      )
        throw new Error("Invalid subject");
      for (const field of [
        "preferred_username",
        "email",
        "given_name",
        "family_name",
        "birthdate",
      ]) {
        if (
          data[field] != null &&
          (typeof data[field] !== "string" ||
            (data[field] as string).length > 255)
        )
          throw new Error("Invalid UserInfo field");
      }
      return data as unknown as OidcUserInfo;
    } catch {
      this.logger.warn("OAuth2 UserInfo verification failed.");
      throw new UnauthorizedException(
        "Authentication Failed: The identity provider did not return valid UserInfo.",
      );
    }
  }

  async validate(
    req: { user: PlaystashUser },
    accessToken: string,
    _refreshToken: string,
    _params: unknown,
    _profile: unknown,
    done: VerifiedCallback,
  ) {
    if (!accessToken)
      throw new UnauthorizedException(
        "Authentication Failed: Missing access token.",
      );
    // Decoding JWTs does not validate signatures. Only authenticated UserInfo supplies identity.
    const info = await this.fetchUserInfo(accessToken);
    let user = await this.usersService.findUserBySsoIdentity(
      this.provider,
      info.sub,
    );
    if (!user) {
      const required = this.configuration.USERS;
      if (
        (required.REQUIRE_EMAIL && !info.email) ||
        (required.REQUIRE_FIRST_NAME && !info.given_name) ||
        (required.REQUIRE_LAST_NAME && !info.family_name)
      ) {
        throw new UnauthorizedException(
          "Authentication Failed: Your identity provider did not supply the required registration fields.",
        );
      }
      const username =
        info.preferred_username && /^\w{2,32}$/.test(info.preferred_username)
          ? info.preferred_username
          : `PlayStashUser${randomBytes(8).toString("hex")}`;
      const birthDate = info.birthdate ? new Date(info.birthdate) : undefined;
      if (birthDate && !Number.isFinite(birthDate.getTime()))
        throw new UnauthorizedException(
          "Authentication Failed: Invalid birth date.",
        );
      // Collisions fail registration; local accounts are never implicitly linked.
      user = await this.usersService.register(
        {
          username,
          email: info.email,
          first_name: info.given_name,
          last_name: info.family_name,
          password: randomBytes(24).toString("base64"),
          birth_date: birthDate?.toISOString(),
        },
        { provider: this.provider, subject: info.sub },
      );
    }
    await this.usersService.findUserForAuthOrFail({ id: user.id });
    user = await this.usersService.findOneByUserIdOrFail(user.id, {
      loadRelations: false,
    });
    req.user = user;
    done(null, user);
  }
}
