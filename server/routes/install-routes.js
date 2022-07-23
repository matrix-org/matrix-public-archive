'use strict';

const assert = require('assert');
const path = require('path');
const urlJoin = require('url-join');
const express = require('express');
const asyncHandler = require('../lib/express-async-handler');
const StatusError = require('../lib/status-error');

const { handleTracingMiddleware, getSerializableSpans } = require('../tracing/tracing-middleware');
const timeoutMiddleware = require('./timeout-middleware');

const fetchRoomData = require('../fetch-room-data');
const fetchEventsInRange = require('../fetch-events-in-range');
const renderHydrogenToString = require('../hydrogen-render/1-render-hydrogen-to-string');
const sanitizeHtml = require('../lib/sanitize-html');
const safeJson = require('../lib/safe-json');

const config = require('../lib/config');
const basePath = config.get('basePath');
assert(basePath);
const matrixAccessToken = config.get('matrixAccessToken');
assert(matrixAccessToken);
const archiveMessageLimit = config.get('archiveMessageLimit');
assert(archiveMessageLimit);

function parseArchiveRangeFromReq(req) {
  const yyyy = parseInt(req.params.yyyy, 10);
  // Month is the only zero-based index in this group
  const mm = parseInt(req.params.mm, 10) - 1;
  const dd = parseInt(req.params.dd, 10);

  const hourRange = req.params.hourRange;

  let fromHour = 0;
  let toHour = 0;
  if (hourRange) {
    const hourMatches = hourRange.match(/^(\d\d?)-(\d\d?)$/);

    if (!hourMatches) {
      throw new StatusError(404, 'Hour was unable to be parsed');
    }

    fromHour = parseInt(hourMatches[1], 10);
    toHour = parseInt(hourMatches[2], 10);

    if (Number.isNaN(fromHour) || fromHour < 0 || fromHour > 23) {
      throw new StatusError(404, 'From hour can only be in range 0-23');
    }
  }

  const fromTimestamp = Date.UTC(yyyy, mm, dd, fromHour);
  let toTimestamp = Date.UTC(yyyy, mm, dd + 1, fromHour);
  if (hourRange) {
    toTimestamp = Date.UTC(yyyy, mm, dd, toHour);
  }

  return {
    fromTimestamp,
    toTimestamp,
    yyyy,
    mm,
    dd,
    hourRange,
    fromHour,
    toHour,
  };
}

