const cors = require('cors');
const express = require('express');

/** Public and ordinary routes: JSON is small. Registration, login and CRUD never need more. */
const DEFAULT_BODY_LIMIT = '256kb';

/** Routes that carry base64 images (product photo, witness ID photo, receipt logo). Signed-in callers only. */
const IMAGE_BODY_LIMIT = '15mb';
const IMAGE_ROUTE_PREFIXES = ['/api/items', '/api/sales', '/api/settings'];

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function isLocalEnv(env) {
  return ['development', 'test'].includes(env.NODE_ENV);
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Origins allowed to call the API from a browser: APP_URL plus the comma separated CORS_ORIGINS. */
function allowedOrigins(env = process.env) {
  const list = [env.APP_URL, ...String(env.CORS_ORIGINS || '').split(',')]
    .map(normalizeOrigin)
    .filter(Boolean);
  return [...new Set(list)];
}

function isOriginAllowed(origin, env = process.env) {
  // Non-browser callers send no Origin. CORS does not protect against them, authentication does.
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (allowedOrigins(env).includes(normalized)) return true;
  return isLocalEnv(env) && LOCAL_ORIGIN.test(normalized);
}

function buildCorsOptions(env = process.env) {
  return {
    origin(origin, callback) {
      // Refusing sends no CORS headers; the browser blocks the response. No error page, no 500.
      callback(null, isOriginAllowed(origin, env));
    },
    maxAge: 600,
  };
}

/**
 * Registers CORS and body parsers. `authenticate` runs before the large image parser, so an
 * anonymous caller can never make the server buffer more than DEFAULT_BODY_LIMIT.
 */
function applyHttpMiddleware(app, { authenticate, env = process.env } = {}) {
  app.use(cors(buildCorsOptions(env)));

  if (authenticate) {
    app.use(IMAGE_ROUTE_PREFIXES, authenticate, express.json({ limit: IMAGE_BODY_LIMIT }));
  }
  app.use(express.json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}

module.exports = {
  DEFAULT_BODY_LIMIT,
  IMAGE_BODY_LIMIT,
  IMAGE_ROUTE_PREFIXES,
  allowedOrigins,
  isOriginAllowed,
  buildCorsOptions,
  applyHttpMiddleware,
};
