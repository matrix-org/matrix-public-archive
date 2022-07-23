'use strict';

// Server-side render Hydrogen to a string using a browser-like context thanks
// to `linkedom`. We use a VM so we can put all of the browser-like globals in
// place.
//
// Note: This is marked as unsafe because the render script is run in a VM which
// doesn't exit after we get the result (Hydrogen keeps running). There isn't a
// way to stop, terminate, or kill a vm script or vm context so in order to be
// safe, we need to run this inside of a child_process which we can kill after.
// This is why we have the `1-render-hydrogen-to-string.js` layer to handle
// this.

const assert = require('assert');
const vm = require('vm');
const path = require('path');
const { readFile } = require('fs').promises;
const crypto = require('crypto');
const { parseHTML } = require('linkedom');
const MockLocalStorage = require('./mock-local-storage');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const config = require('../lib/config');

// Setup the DOM context with any necessary shims/polyfills and ensure the VM
// context global has everything that a normal document does so Hydrogen can
// render.
function createDomAndSetupVmContext() {
  const dom = parseHTML(`
      <!doctype html>
      <html>
        <head></head>
        <body>
          <div id="app" class="hydrogen"></div>
        </body>
      </html>
    `);

  if (!dom.requestAnimationFrame) {
    dom.requestAnimationFrame = function (cb) {
      setTimeout(cb, 0);
    };
  }

  const vmContext = vm.createContext(dom);
  // Make the dom properties available in sub-`require(...)` calls
  vmContext.global.window = dom.window;
  vmContext.global.document = dom.document;
  vmContext.global.Node = dom.Node;
  vmContext.global.navigator = dom.navigator;
  vmContext.global.DOMParser = dom.DOMParser;
  // Make sure `webcrypto` exists since it was only introduced in Node.js v17
  assert(crypto.webcrypto);
  vmContext.global.crypto = crypto.webcrypto;
  // LocalStorage stuff
  vmContext.global.localStorage = new MockLocalStorage();
  // IndexDB stuff
  vmContext.global.indexedDB = new IDBFactory();
  vmContext.global.IDBFactory = IDBFactory;
  vmContext.global.IDBKeyRange = IDBKeyRange;

  // So require(...) works in the vm
  vmContext.global.require = require;
  // So we can see logs from the underlying vm
  vmContext.global.console = console;

  return {
    dom,
    vmContext,
  };
}

async function _renderHydrogenToStringUnsafe({ fromTimestamp, roomData, events, stateEventMap }) {
  assert(fromTimestamp);
  assert(roomData);
  assert(events);
  assert(stateEventMap);

  const { dom, vmContext } = createDomAndSetupVmContext();

  // Define this for the SSR context
  dom.window.matrixPublicArchiveContext = {
    fromTimestamp,
    roomData,
    events,
    stateEventMap,
    config: {
      basePort: config.get('basePort'),
      basePath: config.get('basePath'),
      matrixServerUrl: config.get('matrixServerUrl'),
    },
  };
  // Serialize it for when we run this again client-side
  dom.document.body.insertAdjacentHTML(
    'beforeend',
    `
      <script type="text/javascript">
        window.matrixPublicArchiveContext = ${JSON.stringify(dom.window.matrixPublicArchiveContext)}
      </script>
      `
  );

  const hydrogenRenderScriptCode = await readFile(
    path.resolve(__dirname, '../../shared/4-hydrogen-vm-render-script.js'),
    'utf8'
  );
  const hydrogenRenderScript = new vm.Script(hydrogenRenderScriptCode, {
    filename: '4-hydrogen-vm-render-script.js',
  });
  // Note: The VM does not exit after the result is returned here and is why
  // this should be run in a `child_process` that we can exit.
  const vmResult = hydrogenRenderScript.runInContext(vmContext);
  // Wait for everything to render
  // (waiting on the promise returned from `4-hydrogen-vm-render-script.js`)
  await vmResult;

  const documentString = dom.document.body.toString();
  assert(documentString, 'Document body should not be empty after we rendered Hydrogen');
  return documentString;
}

module.exports = _renderHydrogenToStringUnsafe;
