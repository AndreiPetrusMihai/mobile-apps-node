import { JWT_SECRET } from "./secret";
const WebSocket = require("ws");

var jwt = require("jsonwebtoken");

export let userSockets = [];

export const sendUpdates = (data, userId) => {
  userSockets.forEach((socketUserPair) => {
    if (
      socketUserPair.userId === userId &&
      socketUserPair.socket.readyState === WebSocket.OPEN
    ) {
      socketUserPair.socket.send(JSON.stringify(data));
    }
  });
};

function toEvent(message) {
  try {
    var event = JSON.parse(message);

    this.emit(event.type, event.payload);
  } catch (err) {
    console.log("not an event", err);
  }
}

export const wssInit = (wss) => {
  wss.on("connection", function connection(ws, request) {
    let jwtPayload;
    ws.on("message", toEvent);
    ws.on("authenticate", (data) => {
      try {
        jwtPayload = jwt.verify(data, JWT_SECRET);
        userSockets.push({ userId: jwtPayload.id, socket: ws });
      } catch (e) {
        console.log("bad token");
        ws.close();
      }
    });

    ws.on("error", () => {
      ws.close();
    });

    ws.on("close", () => {
      userSockets = userSockets.filter(
        (socket) => socket.userId !== jwtPayload.id
      );
    });
  });
};
