'use strict';

// We use a child_process because we want to be able to exit the process after
// we receive the SSR results. We don't want Hydrogen to keep running after we
// get our initial rendered HTML.

const fork = require('child_process').fork;

const assert = require('assert');
const RethrownError = require('../lib/rethrown-error');

// The render should be fast. If it's taking more than 5 seconds, something has
// gone really wrong.
const RENDER_TIMEOUT = 5000;

async function renderHydrogenToString(options) {
  try {
    let data = '';
    let childErrors = [];

    const controller = new AbortController();
    const { signal } = controller;
    // We use a child_process because we want to be able to exit the process after
    // we receive the SSR results.
    const child = fork(require.resolve('./2-render-hydrogen-to-string-fork-script'), [], {
      signal,
      // Make `child.stderr` and `child.stdout` available
      silent: true,
      //cwd: process.cwd(),
    });

    // Since we have to use the `silent` option for the `stderr` stuff below, we
    // should also print out the `stdout` to our main console.
    child.stdout.on('data', function (data) {
      console.log('Child printed something to stdout:', String(data));
    });

    // It's possible for the child to exit and print an error to the `stderr`
    // without it actually bubbling up to us in the parent. As far as I can
    // tell, the `try`/`catch` in `2-render-hydrogen-to-string-fork-script.js`
    // just isn't catching the error (doesn't make any sense).
    child.stderr.on('data', function (data) {
      const stubError = new Error();
      stubError.name = 'PrintFromStdErr';
      stubError.message = '';
      stubError.stack = String(data);
      const childError = new RethrownError(`Child process printed something to stderr:`, stubError);
      childErrors.push(childError);
    });

    // Pass the options to the child by sending instead of via argv because we
    // will run into `Error: spawn E2BIG` and `Error: spawn ENAMETOOLONG` with
    // argv.
    child.send(options);

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
          // We shouldn't really run into a situation where there are multiple
          // errors but since this is just a message bus, it's possible.
          childErrors.push(childError);
        } else {
          data += result.data;
          // We only expect one chunk of data to be sent back so we can resolve
          // now. This also avoids the problem where the child_process exits
          // with status error code 1 but still Hydrogen still provided some
          // HTML and ran into an error afterwards which bubbles weird.
          //
          // Originally, we would only resolve after the child_process exited
          // with successfuly exit code 0. We could think of getting rid of this
          // if we can work out all of the errors that can happen. Like
          // something going wrong in `_loadContextEntryNotInTimeline` from
          // Hydrogen.
          //
          // TODO: uncomment probably
          //resolve(data);
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
              .map((childError, index) => `${index}. ${childError.message} ${childError.stack}`)
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
        { todo: 'uncomment the real arguments' }
        //arguments[0]
      )}`,
      err
    );
  }
}

module.exports = renderHydrogenToString;