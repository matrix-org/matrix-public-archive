'use strict';

const { History } = require('hydrogen-view-sdk');
const assert = require('./assert');

// Mock a full hash whenever someone asks via `history.get()` but when
// constructing URL's for use `href` etc, they should relative to the room
// (remove session and room from the hash).
class ArchiveHistory extends History {
  constructor(roomId) {
    super();

    assert(roomId);
    this._baseHash = `#/session/123/room/${roomId}`;
  }

  // Even though the page hash is relative to the room, we still expose the full
  // hash for Hydrogen to route things internally as expected.
  get() {
    const hash = super.get()?.replace(/^#/, '') ?? '';
    return this._baseHash + hash;
  }

  replaceUrlSilently(url) {
    // We don't need to do this when server-side rendering in Node.js because
    // the #hash is not available to servers. This will be called as a
    // downstream call of `urlRouter.attach()` which we do when bootstraping
    // everything.
    if (window.history) {
      super.replaceUrlSilently(url);
    }
  }

  // Make the URLs we use in the UI of the app relative to the room:
  // Before: #/session/123/room/!HBehERstyQBxyJDLfR:my.synapse.server/lightbox/$17cgP6YBP9ny9xuU1vBmpOYFhRG4zpOe9SOgWi2Wxsk
  // After: #/lightbox/$17cgP6YBP9ny9xuU1vBmpOYFhRG4zpOe9SOgWi2Wxsk
  pathAsUrl(path) {
    const leftoverPath = super.pathAsUrl(path).replace(this._baseHash, '');
    // Only add back the hash when there is hash content beyond the base so we
    // don't end up with an extraneous `#` on the end of the URL. This will end
    // up creating some `<a href="">` (anchors with a blank href) but we have
    // some code to clean this up, see `supressBlankAnchorsReloadingThePage`.
    if (leftoverPath.length) {
      return `#${leftoverPath}`;
    }
    return leftoverPath;
  }
}

module.exports = ArchiveHistory;
