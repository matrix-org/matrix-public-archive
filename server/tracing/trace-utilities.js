'use strict';

const assert = require('assert');
const opentelemetryApi = require('@opentelemetry/api');

const packageInfo = require('../../package.json');
assert(packageInfo.name);
assert(packageInfo.version);

const tracer = opentelemetryApi.trace.getTracer(packageInfo.name, packageInfo.version);

/**
 * Wraps an existing function to instrument it with OpenTelemetry tracing. Now
 * whenever the function runs, it will create a span with the given name. It's
 * basically `tracer.startActiveSpan` with some sensible default behaviors to
 * automatically end spans:
 * - when function completes successfully, status of span also set
 * - when function throws (exception recorded against span)
 * - if function returns a Promise, the promise is resolved
 * @param name Span name, passed through to `tracer.startActiveSpan`
 * @param fn The function to wrap
 * @returns The wrapped function
 *
 * via
 * https://github.com/open-telemetry/opentelemetry-js-api/issues/164#issuecomment-1174925516
 */
function trace(name, fn) {
  return function (...args) {
    return tracer.startActiveSpan(name, async (span) => {
      try {
        const result = await Promise.resolve(fn(...args));
        span.setStatus({
          code: opentelemetryApi.SpanStatusCode.OK,
        });
        return result;
      } catch (e) {
        const err = e;
        span.recordException(err);
        span.setStatus({
          code: opentelemetryApi.SpanStatusCode.ERROR,
          message: err.message,
        });
        throw err;
      } finally {
        span.end();
      }
    });
  };
}

/**
 * Wraps an existing function to instrument it with OpenTelemetry tracing. The
 * span name will be the name of the function.
 */
function traceFunction(fn) {
  return trace(fn.name, fn);
}

module.exports = {
  trace,
  traceFunction,
};
