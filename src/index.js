const Koa = require("koa");
const app = new Koa();
const server = require("http").createServer(app.callback());
const WebSocket = require("ws");
const wss = new WebSocket.Server({ server });
const Router = require("koa-router");
const cors = require("koa-cors");
const bodyparser = require("koa-bodyparser");

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

class Road {
  constructor({ id, name, lanes, lastMaintained, isOperational, version }) {
    this.id = id;
    this.name = name;
    this.lanes = lanes;
    this.lastMaintained = lastMaintained;
    this.isOperational = isOperational;
    this.version = version;
  }
}

const roads = [];
for (let i = 0; i < 3; i++) {
  roads.push(
    new Road({
      id: `${i}`,
      name: `road ${i}`,
      lastMaintained: new Date(Date.now() + i),
      isOperational: true,
      lanes: 2,
      version: 1,
    })
  );
}
let lastUpdated = roads[roads.length - 1].lastMaintained;
let lastId = roads[roads.length - 1].id;
const pageSize = 10;

const broadcast = (data) =>
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });

const router = new Router();

router.get("/road", (ctx) => {
  const ifModifiedSince = ctx.request.get("If-Modif ied-Since");
  if (
    ifModifiedSince &&
    new Date(ifModifiedSince).getTime() >=
      lastUpdated.getTime() - lastUpdated.getMilliseconds()
  ) {
    ctx.response.status = 304; // NOT MODIFIED
    return;
  }
  const name = ctx.request.query.name;
  const page = parseInt(ctx.request.query.page) || 1;
  ctx.response.set("Last-Modified", lastUpdated.toUTCString());
  const sortedRoads = roads
    .filter((road) => (name ? road.name.indexOf(name) !== -1 : true))
    .sort(
      (n1, n2) => -(n1.lastMaintained.getTime() - n2.lastMaintained.getTime())
    );
  const offset = (page - 1) * pageSize;
  // ctx.response.body = {
  //   page,
  //   roads: sortedRoads.slice(offset, offset + pageSize),
  //   more: offset + pageSize < sortedRoads.length
  // };sortedRoads
  ctx.response.body = roads;
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
  roads.push(road);
  ctx.response.body = road;
  ctx.response.status = 201; // CREATED
  broadcast({ event: "created", payload: { road } });
};

router.post("/road", async (ctx) => {
  await createroad(ctx);
});

router.put("/road/:id", async (ctx) => {
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
  broadcast({ event: "updated", payload: { road } });
});

router.del("/road/:id", (ctx) => {
  const id = ctx.params.id;
  const index = roads.findIndex((road) => id === road.id);
  if (index !== -1) {
    const road = roads[index];
    roads.splice(index, 1);
    lastUpdated = new Date();
    broadcast({ event: "deleted", payload: { road } });
  }
  ctx.response.status = 204; // no content
});

setInterval(() => {
  lastUpdated = new Date();
  lastId = `${parseInt(lastId) + 1}`;
  const road = new Road({
    id: lastId,
    name: `road ${lastId}`,
    lastMaintained: lastUpdated,
    version: 1,
  });
  roads.push(road);
  console.log(`
   ${road.name}`);
  console.log("Sending");
  broadcast({ event: "created", payload: { road } });
}, 10000);

app.use(router.routes());
app.use(router.allowedMethods());

server.listen(3000);
