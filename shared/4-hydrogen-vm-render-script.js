'use strict';

// Isomorphic script that runs in the browser and on the server for SSR (needs
// browser context) that renders Hydrogen to the `document.body`.
//
// Data is passed in via `window.matrixPublicArchiveContext`

const assert = require('matrix-public-archive-shared/lib/assert');
const {
  Platform,
  MediaRepository,
  HomeServerApi,
  StorageFactory,
  createNavigation,
  createRouter,

  TilesCollection,
  FragmentIdComparer,
  tileClassForEntry,
  EventEntry,
  encodeKey,
  encodeEventIdKey,
  Timeline,
  RoomViewModel,
  ViewModel,
  setupLightboxNavigation,
} = require('hydrogen-view-sdk');

const ArchiveView = require('matrix-public-archive-shared/ArchiveView');
const RightPanelContentView = require('matrix-public-archive-shared/RightPanelContentView');
const MatrixPublicArchiveURLCreator = require('matrix-public-archive-shared/lib/url-creator');
const ArchiveHistory = require('matrix-public-archive-shared/lib/archive-history');

const fromTimestamp = window.matrixPublicArchiveContext.fromTimestamp;
assert(fromTimestamp);
const roomData = window.matrixPublicArchiveContext.roomData;
assert(roomData);
const events = window.matrixPublicArchiveContext.events;
assert(events);
const stateEventMap = window.matrixPublicArchiveContext.stateEventMap;
assert(stateEventMap);
const config = window.matrixPublicArchiveContext.config;
assert(config);
assert(config.matrixServerUrl);
assert(config.basePath);

const matrixPublicArchiveURLCreator = new MatrixPublicArchiveURLCreator(config.basePath);

function addSupportClasses() {
  const input = document.createElement('input');
  input.type = 'month';
  const isMonthTypeSupported = input.type === 'month';

  // Signal `<input type="month">` support to our CSS
  document.body.classList.toggle('fallback-input-month', !isMonthTypeSupported);
}

let eventIndexCounter = 0;
const fragmentIdComparer = new FragmentIdComparer([]);
function makeEventEntryFromEventJson(eventJson, memberEvent) {
  assert(eventJson);

  const eventIndex = eventIndexCounter;
  const eventEntry = new EventEntry(
    {
      fragmentId: 0,
      eventIndex: eventIndex, // TODO: What should this be?
      roomId: roomData.id,
      event: eventJson,
      displayName: memberEvent && memberEvent.content && memberEvent.content.displayname,
      avatarUrl: memberEvent && memberEvent.content && memberEvent.content.avatar_url,
      key: encodeKey(roomData.id, 0, eventIndex),
      eventIdKey: encodeEventIdKey(roomData.id, eventJson.event_id),
    },
    fragmentIdComparer
  );

  eventIndexCounter++;

  return eventEntry;
}

// For any `<a href="">` (anchor with a blank href), instead of reloading the
// page just remove the hash. Also cleanup whenever the hash changes for
// whatever reason.
//
// For example, when closing the lightbox by clicking the close "x" icon, it
// would reload the page instead of SPA because `href=""` will cause a page
// navigation if we didn't have this code. Also cleanup whenever the hash is
// emptied out (like when pressing escape in the lightbox).
function supressBlankAnchorsReloadingThePage() {
  const eventHandler = {
    clearHash() {
      // Cause a `hashchange` event to be fired
      document.location.hash = '';
      // Cleanup the leftover `#` left on the URL
      window.history.replaceState(null, null, window.location.pathname);
    },
    handleEvent(e) {
      // For any `<a href="">` (anchor with a blank href), instead of reloading
      // the page just remove the hash.
      if (
        e.type === 'click' &&
        e.target.tagName?.toLowerCase() === 'a' &&
        e.target?.getAttribute('href') === ''
      ) {
        this.clearHash();
        // Prevent the page navigation (reload)
        e.preventDefault();
      }
      // Also cleanup whenever the hash is emptied out (like when pressing escape in the lightbox)
      else if (e.type === 'hashchange' && document.location.hash === '') {
        this.clearHash();
      }
    },
  };

  document.addEventListener('click', eventHandler);
  window.addEventListener('hashchange', eventHandler);
}

