import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GamesModule } from "../games/games.module.js";
import { UsersModule } from "../users/users.module.js";
import {
  GameRequestsController,
  GameReviewsController,
} from "./feedback.controller.js";
import { FeedbackService } from "./feedback.service.js";
import { GameRequest } from "./game-request.entity.js";
import { GameReview } from "./game-review.entity.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([GameRequest, GameReview]),
    GamesModule,
    UsersModule,
  ],
  controllers: [GameRequestsController, GameReviewsController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