function installRoutes(app) {
  app.use(handleTracingMiddleware);

  app.get(
    '/health-check',
    asyncHandler(async function (req, res) {
      res.send('{ "ok": true }');
    })
  );

  // We have to disable no-missing-require lint because it doesn't take into
  // account `package.json`. `exports`, see
  // https://github.com/mysticatea/eslint-plugin-node/issues/255
  // eslint-disable-next-line node/no-missing-require
  app.use(express.static(path.dirname(require.resolve('hydrogen-view-sdk/assets/main.js'))));

  app.get(
    '/hydrogen-styles.css',
    asyncHandler(async function (req, res) {
      res.set('Content-Type', 'text/css');
      // We have to disable no-missing-require lint because it doesn't take into
      // account `package.json`. `exports`, see
      // https://github.com/mysticatea/eslint-plugin-node/issues/255
      // eslint-disable-next-line node/no-missing-require
      res.sendFile(require.resolve('hydrogen-view-sdk/assets/theme-element-light.css'));
    })
  );

  // Our own archive app styles
  app.get(
    '/styles.css',
    asyncHandler(async function (req, res) {
      res.set('Content-Type', 'text/css');
      res.sendFile(path.join(__dirname, '../../public/styles/styles.css'));
    })
  );

  app.get(
    '/matrix-public-archive.js',
    asyncHandler(async function (req, res) {
      res.set('Content-Type', 'text/css');
      res.sendFile(path.join(__dirname, '../../dist/matrix-public-archive.es.js'));
    })
  );

  app.get(
    '/:roomIdOrAlias/event/:eventId',
    asyncHandler(async function (req, res) {
      // TODO: Fetch event to get `origin_server_ts` and redirect to
      // /!roomId/2022/01/01?at=$eventId
      res.send('todo');
    })
  );

  // Based off of the Gitter archive routes,
  // https://gitlab.com/gitterHQ/webapp/-/blob/14954e05c905e8c7cb675efebb89116c07cfaab5/server/handlers/app/archive.js#L190-297
  app.get(
    '/:roomIdOrAlias/date/:yyyy(\\d{4})/:mm(\\d{2})/:dd(\\d{2})/:hourRange(\\d\\d?-\\d\\d?)?',
    timeoutMiddleware,
    asyncHandler(async function (req, res) {
      const roomIdOrAlias = req.params.roomIdOrAlias;
      assert(roomIdOrAlias.startsWith('!') || roomIdOrAlias.startsWith('#'));

      const { fromTimestamp, toTimestamp, hourRange, fromHour, toHour } =
        parseArchiveRangeFromReq(req);

      // If the hourRange is defined, we force the range to always be 1 hour. If
      // the format isn't correct, redirect to the correct hour range
      if (hourRange && toHour !== fromHour + 1) {
        res.redirect(
          urlJoin(
            basePath,
            roomIdOrAlias,
            'date',
            req.params.yyyy,
            req.params.mm,
            req.params.dd,
            `${fromHour}-${fromHour + 1}`
          )
        );
        return;
      }

      // TODO: Highlight tile that matches ?at=$xxx
      //const aroundId = req.query.at;

      // Do these in parallel to avoid the extra time in sequential round-trips
      // (we want to display the archive page faster)
      const [roomData, { events, stateEventMap }] = await Promise.all([
        fetchRoomData(matrixAccessToken, roomIdOrAlias),
        fetchEventsInRange(
          matrixAccessToken,
          roomIdOrAlias,
          fromTimestamp,
          toTimestamp,
          archiveMessageLimit
        ),
      ]);

      if (events.length >= archiveMessageLimit) {
        throw new Error('TODO: Redirect user to smaller hour range');
      }

      // In development, if you're running into a hard to track down error with
      // the render hydrogen stack and fighting against the multiple layers of
      // complexity with `child_process `and `vm`; you can get away with removing
      // the `child_process` part of it by using
      // `3-render-hydrogen-to-string-unsafe` directly.
      // ```js
      // const _renderHydrogenToStringUnsafe = require('../hydrogen-render/3-render-hydrogen-to-string-unsafe');
      // const hydrogenHtmlOutput = await _renderHydrogenToStringUnsafe({ /* renderData */ });
      // ```
      //
      const hydrogenHtmlOutput = await renderHydrogenToString({
        fromTimestamp,
        roomData,
        events,
        stateEventMap,
      });

      const serializableSpans = getSerializableSpans();
      const serializedSpans = JSON.stringify(serializableSpans);

      const hydrogenStylesUrl = urlJoin(basePath, 'hydrogen-styles.css');
      const stylesUrl = urlJoin(basePath, 'styles.css');
      const jsBundleUrl = urlJoin(basePath, 'matrix-public-archive.js');
      const pageHtml = `
      <!doctype html>
      <html lang="en">
        <head>
          ${sanitizeHtml(`<title>${roomData.name} - Matrix Public Archive</title>`)}
          <link href="${hydrogenStylesUrl}" rel="stylesheet">
          <link href="${stylesUrl}" rel="stylesheet">
        </head>
        <body>
          ${hydrogenHtmlOutput}
          <script type="text/javascript" src="${jsBundleUrl}"></script>
          <script type="text/javascript">window.tracingSpansForRequest = ${safeJson(
            serializedSpans
          )};</script>
        </body>
      </html>
      `;

      res.set('Content-Type', 'text/html');
      res.send(pageHtml);
    })
  );
}

module.exports = installRoutes;
