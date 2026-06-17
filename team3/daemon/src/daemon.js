'use strict';

const { WebSocketServer } = require('ws');
const config = require('./config');
const ProjectJson = require('./project-json');

function formatTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Team3 Daemon - Local scheduling hub
 *
 * Responsibilities (Feature #1):
 * - Start as a persistent Node.js process
 * - Listen on configurable port (default 3100)
 * - Write PID to .team3-project.json init_daemon field
 * - WebSocket server accepting client connections
 * - ping/pong heartbeat to keep connections alive
 * - Periodically update daemon_heart in .team3-project.json
 * - Support client disconnect/reconnect
 */
class Daemon {
  constructor(options = {}) {
    this.port = options.port || config.port;
    this.projectJsonPath = options.projectJsonPath || config.projectJsonPath;
    this.heartbeatInterval = options.heartbeatInterval || config.heartbeatInterval;
    this.wsPingInterval = options.wsPingInterval || config.wsPingInterval;

    this.projectJson = new ProjectJson(this.projectJsonPath);
    this.wss = null;
    this.heartbeatTimer = null;
    this.pingTimer = null;
    this.clients = new Set();
    this.isRunning = false;
  }

  /**
   * Start the daemon process
   */
  start() {
    return new Promise((resolve, reject) => {
      // Create WebSocket server
      this.wss = new WebSocketServer({ port: this.port }, () => {
        this.isRunning = true;

        // Write PID to .team3-project.json
        this._writePid();

        // Start heartbeat (periodic daemon_heart update)
        this._startHeartbeat();

        // Start WebSocket ping interval
        this._startPingInterval();

        console.log(`[Daemon] Started on port ${this.port} (PID: ${process.pid})`);
        resolve(this);
      });

      this.wss.on('error', (err) => {
        if (!this.isRunning) {
          reject(err);
        } else {
          console.error('[Daemon] WebSocket server error:', err.message);
        }
      });

      // Handle new connections
      this.wss.on('connection', (ws, req) => {
        this._handleConnection(ws, req);
      });
    });
  }

  /**
   * Stop the daemon gracefully
   */
  stop() {
    return new Promise((resolve) => {
      this.isRunning = false;

      // Clear timers
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }

      // Close all client connections
      for (const client of this.clients) {
        client.ws.terminate();
      }
      this.clients.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close(() => {
          console.log('[Daemon] Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Write current PID to .team3-project.json
   */
  _writePid() {
    try {
      this.projectJson.update({ init_daemon: process.pid });
    } catch (err) {
      console.error('[Daemon] Failed to write PID:', err.message);
    }
  }

  /**
   * Start periodic heartbeat - updates daemon_heart in .team3-project.json
   */
  _startHeartbeat() {
    // Write initial heartbeat
    this._updateHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      this._updateHeartbeat();
    }, this.heartbeatInterval);

    // Don't keep process alive just for heartbeat
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Update daemon_heart field with current timestamp
   */
  _updateHeartbeat() {
    try {
      this.projectJson.update({ daemon_heart: formatTs() });
    } catch (err) {
      console.error('[Daemon] Failed to update heartbeat:', err.message);
    }
  }

  /**
   * Start WebSocket ping interval to detect dead connections
   */
  _startPingInterval() {
    this.pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          // Client didn't respond to last ping - terminate
          console.log(`[Daemon] Client ${client.id} failed ping check, terminating`);
          client.ws.terminate();
          this.clients.delete(client);
          continue;
        }
        client.alive = false;
        client.ws.ping();
      }
    }, this.wsPingInterval);

    if (this.pingTimer.unref) {
      this.pingTimer.unref();
    }
  }

  /**
   * Handle a new WebSocket connection
   */
  _handleConnection(ws, req) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const client = {
      id: clientId,
      ws,
      alive: true,
      connectedAt: formatTs(),
    };

    this.clients.add(client);
    console.log(`[Daemon] Client connected: ${clientId} (total: ${this.clients.size})`);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      daemonPid: process.pid,
      timestamp: formatTs(),
    }));

    // Handle pong response (heartbeat)
    ws.on('pong', () => {
      client.alive = true;
    });

    // Handle incoming messages
    ws.on('message', (data) => {
      this._handleMessage(client, data);
    });

    // Handle disconnect
    ws.on('close', (code, reason) => {
      this.clients.delete(client);
      console.log(`[Daemon] Client disconnected: ${clientId} (code: ${code}, total: ${this.clients.size})`);
    });

    // Handle errors
    ws.on('error', (err) => {
      console.error(`[Daemon] Client ${clientId} error:`, err.message);
      this.clients.delete(client);
    });
  }

  /**
   * Handle incoming message from a client
   */
  _handleMessage(client, rawData) {
    try {
      const message = JSON.parse(rawData.toString());

      // Handle ping from client (application-level)
      if (message.type === 'ping') {
        client.ws.send(JSON.stringify({
          type: 'pong',
          timestamp: formatTs(),
        }));
        return;
      }

      // Echo back for now (future features will add routing)
      client.ws.send(JSON.stringify({
        type: 'ack',
        messageId: message.id || null,
        timestamp: formatTs(),
      }));
    } catch (err) {
      // Non-JSON message, just acknowledge
      client.ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid JSON message',
        timestamp: formatTs(),
      }));
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const client of this.clients) {
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(payload);
      }
    }
  }

  /**
   * Get number of connected clients
   */
  get clientCount() {
    return this.clients.size;
  }
}

// If run directly (not imported), start the daemon
if (require.main === module) {
  const daemon = new Daemon();

  daemon.start().catch((err) => {
    console.error('[Daemon] Failed to start:', err.message);
    process.exit(1);
  });

  // Graceful shutdown on signals
  const shutdown = async () => {
    console.log('\n[Daemon] Shutting down...');
    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = Daemon;
