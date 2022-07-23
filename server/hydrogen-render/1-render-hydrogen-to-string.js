'use strict';

// We use a child_process because we want to be able to exit the process after
// we receive the SSR results. We don't want Hydrogen to keep running after we
// get our initial rendered HTML.

const fork = require('child_process').fork;

const assert = require('assert');
const RethrownError = require('../lib/rethrown-error');

const config = require('../lib/config');
const logOutputFromChildProcesses = config.get('logOutputFromChildProcesses');

// The render should be fast. If it's taking more than 5 seconds, something has
// gone really wrong.
const RENDER_TIMEOUT = 5000;

if (!logOutputFromChildProcesses) {
  console.warn(
    `Silencing logs from child processes (config.logOutputFromChildProcesses = ${logOutputFromChildProcesses})`
  );
}

async function renderHydrogenToString(renderOptions) {
  try {
    let data = '';
    let childErrors = [];

    const controller = new AbortController();
    const { signal } = controller;
    // We use a child_process because we want to be able to exit the process after
    // we receive the SSR results.
    const child = fork(require.resolve('./2-render-hydrogen-to-string-fork-script'), [], {
      signal,
      // Default to silencing logs from the child process. We already have
      // proper instrumentation of any errors that might occur.
      //
      // This also makes `child.stderr` and `child.stdout` available
      silent: true,
      //cwd: process.cwd(),
    });

    // Since we have to use the `silent` option for the `stderr` stuff below, we
    // should also print out the `stdout` to our main console.
    if (logOutputFromChildProcesses) {
      child.stdout.on('data', function (data) {
        console.log('Child printed something to stdout:', String(data));
      });

      child.stderr.on('data', function (data) {
        console.log('Child printed something to stderr:', String(data));
      });
    }

    // Pass the renderOptions to the child by sending instead of via argv because we
    // will run into `Error: spawn E2BIG` and `Error: spawn ENAMETOOLONG` with
    // argv.
    child.send(renderOptions);

    // Stops the child process if it takes too long
    setTimeout(() => {
      controller.abort();
    }, RENDER_TIMEOUT);

    await new Promise((resolve, reject) => {
      // Collect the data passed back by the child
      child.on('message', function (result) {
        if (result.error) {
          // De-serialize the error
          const childError = new Error();
          childError.name = result.name;
          childError.message = result.message;
          childError.stack = result.stack;
          // When an error happens while rendering Hydrogen, we only expect one
          // error to come through here from the main line to render Hydrogen.
          // But it's possible to get multiple errors from async out of context
          // places since we also listen to `uncaughtException` and
          // `unhandledRejection`.
          childErrors.push(childError);
        } else {
          data += result.data;
        }
      });

      child.on('close', (exitCode) => {
        // Exited successfully
        if (exitCode === 0) {
          resolve(data);
        } else {
          let extraErrorsMessage = '';
          if (childErrors.length > 1) {
            extraErrorsMessage = ` (somehow we saw ${
              childErrors.length
            } errors but we really always expect 1 error)\n${childErrors
              .map((childError, index) => `${index}. ${childError.stack}`)
              .join('\n')}`;
          }

          let childErrorToDisplay = new Error('No child errors');
          if (childErrors.length === 1) {
            childErrorToDisplay = childErrors[0];
          } else if (childErrors.length > 1) {
            childErrorToDisplay = new Error('Multiple child errors listed above ^');
          }

          const error = new RethrownError(
            `Child process failed with exit code ${exitCode}${extraErrorsMessage}`,
            childErrorToDisplay
          );
          reject(error);
        }
      });

      // When a problem occurs when spawning the process or gets aborted
      child.on('error', (err) => {
        if (err.name === 'AbortError') {
          throw new RethrownError(
            `Timed out while rendering Hydrogen to string so we aborted the child process after ${RENDER_TIMEOUT}ms`,
            err
          );
        }

        reject(err);
      });
    });

    assert(
      data,
      `No HTML sent from child process to render Hydrogen. Any child errors? (${childErrors.length})`
    );

    return data;
  } catch (err) {
    throw new RethrownError(
      `Failed to render Hydrogen to string. In order to reproduce, feed in these arguments into \`renderHydrogenToString(...)\`:\n    renderToString arguments: ${JSON.stringify(
        //{ foo: 'bar' }
        renderOptions
      )}`,
      err
    );
  }
}

module.exports = renderHydrogenToString;
