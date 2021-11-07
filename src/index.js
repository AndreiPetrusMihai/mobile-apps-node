const Koa = require("koa");
const app = new Koa();
const server = require("http").createServer(app.callback());
const WebSocket = require("ws");
const wss = new WebSocket.Server({ server });

const Router = require("koa-router");
const cors = require("koa-cors");
const bodyparser = require("koa-bodyparser");
const { Road, User } = require("./entities");
var koaJwt = require("koa-jwt");
var jwt = require("jsonwebtoken");

const { JWT_SECRET } = require("./secret");
const { wssInit, userSockets, sendUpdates } = require("./webSocket");
wssInit(wss);

app.use(bodyparser());
app.use(cors());
app.use(async (ctx, next) => {
  const start = new Date();
  await next();
  const ms = new Date() - start;
  console.log(`${ctx.method} ${ctx.url} ${ctx.response.status} - ${ms}ms`);
});

app.use(async (ctx, next) => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await next();
});

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.response.body = {
      issue: [{ error: err.message || "Unexpected error" }],
    };
    ctx.response.status = 500;
  }
});

const users = [
  new User({ id: 0, name: "Andrei", email: "andrei@g.com", password: "123" }),
];
let roads = [];

for (let i = 0; i < 100; i++) {
  const isOperational = parseInt((Math.random() * 20) % 2) === 1;
  console.log(isOperational);
  roads.push(
    new Road({
      id: `${i}`,
      authorId: parseInt((Math.random() * 100 + 1) % 4),
      name: `road ${i}`,
      lastMaintained: new Date(Date.now() + i),
      isOperational,
      lanes: i,
      version: 1,
    })
  );
}

console.log(roads);

let lastUpdated = roads[roads.length - 1].lastMaintained;
let lastId = roads[roads.length - 1].id;
const pageSize = 20;

const router = new Router();

router.post("/login", (ctx) => {
  const { email, password } = ctx.request.body;
  const user = users.find(
    (user) => user.email === email && user.password === password
  );

  if (user) {
    var token = jwt.sign({ ...user }, JWT_SECRET);

    ctx.response.body = token;
    ctx.response.status = 200;
    return;
  }
  ctx.response.status = 401;
});

app.use(koaJwt({ secret: JWT_SECRET }).unless({ path: [/^\/login/] }));

router.get("/roads", (ctx) => {
  const userId = ctx.state.user.id;
  const ifModifiedSince = ctx.request.get("If-Modif ied-Since");
  if (
    ifModifiedSince &&
    new Date(ifModifiedSince).getTime() >=
      lastUpdated.getTime() - lastUpdated.getMilliseconds()
  ) {
    ctx.response.status = 304; // NOT MODIFIED
    return;
  }
  let onlyOperational;
  if (ctx.request.query.onlyOperational === undefined) {
    onlyOperational = false;
  } else {
    onlyOperational = ctx.request.query.onlyOperational === "true";
  }
  const sName = ctx.request.query.sName || "";
  const page = parseInt(ctx.request.query.page) || 1;

  ctx.response.set("Last-Modified", lastUpdated.toUTCString());

  const userRoads = roads.filter((road) => road.authorId === userId);
  //search
  const roadsThatMatchName = userRoads.filter((road) =>
    road.name.includes(sName)
  );

  let filteredRoads = roadsThatMatchName;

  //filter
  if (onlyOperational) {
    filteredRoads = filteredRoads.filter((road) => road.isOperational === true);
  }

  const offset = (page - 1) * pageSize;

  const sortedRoads = filteredRoads.sort(
    (n1, n2) => -(n1.lastMaintained.getTime() - n2.lastMaintained.getTime())
  );
  ctx.response.body = {
    page,
    roads: sortedRoads.slice(offset, offset + pageSize),
    more: offset + pageSize < sortedRoads.length,
  };
  ctx.response.status = 200;
});

router.get("/road/:id", async (ctx) => {
  const roadId = ctx.request.params.id;
  const road = roads.find((road) => roadId === road.id);
  if (road) {
    ctx.response.body = road;
    ctx.response.status = 200; // ok
  } else {
    ctx.response.body = {
      issue: [{ warning: `road with id ${roadId} not found` }],
    };
    ctx.response.status = 404; // NOT FOUND (if you know the resource was deleted, then return 410 GONE)
  }
});

