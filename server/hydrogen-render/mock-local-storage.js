'use strict';

// via https://github.com/vector-im/hydrogen-web/blob/bb5711db7eabda84ef6ef4eb943a4d64ac9ba4c3/src/mocks/Storage.ts#L48
class MockLocalStorage {
  constructor() {
    this._map = new Map();
  }

  getItem(key) {
    return this._map.get(key) || null;
  }

  setItem(key, value) {
    this._map.set(key, value);
  }

  removeItem(key) {
    this._map.delete(key);
  }

  get length() {
    return this._map.size;
  }

  key(n) {
    const it = this._map.keys();
    let i = -1;
    let result;
    while (i < n) {
      result = it.next();
      if (result.done) {
        return null;
      }
      i += 1;
    }
    return result?.value || null;
  }
}

module.exports = MockLocalStorage;
