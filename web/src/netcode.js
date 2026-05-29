export class OnlineClient {
  constructor() {
    this.token = localStorage.getItem("aowToken") || "";
    this.player = null;
    this.recentMatches = [];
    this.leaderboard = [];
    this.catalog = [];
    this.ws = null;
    this.authenticated = false;
    this.authWaiters = [];
    this.handlers = new Map();
  }

  on(type, handler) {
    const list = this.handlers.get(type) || [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  emit(type, payload) {
    (this.handlers.get(type) || []).forEach(handler => handler(payload));
  }

  async request(path, options = {}) {
    const headers = {
      "content-type": "application/json",
      ...(options.headers || {}),
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(path, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }
    return data;
  }

  async register({ username, password, displayName, emblem = "default" }) {
    const data = await this.request("/api/auth/register", {
      method: "POST",
      body: { username, password, displayName, emblem },
    });
    this.setSession(data.token, data.player);
    return data.player;
  }

  async login({ username, password }) {
    const data = await this.request("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
    this.setSession(data.token, data.player);
    return data.player;
  }

  async loadMe() {
    if (!this.token) return null;
    const data = await this.request("/api/profile/me");
    this.player = data.player;
    this.recentMatches = data.recentMatches || [];
    return this.player;
  }

  async loadLeaderboard() {
    const data = await this.request("/api/leaderboard");
    this.leaderboard = data.players || [];
    return this.leaderboard;
  }

  async loadCommanderCatalog() {
    const data = await this.request("/api/commanders/catalog");
    this.catalog = data.commanders || [];
    return this.catalog;
  }

  async saveLoadout(commanders) {
    const data = await this.request("/api/loadout/me", {
      method: "PUT",
      body: { commanders },
    });
    this.player = data.player;
    return data.commanders || [];
  }

  logout() {
    this.token = "";
    this.player = null;
    this.recentMatches = [];
    this.leaderboard = [];
    this.catalog = [];
    localStorage.removeItem("aowToken");
    this.disconnect();
  }

  setSession(token, player) {
    this.token = token;
    this.player = player;
    localStorage.setItem("aowToken", token);
    this.authenticated = false;
  }

  connect() {
    if (!this.token) throw new Error("Login is required.");
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.authenticated = false;
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws.addEventListener("open", () => {
      this.send({ type: "AUTH", token: this.token });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "AUTH_OK") {
        this.authenticated = true;
        this.authWaiters.splice(0).forEach(resolve => resolve());
      }
      this.emit(message.type, message);
    });
    this.ws.addEventListener("close", () => {
      this.authenticated = false;
      this.authWaiters.splice(0).forEach(resolve => resolve());
      this.emit("DISCONNECTED", {});
    });
    this.ws.addEventListener("error", () => {
      this.emit("ERROR", { error: "WebSocket connection failed" });
    });
    return this.ws;
  }

  disconnect() {
    if (this.ws) this.ws.close();
    this.ws = null;
    this.authenticated = false;
  }

  whenAuthenticated() {
    if (this.authenticated) return Promise.resolve();
    this.connect();
    return new Promise((resolve) => {
      this.authWaiters.push(resolve);
    });
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  async joinQueue(mode = "quick") {
    await this.whenAuthenticated();
    this.send({ type: "JOIN_QUEUE", mode });
  }

  leaveQueue() {
    this.send({ type: "LEAVE_QUEUE" });
  }

  leaveMatch() {
    this.send({ type: "LEAVE_MATCH" });
  }

  setReady(ready = true) {
    this.send({ type: "PLAYER_READY", ready });
  }

  sendInput(commands) {
    this.send({ type: "INPUT", commands });
  }

  sendChecksum(tick, hash) {
    this.send({ type: "CHECKSUM", tick, hash });
  }
}
