'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FunctionsRouter = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _PromiseRouter2 = require('../PromiseRouter');

var _PromiseRouter3 = _interopRequireDefault(_PromiseRouter2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

// FunctionsRouter.js

var express = require('express'),
    Parse = require('parse/node').Parse,
    triggers = require('../triggers');

var FunctionsRouter = exports.FunctionsRouter = function (_PromiseRouter) {
  _inherits(FunctionsRouter, _PromiseRouter);

  function FunctionsRouter() {
    _classCallCheck(this, FunctionsRouter);

    return _possibleConstructorReturn(this, Object.getPrototypeOf(FunctionsRouter).apply(this, arguments));
  }

  _createClass(FunctionsRouter, [{
    key: 'mountRoutes',
    value: function mountRoutes() {
      this.route('POST', '/functions/:functionName', FunctionsRouter.handleCloudFunction);
    }
  }], [{
    key: 'createResponseObject',
    value: function createResponseObject(resolve, reject) {
      return {
        success: function success(result) {
          resolve({
            response: {
              result: Parse._encode(result)
            }
          });
        },
        error: function error(_error) {
          reject(new Parse.Error(Parse.Error.SCRIPT_FAILED, _error));
        }
      };
    }
  }, {
    key: 'handleCloudFunction',
    value: function handleCloudFunction(req) {
      var applicationId = req.config.applicationId;
      var theFunction = triggers.getFunction(req.params.functionName, applicationId);
      var theValidator = triggers.getValidator(req.params.functionName, applicationId);
      if (theFunction) {
        var params = Object.assign({}, req.body, req.query);
        for (var key in params) {
          if (params.hasOwnProperty(key)) {
            var value = params[key];
            if (value && value.__type == 'Date') {
              params[key] = new Date(value.iso);
            }
          }
        }
        var request = {
          params: params,
          master: req.auth && req.auth.isMaster,
          user: req.auth && req.auth.user,
          installationId: req.info.installationId,
          log: req.config.loggerController && req.config.loggerController.adapter
        };

        if (theValidator && typeof theValidator === "function") {
          var result = theValidator(request);
          if (!result) {
            throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Validation failed.');
          }
        }

        return new Promise(function (resolve, reject) {
          var response = FunctionsRouter.createResponseObject(resolve, reject);
          // Force the keys before the function calls.
          Parse.applicationId = req.config.applicationId;
          Parse.javascriptKey = req.config.javascriptKey;
          Parse.masterKey = req.config.masterKey;
          theFunction(request, response);
        });
      } else {
        throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Invalid function.');
      }
    }
  }]);

  return FunctionsRouter;
}(_PromiseRouter3.default);