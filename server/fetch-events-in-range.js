'use strict';

const assert = require('assert');
const urlJoin = require('url-join');

const { fetchEndpointAsJson } = require('./lib/fetch-endpoint');
const { traceFunction } = require('./tracing/trace-utilities');

const config = require('./lib/config');
const matrixServerUrl = config.get('matrixServerUrl');
assert(matrixServerUrl);

// Find an event right ahead of where we are trying to look. Then paginate
// /messages backwards. This makes sure that we can get events for the day
// when the room started.
//
// Consider this scenario: dayStart(fromTs) <---- msg1 <- msg2 <-- msg3 <---- dayEnd(toTs)
//  - ❌ If we start from dayStart and look backwards, we will find nothing.
//  - ❌ If we start from dayStart and look forwards, we will find msg1, but federated backfill won't be able to paginate forwards
//  - ✅ If we start from dayEnd and look backwards, we will find msg3
//  - ❌ If we start from dayEnd and look forwards, we will find nothing
//
// Returns events in reverse-chronological order.
async function fetchEventsFromTimestampBackwards(accessToken, roomId, ts, limit) {
  assert(accessToken);
  assert(roomId);
  assert(ts);
  assert(limit);

  // TODO: Only join world_readable rooms. Perhaps we want to serve public rooms
  // where we have been invited. GET
  // /_matrix/client/v3/directory/list/room/{roomId} (Gets the visibility of a
  // given room on the server’s public room directory.)
  const joinEndpoint = urlJoin(matrixServerUrl, `_matrix/client/r0/join/${roomId}`);
  await fetchEndpointAsJson(joinEndpoint, {
    method: 'POST',
    accessToken,
  });

  const timestampToEventEndpoint = urlJoin(
    matrixServerUrl,
    `_matrix/client/unstable/org.matrix.msc3030/rooms/${roomId}/timestamp_to_event?ts=${ts}&dir=b`
  );
  const timestampToEventResData = await fetchEndpointAsJson(timestampToEventEndpoint, {
    accessToken,
  });
  const eventIdForTimestamp = timestampToEventResData.event_id;
  assert(eventIdForTimestamp);
  //console.log('eventIdForTimestamp', eventIdForTimestamp);

  // We only use this endpoint to get a pagination token we can use with
  // `/messages`.
  //
  // We add `limit=0` here because we want to grab the pagination token right
  // (before/after) the event.
  //
  // Add `filter={"lazy_load_members":true}` so that this endpoint responds
  // without timing out by returning just the state for the sender of the
  // included event. Otherwise, the homeserver returns all state in the room at
  // that point in time which in big rooms, can be 100k member events that we
  // don't care about anyway. Synapse seems to timeout at about the ~5k state
  // event mark.
  const contextEndpoint = urlJoin(
    matrixServerUrl,
    `_matrix/client/r0/rooms/${roomId}/context/${eventIdForTimestamp}?limit=0&filter={"lazy_load_members":true}`
  );
  const contextResData = await fetchEndpointAsJson(contextEndpoint, {
    accessToken,
  });
  //console.log('contextResData', contextResData);

  // Add `filter={"lazy_load_members":true}` to only get member state events for
  // the messages included in the response
  const messagesEndpoint = urlJoin(
    matrixServerUrl,
    `_matrix/client/r0/rooms/${roomId}/messages?dir=b&from=${contextResData.end}&limit=${limit}&filter={"lazy_load_members":true}`
  );
  const messageResData = await fetchEndpointAsJson(messagesEndpoint, {
    accessToken,
  });

  //console.log('messageResData.state', messageResData.state);
  const stateEventMap = {};
  for (const stateEvent of messageResData.state || []) {
    if (stateEvent.type === 'm.room.member') {
      stateEventMap[stateEvent.state_key] = stateEvent;
    }
  }

  return {
    stateEventMap,
    events: messageResData.chunk,
  };
}

async function fetchEventsInRange(accessToken, roomId, startTs, endTs, limit) {
  assert(accessToken);
  assert(roomId);
  assert(startTs);
  assert(endTs);
  assert(limit);

  //console.log('fetchEventsInRange', startTs, endTs);

  // Fetch events from endTs and before
  const { events, stateEventMap } = await fetchEventsFromTimestampBackwards(
    accessToken,
    roomId,
    endTs,
    limit
  );

  //console.log('events', events.length);

  let eventsInRange = events;
  // `events` are in reverse-chronological order.
  // We only need to filter if the oldest message is before startTs
  if (events[events.length - 1].origin_server_ts < startTs) {
    eventsInRange = [];

    // Let's iterate until we see events before startTs
    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Once we found an event before startTs, the rest are outside of our range
      if (event.origin_server_ts < startTs) {
        break;
      }

      eventsInRange.push(event);
    }
  }

  //console.log('eventsInRange', eventsInRange.length);

  const chronologicalEventsInRange = eventsInRange.reverse();

  return {
    stateEventMap,
    events: chronologicalEventsInRange,
  };
}

module.exports = traceFunction(fetchEventsInRange);
