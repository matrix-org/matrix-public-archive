'use strict';

const urlJoin = require('url-join');
const { URLSearchParams } = require('url');

class URLCreator {
  constructor(basePath) {
    this._basePath = basePath;
  }

  archiveUrlForDate(roomId, date, { viaServers = [] } = {}) {
    let qs = new URLSearchParams();
    [].concat(viaServers).forEach((viaServer) => {
      qs.append('via', viaServer);
    });

    // Gives the date in YYYY/mm/dd format.
    // date.toISOString() -> 2022-02-16T23:20:04.709Z
    const urlDate = date.toISOString().split('T')[0].replaceAll('-', '/');

    return `${urlJoin(this._basePath, `${roomId}/date/${urlDate}`)}?${qs.toString()}`;
  }
}

module.exports = URLCreator;
