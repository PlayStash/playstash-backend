import assert from "node:assert/strict";

/** Exercise feedback with the real migrated database, on both supported drivers. */
export async function checkLibraryFeedback(source, context) {
  const { permitted, denied, publicGame, privateGame, service, userRepository } = context;
  const { GameRequest, RequestStatus } = await import("../dist/src/modules/feedback/game-request.entity.js");
  const { GameReview } = await import("../dist/src/modules/feedback/game-review.entity.js");
  const { FeedbackService } = await import("../dist/src/modules/feedback/feedback.service.js");
  const requestRepository = source.getRepository(GameRequest);
  const reviewRepository = source.getRepository(GameReview);
  const feedback = new FeedbackService(requestRepository, reviewRepository, service, {
    findUserAgeByUsername: async () => undefined,
    findOneByUserIdOrFail: (id) => userRepository.findOneByOrFail({ id }),
  });
  const admin = { ...permitted, role: 3 };
  const created = await feedback.createRequest(denied, { title: "  Requested game  ", note: " please ", anonymous: true });
  assert.equal(created.title, "Requested game");
  assert.equal(created.note, "please");
  assert.equal(created.username, undefined);
  assert.equal(created.user_id, undefined);
  assert.equal(JSON.stringify(created).includes("test-only"), false);
  assert.equal((await feedback.listRequests(permitted, {})).total, 0);
  assert.equal((await feedback.listRequests(admin, {})).total, 1);
  assert.equal((await feedback.listRequests(admin, { mine: true })).total, 0);
  await assert.rejects(feedback.updateRequest(created.id, denied, { status: RequestStatus.FULFILLED }));
  await assert.rejects(feedback.updateRequest(created.id, admin, { status: RequestStatus.FULFILLED, game_id: privateGame.id }));
  await assert.rejects(feedback.acknowledgeRequest(created.id, permitted));
  await requestRepository.update(created.id, { user_seen_at: new Date(0) });
  await feedback.updateRequest(created.id, admin, { status: RequestStatus.FULFILLED, game_id: publicGame.id });
  const updated = await feedback.listRequests(denied, {});
  assert.equal(updated.requests[0].game_id, publicGame.id);
  assert.equal(updated.requests[0].unread, true);
  assert.equal(updated.unread_count, 1);
  assert.equal((await feedback.acknowledgeRequest(created.id, denied)).unread, false);
  assert.equal((await feedback.listRequests(denied, {})).unread_count, 0);
  await assert.rejects(feedback.cancelRequest(created.id, denied));
  const open = await feedback.createRequest(denied, { title: "Cancel me" });
  await assert.rejects(feedback.cancelRequest(open.id, permitted));
  await feedback.cancelRequest(open.id, denied);
  assert.equal((await feedback.listRequests(denied, {})).total, 1);
  await assert.rejects(feedback.listReviews(privateGame.id, denied, {}));
  await assert.rejects(feedback.putReview(privateGame.id, denied, { rating: 5 }));
  await feedback.putReview(publicGame.id, denied, { rating: 3, comment: " first " });
  await feedback.putReview(publicGame.id, denied, { rating: 4, comment: " changed " });
  await feedback.putReview(publicGame.id, permitted, { rating: 2 });
  const reviews = await feedback.listReviews(publicGame.id, denied, { limit: 1, page: 1 });
  assert.equal(reviews.total, 2);
  assert.equal(reviews.reviews.length, 1);
  assert.equal(reviews.average_rating, 3);
  assert.equal(reviews.my_review.comment, "changed");
  assert.equal(reviews.my_review.rating, 4);
  assert.equal(JSON.stringify(reviews).includes("test-only"), false);
  await assert.rejects(reviewRepository.save({ game_id: publicGame.id, user_id: admin.id, rating: 6 }));
  await feedback.deleteReview(publicGame.id, denied);
  const after = await feedback.listReviews(publicGame.id, denied, {});
  assert.equal(after.total, 1);
  assert.equal(after.average_rating, 2);
  assert.equal(after.my_review, null);
  console.log("Game requests/reviews: migrated tables, anonymous views, owner/admin permissions, unread acknowledgments, game ACLs, unique reviews and averages verified.");
}
