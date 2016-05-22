"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var HTTPResponse = function () {
  function HTTPResponse(response) {
    _classCallCheck(this, HTTPResponse);

    this.status = response.statusCode;
    this.headers = response.headers;
    this.buffer = response.body;
    this.cookies = response.headers["set-cookie"];
  }

  _createClass(HTTPResponse, [{
    key: "text",
    get: function get() {
      return this.buffer.toString('utf-8');
    }
  }, {
    key: "data",
    get: function get() {
      if (!this._data) {
        try {
          this._data = JSON.parse(this.text);
        } catch (e) {}
      }
      return this._data;
    }
  }]);

  return HTTPResponse;
}();

exports.default = HTTPResponse;