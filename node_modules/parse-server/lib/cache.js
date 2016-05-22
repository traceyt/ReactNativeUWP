"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CacheStore = CacheStore;
exports.clearCache = clearCache;
/**  weak */

function CacheStore() {
  var dataStore = {};
  return {
    get: function get(key) {
      return dataStore[key];
    },
    set: function set(key, value) {
      dataStore[key] = value;
    },
    remove: function remove(key) {
      delete dataStore[key];
    },
    clear: function clear() {
      dataStore = {};
    }
  };
}

var apps = CacheStore();
var users = CacheStore();

//So far used only in tests
function clearCache() {
  apps.clear();
  users.clear();
}

exports.default = {
  apps: apps,
  users: users,
  clearCache: clearCache,
  CacheStore: CacheStore
};