'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Config = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); // A Config object provides information about how a specific app is
// configured.
// mount is the URL for the root of the API; includes http, domain, etc.

var _cache = require('./cache');

var _cache2 = _interopRequireDefault(_cache);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function removeTrailingSlash(str) {
  if (!str) {
    return str;
  }
  if (str.endsWith("/")) {
    str = str.substr(0, str.length - 1);
  }
  return str;
}

var Config = exports.Config = function () {
  function Config(applicationId, mount) {
    _classCallCheck(this, Config);

    var DatabaseAdapter = require('./DatabaseAdapter');
    var cacheInfo = _cache2.default.apps.get(applicationId);
    if (!cacheInfo) {
      return;
    }

    this.applicationId = applicationId;
    this.masterKey = cacheInfo.masterKey;
    this.clientKey = cacheInfo.clientKey;
    this.javascriptKey = cacheInfo.javascriptKey;
    this.dotNetKey = cacheInfo.dotNetKey;
    this.restAPIKey = cacheInfo.restAPIKey;
    this.fileKey = cacheInfo.fileKey;
    this.facebookAppIds = cacheInfo.facebookAppIds;
    this.allowClientClassCreation = cacheInfo.allowClientClassCreation;
    this.database = DatabaseAdapter.getDatabaseConnection(applicationId, cacheInfo.collectionPrefix);

    this.serverURL = cacheInfo.serverURL;
    this.publicServerURL = removeTrailingSlash(cacheInfo.publicServerURL);
    this.verifyUserEmails = cacheInfo.verifyUserEmails;
    this.appName = cacheInfo.appName;

    this.hooksController = cacheInfo.hooksController;
    this.filesController = cacheInfo.filesController;
    this.pushController = cacheInfo.pushController;
    this.loggerController = cacheInfo.loggerController;
    this.userController = cacheInfo.userController;
    this.authDataManager = cacheInfo.authDataManager;
    this.customPages = cacheInfo.customPages || {};
    this.mount = removeTrailingSlash(mount);
    this.liveQueryController = cacheInfo.liveQueryController;
    this.sessionLength = cacheInfo.sessionLength;
    this.expireInactiveSessions = cacheInfo.expireInactiveSessions;
    this.generateSessionExpiresAt = this.generateSessionExpiresAt.bind(this);
    this.revokeSessionOnPasswordReset = cacheInfo.revokeSessionOnPasswordReset;
  }

  _createClass(Config, [{
    key: 'generateSessionExpiresAt',
    value: function generateSessionExpiresAt() {
      if (!this.expireInactiveSessions) {
        return undefined;
      }
      var now = new Date();
      return new Date(now.getTime() + this.sessionLength * 1000);
    }
  }, {
    key: 'mount',
    get: function get() {
      var mount = this._mount;
      if (this.publicServerURL) {
        mount = this.publicServerURL;
      }
      return mount;
    },
    set: function set(newValue) {
      this._mount = newValue;
    }
  }, {
    key: 'invalidLinkURL',
    get: function get() {
      return this.customPages.invalidLink || this.publicServerURL + '/apps/invalid_link.html';
    }
  }, {
    key: 'verifyEmailSuccessURL',
    get: function get() {
      return this.customPages.verifyEmailSuccess || this.publicServerURL + '/apps/verify_email_success.html';
    }
  }, {
    key: 'choosePasswordURL',
    get: function get() {
      return this.customPages.choosePassword || this.publicServerURL + '/apps/choose_password';
    }
  }, {
    key: 'requestResetPasswordURL',
    get: function get() {
      return this.publicServerURL + '/apps/' + this.applicationId + '/request_password_reset';
    }
  }, {
    key: 'passwordResetSuccessURL',
    get: function get() {
      return this.customPages.passwordResetSuccess || this.publicServerURL + '/apps/password_reset_success.html';
    }
  }, {
    key: 'verifyEmailURL',
    get: function get() {
      return this.publicServerURL + '/apps/' + this.applicationId + '/verify_email';
    }
  }], [{
    key: 'validate',
    value: function validate(options) {
      this.validateEmailConfiguration({
        verifyUserEmails: options.verifyUserEmails,
        appName: options.appName,
        publicServerURL: options.publicServerURL
      });

      if (typeof options.revokeSessionOnPasswordReset !== 'boolean') {
        throw 'revokeSessionOnPasswordReset must be a boolean value';
      }

      if (options.publicServerURL) {
        if (!options.publicServerURL.startsWith("http://") && !options.publicServerURL.startsWith("https://")) {
          throw "publicServerURL should be a valid HTTPS URL starting with https://";
        }
      }

      this.validateSessionConfiguration(options.sessionLength, options.expireInactiveSessions);
    }
  }, {
    key: 'validateEmailConfiguration',
    value: function validateEmailConfiguration(_ref) {
      var verifyUserEmails = _ref.verifyUserEmails;
      var appName = _ref.appName;
      var publicServerURL = _ref.publicServerURL;

      if (verifyUserEmails) {
        if (typeof appName !== 'string') {
          throw 'An app name is required when using email verification.';
        }
        if (typeof publicServerURL !== 'string') {
          throw 'A public server url is required when using email verification.';
        }
      }
    }
  }, {
    key: 'validateSessionConfiguration',
    value: function validateSessionConfiguration(sessionLength, expireInactiveSessions) {
      if (expireInactiveSessions) {
        if (isNaN(sessionLength)) {
          throw 'Session length must be a valid number.';
        } else if (sessionLength <= 0) {
          throw 'Session length must be a value greater than 0.';
        }
      }
    }
  }]);

  return Config;
}();

exports.default = Config;

module.exports = Config;