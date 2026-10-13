# Game requests and community reviews

Signed-in library users can ask their administrator to add a game. Requests contain
a title, an optional note, and an optional anonymous flag. An anonymous request
keeps its owner internally so status updates can reach them; neither the owner ID
nor the username is returned to administrators or other users in that request's
API response. Do not include identifying information in the title or note if you
want an anonymous request.

- `GET /api/requests`: your own requests; administrators see all requests by default.
  `?mine=true` always selects your own requests. `page` and `limit` paginate results.
- `POST /api/requests`: `{ "title": "A game", "note": "Optional note", "anonymous": true }`.
- `PATCH /api/requests/:id`: administrator-only status changes to `open`, `approved`,
  `fulfilled`, or `rejected`. A fulfilled request can include `game_id`, provided
  that the requester can access that game under their age and library permissions.
- `PUT /api/requests/:id/seen`: acknowledge an update to your own request.
- `DELETE /api/requests/:id`: cancel your own request while it is open.

Responses expose `unread`, `unread_count`, and `open_count`. Clients can poll the
request list for updates and administrator counters without an external messaging
service. If library permissions are revoked later, the game's ID is hidden from
the requester on subsequent reads. Administrators adding games still provide their
own files; this is a self-hosted library request queue.

Game pages support one community review per user, with an integer rating from one
to five stars and an optional comment of at most 4,000 characters. Reviews are
visible to users who can access that game, alongside the average rating. Publishing
exposes your library username with your review.

- `GET /api/games/:game_id/reviews`: paginated reviews, `average_rating`, `total`,
  and `my_review`, even if your review is on another page.
- `PUT /api/games/:game_id/reviews/me`: publish or replace
  `{ "rating": 5, "comment": "My review" }`.
- `DELETE /api/games/:game_id/reviews/me`: remove your own rating and review.

Game access and age restrictions apply to reading, publishing, and deleting
reviews. Review responses contain the username and public review fields only.
