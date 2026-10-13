import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  type StreamableFile,
  UnauthorizedException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { type Response } from "express";
import ms from "ms";
import { randomBytes } from "node:crypto";
import { Role } from "../users/models/role.enum.js";
import { UsersService } from "../users/users.service.js";
import { FilesService } from "./../games/files.service.js";
import Otp from "./models/otp.model.js";

@Injectable()
export class OtpService {
  private readonly logger = new Logger(this.constructor.name);
  private readonly otps = new Map<string, Otp>();

  constructor(
    private readonly filesService: FilesService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService?: UsersService,
  ) {}

  @Interval("cleanupOtps", ms("5m"))
  private cleanup() {
    this.otps.forEach((otp) => {
      if (otp.expiresAt < new Date(Date.now())) {
        this.otps.delete(otp.otp);
      }
    });
  }

  public create(
    username: string,
    gameId?: number,
    versionId?: number,
    xDownloadSpeedLimit?: number,
  ): string {
    const randomOtp = randomBytes(64).toString("hex");
    const otp = new Otp(
      randomOtp,
      username,
      gameId,
      versionId,
      xDownloadSpeedLimit,
    );
    this.otps.set(randomOtp, otp);
    this.logger.log("OTP Created.", otp.getLoggableData());
    return randomOtp;
  }

  async get(otp: string, response: Response): Promise<StreamableFile> {
    const existingOtp = this.otps.get(otp);
    if (!existingOtp) {
      throw new UnauthorizedException("Invalid OTP");
    }
    if (existingOtp.expiresAt < new Date(Date.now())) {
      throw new UnauthorizedException("Expired OTP");
    }
    this.logger.log("OTP Validated.", existingOtp.getLoggableData());
    this.otps.delete(otp);
    // Re-resolve the user on redemption so permissions revoked after issuance
    // cannot be bypassed by an existing download token.
    const user = await this.usersService?.findOneByUsernameOrFail(
      existingOtp.username,
      { loadRelations: false, loadDeletedEntities: false },
    );
    if (
      this.usersService &&
      (!user || (!user.activated && user.role !== Role.ADMIN))
    ) {
      throw new UnauthorizedException("The download user is no longer active.");
    }
    return this.filesService.download(
      response,
      existingOtp.gameId ?? 0,
      existingOtp.versionId,
      existingOtp.xDownloadSpeedLimit,
      undefined,
      user
        ? await this.usersService!.findUserAgeByUsername(user.username)
        : undefined,
      user,
    );
  }
}
