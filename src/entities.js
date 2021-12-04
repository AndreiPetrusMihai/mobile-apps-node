export class Road {
  constructor({
    id,
    authorId,
    name,
    lanes,
    lastMaintained,
    isOperational,
    version,
    base64Photo,
    lat,
    long,
  }) {
    this.id = id;
    this.authorId = authorId;
    this.name = name;
    this.lanes = lanes;
    this.lastMaintained = lastMaintained;
    this.isOperational = isOperational;
    this.version = version;
    this.base64Photo = base64Photo;
    this.lat = lat;
    this.long = long;
  }
}

export class User {
  constructor({ id, email, name, password }) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.password = password;
  }
}
