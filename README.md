# Tidepool

**Find your quiet corner.** Tidepool is a small simultaneous strategy game for 2–6 people. Everyone picks one of five reefs each round. The quieter your landing spot, the more it scores; a private favorite reef and the shifting public tide add a little temptation to every choice. Six quick rounds make a full game.

## Play

Open the game and choose **Practice with minnows** to play right away, or make a room and share its five-letter code or invite link. In a room, everyone marks ready and the host starts. Each round, tap one reef before the 35-second tide turns. A solo room includes two computer explorers. The end screen shows the winner and scores; the host can start a fresh game in the same room.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Then open <http://localhost:3000>. The same process serves the browser game and the WebSocket multiplayer service. Room state stays in memory, so a restart clears rooms. No accounts or personal data are collected; a display name is used only in the room.

## Deploy on Render

The included `render.yaml` describes a free Node web service with a `/health` health check. To deploy:

1. Create a public GitHub repository named `tidepool` (leave “Add a README” unchecked).
2. From this folder, publish the local project:

   ```sh
   git add -A
   git commit -m "Build Tidepool multiplayer game"
   git remote add origin https://github.com/YOUR-USER/tidepool.git
   git push -u origin main
   ```

   The local project is already initialized on `main`.
3. In Render, choose **New → Blueprint**, connect GitHub if asked, and select the `tidepool` repository.
4. Review the single free web service and click **Deploy Blueprint**.
5. When its status is **Live**, open the `onrender.com` URL shown on the service page and put it in `SUBMISSION.md`.

Render's free service sleeps after 15 minutes without an incoming HTTP request or WebSocket message, then takes about a minute to wake on the next visit. Its loading screen and the game's connection message cover that wait. Render supports inbound WebSockets on public web services. The game needs only `PORT`, which Render supplies. [Render free service limits](https://render.com/docs/free) · [Blueprint setup](https://render.com/docs/infrastructure-as-code) · [WebSockets](https://render.com/docs/websocket).

## Verify multiplayer

```sh
npm run test:multiplayer
```

This starts a local server and drives three concurrent WebSocket clients through a six-round game, including host handoff, reconnect with the saved seat token, scoring, and rejection of an invalid action.

## How it works

The Node server owns room membership, host/ready state, round timers, tide and favorite assignments, choices, and scoring. Clients submit only a reef index; the server checks phase, seat, and bounds before accepting it. Rooms support up to six players, a 45-second reconnect window, host reassignment, and cleanup of abandoned lobbies. The solo practice option adds two lightweight computer players.
