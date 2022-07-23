'use strict';

const assert = require('assert');

const urlJoin = require('url-join');
const { fetchEndpointAsJson } = require('./lib/fetch-endpoint');
const { traceFunction } = require('./tracing/trace-utilities');

const config = require('./lib/config');
const matrixServerUrl = config.get('matrixServerUrl');
assert(matrixServerUrl);

async function fetchRoomData(accessToken, roomId) {
  assert(accessToken);
  assert(roomId);

  const stateNameEndpoint = urlJoin(
    matrixServerUrl,
    `_matrix/client/r0/rooms/${roomId}/state/m.room.name`
  );
  const stateAvatarEndpoint = urlJoin(
    matrixServerUrl,
    `_matrix/client/r0/rooms/${roomId}/state/m.room.avatar`
  );

  const [stateNameResDataOutcome, stateAvatarResDataOutcome] = await Promise.allSettled([
    fetchEndpointAsJson(stateNameEndpoint, {
      accessToken,
    }),
    fetchEndpointAsJson(stateAvatarEndpoint, {
      accessToken,
    }),
  ]);

  let name;
  if (stateNameResDataOutcome.reason === undefined) {
    name = stateNameResDataOutcome.value.name;
  }

  let avatarUrl;
  if (stateAvatarResDataOutcome.reason === undefined) {
    avatarUrl = stateAvatarResDataOutcome.value.url;
  }

  return {
    id: roomId,
    name,
    avatarUrl,
  };
}

module.exports = traceFunction(fetchRoomData);