const createroad = async (ctx) => {
  const userId = ctx.state.user.id;
  const road = ctx.request.body;
  if (!road.name) {
    // validation
    ctx.response.body = { issue: [{ error: "Name is missing" }] };
    ctx.response.status = 400; //  BAD REQUEST
    return;
  }
  road.id = `${parseInt(lastId) + 1}`;
  lastId = road.id;
  road.lastMaintained = new Date();
  road.version = 1;
  road.authorId = userId;
  roads.push(road);
  ctx.response.body = road;
  ctx.response.status = 201; // CREATED
  sendUpdates({ event: "created", payload: { road } }, userId);
};

router.post("/road", async (ctx) => {
  await createroad(ctx);
});

router.post("/roads/sync", async (ctx) => {
  const userId = ctx.state.user.id;
  const newAndUpdatedRoads = ctx.request.body;

  newAndUpdatedRoads.forEach((road) => {
    if (road.id && !road.createdOnFrontend) {
      roads = roads.map((sRoad) => {
        if (sRoad.id === road.id && sRoad.authorId === userId) {
          const updatedRoad = { ...sRoad, ...road, lastMaintained: new Date() };
          sendUpdates(
            { event: "updated", payload: { road: updatedRoad } },
            userId
          );
          return updatedRoad;
        }
        return sRoad;
      });
    } else {
      road.id = `${parseInt(lastId) + 1}`;
      lastId = road.id;
      road.authorId = userId;
      road.lastMaintained = new Date();
      road.version = 1;
      roads = [road, ...roads];
      sendUpdates({ event: "created", payload: { road } }, userId);
    }
  });
  const userRoads = roads
    .filter((r) => r.authorId === userId)
    .slice(0, pageSize);
  ctx.response.body = userRoads;
  ctx.response.status = 200; // SUCCESS
});

router.put("/road/:id", async (ctx) => {
  const userId = ctx.state.user.id;
  const id = ctx.params.id;
  const road = ctx.request.body;
  road.lastMaintained = new Date();
  const roadId = road.id;
  if (roadId && id !== road.id) {
    ctx.response.body = {
      issue: [{ error: `Param id and body id should be the same` }],
    };
    ctx.response.status = 400; // BAD REQUEST
    return;
  }
  if (!roadId) {
    await createroad(ctx);
    return;
  }
  const index = roads.findIndex((road) => road.id === id);
  if (index === -1) {
    ctx.response.body = { issue: [{ error: `road with id ${id} not found` }] };
    ctx.response.status = 400; // BAD REQUEST
    return;
  }
  const roadVersion = parseInt(ctx.request.get("ETag")) || road.version;
  if (roadVersion < roads[index].version) {
    ctx.response.body = { issue: [{ error: `Version conflict` }] };
    ctx.response.status = 409; // CONFLICT
    return;
  }
  road.version++;
  roads[index] = road;
  lastUpdated = new Date();
  ctx.response.body = road;
  ctx.response.status = 200; // OK
  sendUpdates({ event: "updated", payload: { road } }, userId);
});

router.del("/road/:id", (ctx) => {
  const userId = ctx.state.user.id;
  const id = ctx.params.id;
  const index = roads.findIndex((road) => id === road.id);
  if (index !== -1) {
    const road = roads[index];
    roads.splice(index, 1);
    lastUpdated = new Date();
    sendUpdates({ event: "deleted", payload: { road } }, userId);
  }
  ctx.response.status = 204; // no content
});

setInterval(() => {
  lastUpdated = new Date();
  lastId = `${parseInt(lastId) + 1}`;
  const authorId = parseInt((Math.random() * 100 + 1) % 3);
  const road = new Road({
    id: lastId,
    authorId,
    name: `road ${lastId}`,
    lastMaintained: lastUpdated,
    version: 1,
    isOperational: false,
    lanes: parseInt(
      parseFloat(Math.random() * 10)
        .toString()
        .split(".")[0]
    ),
  });
  roads.push(road);
  console.log(`
   ${road.name}`);
  console.log("Created for author " + authorId);
  sendUpdates({ event: "created", payload: { road } }, authorId);
}, 10000);

app.use(router.routes());
app.use(router.allowedMethods());

server.listen(4000);
