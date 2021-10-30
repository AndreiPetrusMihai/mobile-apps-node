export class Road {
  constructor({ id, name, lanes, lastMaintained, isOperational, version }) {
    this.id = id;
    this.name = name;
    this.lanes = lanes;
    this.lastMaintained = lastMaintained;
    this.isOperational = isOperational;
    this.version = version;
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
