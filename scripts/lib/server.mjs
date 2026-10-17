#!/usr/bin/env node
/**
 * scripts/lib/server.mjs — where a browser-driven check gets its local origin from.
 *
 * Every browser check in this repository serves the built site (or a fixture) on
 * `http://127.0.0.1:<ephemeral>` and points Chrome at it. That is one shared decision, and it has
 * a failure mode that costs an hour to diagnose when it happens: **Chrome refuses to connect to a
 * set of ports it considers unsafe** (`net::ERR_UNSAFE_PORT`). The kernel will happily hand out
 * one of them from `listen(0)` — 6566 was measured doing exactly that here — and the check then
 * fails with what looks like a page that never loaded.
 *
 * So the port choice is not "the kernel's business": a port on Chrome's restricted list is
 * discarded and another one requested, up to five times, and a port another process took between
 * the request and the bind is retried the same way. `reserveFreePort()` is the same rule for a
 * port that is handed to a *child process* (the `seite serve` preview) instead of bound in-process.
 *
 * The list is Chromium's `net/base/port_util.cc` `kRestrictedPorts`, which is what `ERR_UNSAFE_PORT`
 * is computed from. It is copied, not probed: probing would need a real Chrome and would be
 * testing the network instead of picking a number.
 */
import net from 'node:net';

/** Ports Chrome refuses to navigate to (ERR_UNSAFE_PORT), copied from Chromium's restricted list. */
export const CHROME_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

/** `true` when Chrome would answer a request to this port with ERR_UNSAFE_PORT. */
export function isChromeBlockedPort(port) {
  return CHROME_BLOCKED_PORTS.has(port);
}

/** Close a server that may not be listening at all, without caring whether it was. */
function closeQuietly(server) {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Bind `server` to an ephemeral port on the loopback interface that Chrome will actually accept.
 *
 * @param {import('node:http').Server} server an already-configured server (no listener yet)
 * @param {{attempts?: number}} [options]
 * @returns {Promise<import('node:net').AddressInfo>} what `server.address()` reports
 */
export async function listenOnFreePort(server, { attempts = 5 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, '127.0.0.1');
      });
    } catch (error) {
      lastError = error;
      await closeQuietly(server);
      continue;
    }

    const address = server.address();
    if (!isChromeBlockedPort(address.port)) return address;
    lastError = new Error(`port ${address.port} is on Chrome's blocked list (ERR_UNSAFE_PORT)`);
    await closeQuietly(server);
  }
  throw new Error(
    `no Chrome-safe loopback port after ${attempts} attempt(s): ${lastError?.message ?? 'unknown error'}`,
  );
}

/**
 * A port number that is free *now* and that Chrome will connect to — for handing to a child
 * process, which cannot inherit the socket we bound. The window between closing this probe and the
 * child binding is a race in principle; in practice the alternative (letting the child pick) is
 * the very port-blocked failure this module exists to avoid.
 *
 * @param {{attempts?: number}} [options]
 * @returns {Promise<number>}
 */
export async function reserveFreePort({ attempts = 5 } = {}) {
  const server = net.createServer();
  const { port } = await listenOnFreePort(server, { attempts });
  await closeQuietly(server);
  return port;
}
