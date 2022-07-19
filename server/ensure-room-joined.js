'use strict';

const assert = require('assert');
const { URLSearchParams } = require('url');
const urlJoin = require('url-join');

const { fetchEndpointAsJson } = require('./lib/fetch-endpoint');

const config = require('./lib/config');
const matrixServerUrl = config.get('matrixServerUrl');
assert(matrixServerUrl);

async function ensureRoomJoined(accessToken, roomId, viaServers = []) {
  let qs = new URLSearchParams();
  [].concat(viaServers).forEach((viaServer) => {
    qs.append('server_name', viaServer);
  });

  // TODO: Only join world_readable rooms. Perhaps we want to serve public rooms
  // where we have been invited. GET
  // /_matrix/client/v3/directory/list/room/{roomId} (Gets the visibility of a
  // given room on the server’s public room directory.)
  const joinEndpoint = urlJoin(
    matrixServerUrl,
    `_matrix/client/r0/join/${roomId}?${qs.toString()}`
  );
  console.log('joinEndpoint', joinEndpoint);
  await fetchEndpointAsJson(joinEndpoint, {
    method: 'POST',
    accessToken,
  });
}

module.exports = ensureRoomJoined;
