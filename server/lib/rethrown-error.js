'use strict';

// via https://stackoverflow.com/a/42755876/796832

// Standard error extender from @deployable/errors
class ExtendedError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    this.message = message;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

// A way to create a new error with a custom message but keep the stack trace of
// the original error. Useful to give more context and why the action was tried
// in the first place.
//
// For example, if you get a generic EACCES disk error of a certain file, you
// want to know why and what context the disk was trying to be read. A
// stack-trace is not human digestable and only gives the where in the code.
// What I actually need to know is that I was trying to read the `ratelimit` key
// from the config when this error occured.
//
// `new RethrownError('Failed to get the ratelimit key from the config', originalError)` (failed to read the disk)
class RethrownError extends ExtendedError {
  constructor(message, error) {
    super(message);
    if (!error) throw new Error('RethrownError requires a message and error');
    this.original = error;
    this.newStack = this.stack;

    // The number of lines that make up the message itself. We count this by the
    // number of `\n` and `+ 1` for the first line because it doesn't start with
    // new line.
    const messageLines = (this.message.match(/\n/g) || []).length + 1;

    const indentedOriginalError = error.stack
      .split(/\r?\n/)
      .map((line) => `    ${line}`)
      .join('\n');

    this.stack =
      this.stack
        .split('\n')
        // We use `+ 1` here so that we include the first line of the stack to
        // people know where the error was thrown from.
        .slice(0, messageLines + 1)
        .join('\n') +
      '\n' +
      '    --- Original Error ---\n' +
      indentedOriginalError;
  }
}

module.exports = RethrownError;