// eslint-disable-next-line max-statements
async function mountHydrogen() {
  const app = document.querySelector('#app');

  const platformConfig = {};
  const assetPaths = {};
  const platform = new Platform({
    container: app,
    assetPaths,
    config: platformConfig,
    options: { development: true },
  });

  const navigation = createNavigation();
  platform.setNavigation(navigation);

  const archiveHistory = new ArchiveHistory(roomData.id);
  const urlRouter = createRouter({
    navigation: navigation,
    // We use our own history because we want the hash to be relative to the
    // room and not include the session/room.
    //
    // Normally, people use `history: platform.history,`
    history: archiveHistory,
  });
  // Make it listen to changes from the history instance. And populate the
  // `Navigation` with path segments to work from so `href`'s rendered on the
  // page don't say `undefined`.
  urlRouter.attach();

  const storageFactory = new StorageFactory(
    null,
    window.indexedDB,
    window.FDBKeyRange,
    window.localStorage
  );
  const storage = await new Promise((resolve) => {
    platform.logger.run('creating-storage', async (log) => {
      const storage = await storageFactory.create('1', log);
      resolve(storage);
    });
  });

  const hsApi = new HomeServerApi({
    request: (/*url, options*/) => {
      return {
        abort() {},
        async response() {
          // Respond to the `/context` requests about missing event relations
          // with empty content. We don't want more errors to be logged but
          // we're ok with the missing events staying missing.
          return {
            // 204: No content
            status: 204,
            body: {},
          };
        },
      };
    },
    homeserver: 'fakehomeserver',
  });

  // We use the timeline to setup the relations between entries
  const timeline = new Timeline({
    roomId: roomData.id,
    fragmentIdComparer: fragmentIdComparer,
    clock: platform.clock,
    logger: platform.logger,
    storage,
    hsApi,
  });

  const mediaRepository = new MediaRepository({
    homeserver: config.matrixServerUrl,
  });

  const room = {
    name: roomData.name,
    id: roomData.id,
    avatarUrl: roomData.avatarUrl,
    avatarColorId: roomData.id,
    mediaRepository: mediaRepository,
  };

  // Something we can modify with new state updates as we see them
  const workingStateEventMap = {
    ...stateEventMap,
  };
  const eventEntries = events.map((event) => {
    if (event.type === 'm.room.member') {
      workingStateEventMap[event.state_key] = event;
    }

    const memberEvent = workingStateEventMap[event.user_id];
    return makeEventEntryFromEventJson(event, memberEvent);
  });
  //console.log('eventEntries', eventEntries.length);

  // Map of `event_id` to `EventEntry`
  const eventEntriesByEventId = eventEntries.reduce((currentMap, eventEntry) => {
    currentMap[eventEntry.id] = eventEntry;
    return currentMap;
  }, {});

  // We have to use `timeline._setupEntries([])` because it sets
  // `this._allEntries` in `Timeline` and we don't want to use `timeline.load()`
  // to request remote things.
  timeline._setupEntries([]);
  // Make it safe to iterate a derived observable collection
  timeline.entries.subscribe({ onAdd: () => null, onUpdate: () => null });
  // We use the timeline to setup the relations between entries
  timeline.addEntries(eventEntries);

  //console.log('timeline.entries', timeline.entries.length, timeline.entries);

  const tiles = new TilesCollection(timeline.entries, {
    tileClassForEntry,
    platform,
    navigation,
    urlCreator: urlRouter,
    timeline,
    roomVM: {
      room,
    },
  });
  // Trigger `onSubscribeFirst` -> `tiles._populateTiles()` so it creates a tile
  // for each entry to display. This way we can also call `tile.notifyVisible()`
  // on each tile so that the tile creation doesn't happen later when the
  // `TilesListView` is mounted and subscribes which is a bit out of our
  // control.
  tiles.subscribe({ onAdd: () => null, onUpdate: () => null });

  // Make the lazy-load images appear
  for (const tile of tiles) {
    tile.notifyVisible();
  }

  const timelineViewModel = {
    showJumpDown: false,
    setVisibleTileRange: () => {},
    tiles,
  };

  const roomViewModel = new RoomViewModel({
    room,
    ownUserId: 'xxx',
    platform,
    urlCreator: urlRouter,
    navigation,
  });

  // FIXME: We shouldn't have to dive into the internal fields to make this work
  roomViewModel._timelineVM = timelineViewModel;
  roomViewModel._composerVM = {
    kind: 'none',
  };

  class CalendarViewModel extends ViewModel {
    constructor(options) {
      super(options);
      const { activeDate, calendarDate } = options;
      this._activeDate = activeDate;
      this._calendarDate = calendarDate;
    }

    get activeDate() {
      return this._activeDate;
    }

    get calendarDate() {
      return this._calendarDate;
    }

    archiveUrlForDate(date) {
      return matrixPublicArchiveURLCreator.archiveUrlForDate(room.id, date);
    }

    prevMonth() {
      const prevMonthDate = new Date(this._calendarDate);
      prevMonthDate.setUTCMonth(this._calendarDate.getUTCMonth() - 1);
      this._calendarDate = prevMonthDate;
      this.emitChange('calendarDate');
    }

    nextMonth() {
      const nextMonthDate = new Date(this._calendarDate);
      nextMonthDate.setUTCMonth(this._calendarDate.getUTCMonth() + 1);
      console.log('nextMonthDate', nextMonthDate);
      this._calendarDate = nextMonthDate;
      this.emitChange('calendarDate');
    }

    onMonthInputChange(e) {
      this._calendarDate = e.target.valueAsDate;
      this.emitChange('calendarDate');
    }

    onYearFallbackSelectChange(e) {
      const selectedDate = new Date(this._calendarDate);
      selectedDate.setUTCFullYear(e.target.value);
      this._calendarDate = selectedDate;
      this.emitChange('calendarDate');
    }
  }

  const fromDate = new Date(fromTimestamp);
  class ArchiveViewModel extends ViewModel {
    roomViewModel = roomViewModel;
    rightPanelModel = {
      activeViewModel: {
        type: 'custom',
        customView: RightPanelContentView,
        calendarViewModel: new CalendarViewModel({
          // The day being shown in the archive
          activeDate: fromDate,
          // The month displayed in the calendar
          calendarDate: fromDate,
        }),
      },
    };

    constructor(options) {
      super(options);

      this.#setupNavigation();
    }

    #setupNavigation() {
      setupLightboxNavigation(this, 'lightboxViewModel', (eventId) => {
        return {
          room,
          eventEntry: eventEntriesByEventId[eventId],
        };
      });
    }
  }

  const archiveViewModel = new ArchiveViewModel({
    navigation: navigation,
    urlCreator: urlRouter,
    history: archiveHistory,
  });

  const view = new ArchiveView(archiveViewModel);

  app.replaceChildren(view.mount());

  addSupportClasses();

  supressBlankAnchorsReloadingThePage();
}

// N.B.: When we run this in a virtual machine (`vm`), it will return the last
// statement. It's important to leave this as the last statement so we can await
// the promise it returns and signal that all of the async tasks completed.
mountHydrogen();
