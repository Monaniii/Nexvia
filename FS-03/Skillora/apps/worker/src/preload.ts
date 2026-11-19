/**
 * Must be the first import of the worker entrypoint.
 *
 * `process.env` is read while the shared env/logger modules initialize, and
 * CommonJS requires run in import order — so this tiny module (which imports
 * nothing) gets the service label in before the API's logger loads.
 */
process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'skillora-worker';

export {};