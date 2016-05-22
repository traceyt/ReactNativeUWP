'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _FilesController = require('./Controllers/FilesController');

var _FilesController2 = _interopRequireDefault(_FilesController);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// An object that encapsulates everything we need to run a 'find'
// operation, encoded in the REST API format.

var SchemaController = require('./Controllers/SchemaController');
var Parse = require('parse/node').Parse;

// restOptions can include:
//   skip
//   limit
//   order
//   count
//   include
//   keys
//   redirectClassNameForKey
function RestQuery(config, auth, className) {
  var restWhere = arguments.length <= 3 || arguments[3] === undefined ? {} : arguments[3];
  var restOptions = arguments.length <= 4 || arguments[4] === undefined ? {} : arguments[4];


  this.config = config;
  this.auth = auth;
  this.className = className;
  this.restWhere = restWhere;
  this.response = null;
  this.findOptions = {};
  if (!this.auth.isMaster) {
    this.findOptions.acl = this.auth.user ? [this.auth.user.id] : null;
    if (this.className == '_Session') {
      if (!this.findOptions.acl) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'This session token is invalid.');
      }
      this.restWhere = {
        '$and': [this.restWhere, {
          'user': {
            __type: 'Pointer',
            className: '_User',
            objectId: this.auth.user.id
          }
        }]
      };
    }
  }

  this.doCount = false;

  // The format for this.include is not the same as the format for the
  // include option - it's the paths we should include, in order,
  // stored as arrays, taking into account that we need to include foo
  // before including foo.bar. Also it should dedupe.
  // For example, passing an arg of include=foo.bar,foo.baz could lead to
  // this.include = [['foo'], ['foo', 'baz'], ['foo', 'bar']]
  this.include = [];

  for (var option in restOptions) {
    switch (option) {
      case 'keys':
        this.keys = new Set(restOptions.keys.split(','));
        this.keys.add('objectId');
        this.keys.add('createdAt');
        this.keys.add('updatedAt');
        break;
      case 'count':
        this.doCount = true;
        break;
      case 'skip':
      case 'limit':
        this.findOptions[option] = restOptions[option];
        break;
      case 'order':
        var fields = restOptions.order.split(',');
        var sortMap = {};
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
          for (var _iterator = fields[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var field = _step.value;

            if (field[0] == '-') {
              sortMap[field.slice(1)] = -1;
            } else {
              sortMap[field] = 1;
            }
          }
        } catch (err) {
          _didIteratorError = true;
          _iteratorError = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion && _iterator.return) {
              _iterator.return();
            }
          } finally {
            if (_didIteratorError) {
              throw _iteratorError;
            }
          }
        }

        this.findOptions.sort = sortMap;
        break;
      case 'include':
        var paths = restOptions.include.split(',');
        var pathSet = {};
        var _iteratorNormalCompletion2 = true;
        var _didIteratorError2 = false;
        var _iteratorError2 = undefined;

        try {
          for (var _iterator2 = paths[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
            var path = _step2.value;

            // Add all prefixes with a .-split to pathSet
            var parts = path.split('.');
            for (var len = 1; len <= parts.length; len++) {
              pathSet[parts.slice(0, len).join('.')] = true;
            }
          }
        } catch (err) {
          _didIteratorError2 = true;
          _iteratorError2 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion2 && _iterator2.return) {
              _iterator2.return();
            }
          } finally {
            if (_didIteratorError2) {
              throw _iteratorError2;
            }
          }
        }

        this.include = Object.keys(pathSet).sort(function (a, b) {
          return a.length - b.length;
        }).map(function (s) {
          return s.split('.');
        });
        break;
      case 'redirectClassNameForKey':
        this.redirectKey = restOptions.redirectClassNameForKey;
        this.redirectClassName = null;
        break;
      default:
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad option: ' + option);
    }
  }
}

// A convenient method to perform all the steps of processing a query
// in order.
// Returns a promise for the response - an object with optional keys
// 'results' and 'count'.
// TODO: consolidate the replaceX functions
RestQuery.prototype.execute = function () {
  var _this = this;

  return Promise.resolve().then(function () {
    return _this.buildRestWhere();
  }).then(function () {
    return _this.runFind();
  }).then(function () {
    return _this.runCount();
  }).then(function () {
    return _this.handleInclude();
  }).then(function () {
    return _this.response;
  });
};

RestQuery.prototype.buildRestWhere = function () {
  var _this2 = this;

  return Promise.resolve().then(function () {
    return _this2.getUserAndRoleACL();
  }).then(function () {
    return _this2.redirectClassNameForKey();
  }).then(function () {
    return _this2.validateClientClassCreation();
  }).then(function () {
    return _this2.replaceSelect();
  }).then(function () {
    return _this2.replaceDontSelect();
  }).then(function () {
    return _this2.replaceInQuery();
  }).then(function () {
    return _this2.replaceNotInQuery();
  });
};

// Uses the Auth object to get the list of roles, adds the user id
RestQuery.prototype.getUserAndRoleACL = function () {
  var _this3 = this;

  if (this.auth.isMaster || !this.auth.user) {
    return Promise.resolve();
  }
  return this.auth.getUserRoles().then(function (roles) {
    roles.push(_this3.auth.user.id);
    _this3.findOptions.acl = roles;
    return Promise.resolve();
  });
};

// Changes the className if redirectClassNameForKey is set.
// Returns a promise.
RestQuery.prototype.redirectClassNameForKey = function () {
  var _this4 = this;

  if (!this.redirectKey) {
    return Promise.resolve();
  }

  // We need to change the class name based on the schema
  return this.config.database.redirectClassNameForKey(this.className, this.redirectKey).then(function (newClassName) {
    _this4.className = newClassName;
    _this4.redirectClassName = newClassName;
  });
};

// Validates this operation against the allowClientClassCreation config.
RestQuery.prototype.validateClientClassCreation = function () {
  var _this5 = this;

  var sysClass = SchemaController.systemClasses;
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && sysClass.indexOf(this.className) === -1) {
    return this.config.database.collectionExists(this.className).then(function (hasClass) {
      if (hasClass === true) {
        return Promise.resolve();
      }

      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access ' + 'non-existent class: ' + _this5.className);
    });
  } else {
    return Promise.resolve();
  }
};

// Replaces a $inQuery clause by running the subquery, if there is an
// $inQuery clause.
// The $inQuery clause turns into an $in with values that are just
// pointers to the objects returned in the subquery.
RestQuery.prototype.replaceInQuery = function () {
  var _this6 = this;

  var inQueryObject = findObjectWithKey(this.restWhere, '$inQuery');
  if (!inQueryObject) {
    return;
  }

  // The inQuery value must have precisely two keys - where and className
  var inQueryValue = inQueryObject['$inQuery'];
  if (!inQueryValue.where || !inQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $inQuery');
  }

  var additionalOptions = {
    redirectClassNameForKey: inQueryValue.redirectClassNameForKey
  };

  var subquery = new RestQuery(this.config, this.auth, inQueryValue.className, inQueryValue.where, additionalOptions);
  return subquery.execute().then(function (response) {
    _this6.config.database.transform.transformInQuery(inQueryObject, subquery.className, response.results);
    // Recurse to repeat
    return _this6.replaceInQuery();
  });
};

// Replaces a $notInQuery clause by running the subquery, if there is an
// $notInQuery clause.
// The $notInQuery clause turns into a $nin with values that are just
// pointers to the objects returned in the subquery.
RestQuery.prototype.replaceNotInQuery = function () {
  var _this7 = this;

  var notInQueryObject = findObjectWithKey(this.restWhere, '$notInQuery');
  if (!notInQueryObject) {
    return;
  }

  // The notInQuery value must have precisely two keys - where and className
  var notInQueryValue = notInQueryObject['$notInQuery'];
  if (!notInQueryValue.where || !notInQueryValue.className) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $notInQuery');
  }

  var additionalOptions = {
    redirectClassNameForKey: notInQueryValue.redirectClassNameForKey
  };

  var subquery = new RestQuery(this.config, this.auth, notInQueryValue.className, notInQueryValue.where, additionalOptions);
  return subquery.execute().then(function (response) {
    _this7.config.database.transform.transformNotInQuery(notInQueryObject, subquery.className, response.results);
    // Recurse to repeat
    return _this7.replaceNotInQuery();
  });
};

// Replaces a $select clause by running the subquery, if there is a
// $select clause.
// The $select clause turns into an $in with values selected out of
// the subquery.
// Returns a possible-promise.
RestQuery.prototype.replaceSelect = function () {
  var _this8 = this;

  var selectObject = findObjectWithKey(this.restWhere, '$select');
  if (!selectObject) {
    return;
  }

  // The select value must have precisely two keys - query and key
  var selectValue = selectObject['$select'];
  // iOS SDK don't send where if not set, let it pass
  if (!selectValue.query || !selectValue.key || _typeof(selectValue.query) !== 'object' || !selectValue.query.className || Object.keys(selectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $select');
  }

  var additionalOptions = {
    redirectClassNameForKey: selectValue.query.redirectClassNameForKey
  };

  var subquery = new RestQuery(this.config, this.auth, selectValue.query.className, selectValue.query.where, additionalOptions);
  return subquery.execute().then(function (response) {
    _this8.config.database.transform.transformSelect(selectObject, selectValue.key, response.results);
    // Keep replacing $select clauses
    return _this8.replaceSelect();
  });
};

// Replaces a $dontSelect clause by running the subquery, if there is a
// $dontSelect clause.
// The $dontSelect clause turns into an $nin with values selected out of
// the subquery.
// Returns a possible-promise.
RestQuery.prototype.replaceDontSelect = function () {
  var _this9 = this;

  var dontSelectObject = findObjectWithKey(this.restWhere, '$dontSelect');
  if (!dontSelectObject) {
    return;
  }

  // The dontSelect value must have precisely two keys - query and key
  var dontSelectValue = dontSelectObject['$dontSelect'];
  if (!dontSelectValue.query || !dontSelectValue.key || _typeof(dontSelectValue.query) !== 'object' || !dontSelectValue.query.className || Object.keys(dontSelectValue).length !== 2) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'improper usage of $dontSelect');
  }
  var additionalOptions = {
    redirectClassNameForKey: dontSelectValue.query.redirectClassNameForKey
  };

  var subquery = new RestQuery(this.config, this.auth, dontSelectValue.query.className, dontSelectValue.query.where, additionalOptions);
  return subquery.execute().then(function (response) {
    _this9.config.database.transform.transformDontSelect(dontSelectObject, dontSelectValue.key, response.results);
    // Keep replacing $dontSelect clauses
    return _this9.replaceDontSelect();
  });
};

// Returns a promise for whether it was successful.
// Populates this.response with an object that only has 'results'.
RestQuery.prototype.runFind = function () {
  var _this10 = this;

  if (this.findOptions.limit === 0) {
    this.response = { results: [] };
    return Promise.resolve();
  }
  return this.config.database.find(this.className, this.restWhere, this.findOptions).then(function (results) {
    if (_this10.className === '_User') {
      var _iteratorNormalCompletion3 = true;
      var _didIteratorError3 = false;
      var _iteratorError3 = undefined;

      try {
        for (var _iterator3 = results[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
          var result = _step3.value;

          delete result.password;
        }
      } catch (err) {
        _didIteratorError3 = true;
        _iteratorError3 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion3 && _iterator3.return) {
            _iterator3.return();
          }
        } finally {
          if (_didIteratorError3) {
            throw _iteratorError3;
          }
        }
      }
    }

    _this10.config.filesController.expandFilesInObject(_this10.config, results);

    if (_this10.keys) {
      var keySet = _this10.keys;
      results = results.map(function (object) {
        var newObject = {};
        for (var key in object) {
          if (keySet.has(key)) {
            newObject[key] = object[key];
          }
        }
        return newObject;
      });
    }

    if (_this10.redirectClassName) {
      var _iteratorNormalCompletion4 = true;
      var _didIteratorError4 = false;
      var _iteratorError4 = undefined;

      try {
        for (var _iterator4 = results[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
          var r = _step4.value;

          r.className = _this10.redirectClassName;
        }
      } catch (err) {
        _didIteratorError4 = true;
        _iteratorError4 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion4 && _iterator4.return) {
            _iterator4.return();
          }
        } finally {
          if (_didIteratorError4) {
            throw _iteratorError4;
          }
        }
      }
    }
    _this10.response = { results: results };
  });
};

// Returns a promise for whether it was successful.
// Populates this.response.count with the count
RestQuery.prototype.runCount = function () {
  var _this11 = this;

  if (!this.doCount) {
    return;
  }
  this.findOptions.count = true;
  delete this.findOptions.skip;
  delete this.findOptions.limit;
  return this.config.database.find(this.className, this.restWhere, this.findOptions).then(function (c) {
    _this11.response.count = c;
  });
};

// Augments this.response with data at the paths provided in this.include.
RestQuery.prototype.handleInclude = function () {
  var _this12 = this;

  if (this.include.length == 0) {
    return;
  }

  var pathResponse = includePath(this.config, this.auth, this.response, this.include[0]);
  if (pathResponse.then) {
    return pathResponse.then(function (newResponse) {
      _this12.response = newResponse;
      _this12.include = _this12.include.slice(1);
      return _this12.handleInclude();
    });
  } else if (this.include.length > 0) {
    this.include = this.include.slice(1);
    return this.handleInclude();
  }

  return pathResponse;
};

// Adds included values to the response.
// Path is a list of field names.
// Returns a promise for an augmented response.
function includePath(config, auth, response, path) {
  var pointers = findPointers(response.results, path);
  if (pointers.length == 0) {
    return response;
  }
  var pointersHash = {};
  var objectIds = {};
  var _iteratorNormalCompletion5 = true;
  var _didIteratorError5 = false;
  var _iteratorError5 = undefined;

  try {
    for (var _iterator5 = pointers[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
      var pointer = _step5.value;

      var className = pointer.className;
      // only include the good pointers
      if (className) {
        pointersHash[className] = pointersHash[className] || [];
        pointersHash[className].push(pointer.objectId);
      }
    }
  } catch (err) {
    _didIteratorError5 = true;
    _iteratorError5 = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion5 && _iterator5.return) {
        _iterator5.return();
      }
    } finally {
      if (_didIteratorError5) {
        throw _iteratorError5;
      }
    }
  }

  var queryPromises = Object.keys(pointersHash).map(function (className) {
    var where = { 'objectId': { '$in': pointersHash[className] } };
    var query = new RestQuery(config, auth, className, where);
    return query.execute().then(function (results) {
      results.className = className;
      return Promise.resolve(results);
    });
  });

  // Get the objects for all these object ids
  return Promise.all(queryPromises).then(function (responses) {
    var replace = responses.reduce(function (replace, includeResponse) {
      var _iteratorNormalCompletion6 = true;
      var _didIteratorError6 = false;
      var _iteratorError6 = undefined;

      try {
        for (var _iterator6 = includeResponse.results[Symbol.iterator](), _step6; !(_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done); _iteratorNormalCompletion6 = true) {
          var obj = _step6.value;

          obj.__type = 'Object';
          obj.className = includeResponse.className;

          if (obj.className == "_User") {
            delete obj.sessionToken;
            delete obj.authData;
          }
          replace[obj.objectId] = obj;
        }
      } catch (err) {
        _didIteratorError6 = true;
        _iteratorError6 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion6 && _iterator6.return) {
            _iterator6.return();
          }
        } finally {
          if (_didIteratorError6) {
            throw _iteratorError6;
          }
        }
      }

      return replace;
    }, {});

    var resp = {
      results: replacePointers(response.results, path, replace)
    };
    if (response.count) {
      resp.count = response.count;
    }
    return resp;
  });
}

// Object may be a list of REST-format object to find pointers in, or
// it may be a single object.
// If the path yields things that aren't pointers, this throws an error.
// Path is a list of fields to search into.
// Returns a list of pointers in REST format.
function findPointers(object, path) {
  if (object instanceof Array) {
    var answer = [];
    var _iteratorNormalCompletion7 = true;
    var _didIteratorError7 = false;
    var _iteratorError7 = undefined;

    try {
      for (var _iterator7 = object[Symbol.iterator](), _step7; !(_iteratorNormalCompletion7 = (_step7 = _iterator7.next()).done); _iteratorNormalCompletion7 = true) {
        var x = _step7.value;

        answer = answer.concat(findPointers(x, path));
      }
    } catch (err) {
      _didIteratorError7 = true;
      _iteratorError7 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion7 && _iterator7.return) {
          _iterator7.return();
        }
      } finally {
        if (_didIteratorError7) {
          throw _iteratorError7;
        }
      }
    }

    return answer;
  }

  if ((typeof object === 'undefined' ? 'undefined' : _typeof(object)) !== 'object') {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'can only include pointer fields');
  }

  if (path.length == 0) {
    if (object.__type == 'Pointer') {
      return [object];
    }
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'can only include pointer fields');
  }

  var subobject = object[path[0]];
  if (!subobject) {
    return [];
  }
  return findPointers(subobject, path.slice(1));
}

// Object may be a list of REST-format objects to replace pointers
// in, or it may be a single object.
// Path is a list of fields to search into.
// replace is a map from object id -> object.
// Returns something analogous to object, but with the appropriate
// pointers inflated.
function replacePointers(object, path, replace) {
  if (object instanceof Array) {
    return object.map(function (obj) {
      return replacePointers(obj, path, replace);
    }).filter(function (obj) {
      return obj != null && obj != undefined;
    });
  }

  if ((typeof object === 'undefined' ? 'undefined' : _typeof(object)) !== 'object') {
    return object;
  }

  if (path.length === 0) {
    if (object.__type === 'Pointer') {
      return replace[object.objectId];
    }
    return object;
  }

  var subobject = object[path[0]];
  if (!subobject) {
    return object;
  }
  var newsub = replacePointers(subobject, path.slice(1), replace);
  var answer = {};
  for (var key in object) {
    if (key == path[0]) {
      answer[key] = newsub;
    } else {
      answer[key] = object[key];
    }
  }
  return answer;
}

// Finds a subobject that has the given key, if there is one.
// Returns undefined otherwise.
function findObjectWithKey(root, key) {
  if ((typeof root === 'undefined' ? 'undefined' : _typeof(root)) !== 'object') {
    return;
  }
  if (root instanceof Array) {
    var _iteratorNormalCompletion8 = true;
    var _didIteratorError8 = false;
    var _iteratorError8 = undefined;

    try {
      for (var _iterator8 = root[Symbol.iterator](), _step8; !(_iteratorNormalCompletion8 = (_step8 = _iterator8.next()).done); _iteratorNormalCompletion8 = true) {
        var item = _step8.value;

        var answer = findObjectWithKey(item, key);
        if (answer) {
          return answer;
        }
      }
    } catch (err) {
      _didIteratorError8 = true;
      _iteratorError8 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion8 && _iterator8.return) {
          _iterator8.return();
        }
      } finally {
        if (_didIteratorError8) {
          throw _iteratorError8;
        }
      }
    }
  }
  if (root && root[key]) {
    return root;
  }
  for (var subkey in root) {
    var answer = findObjectWithKey(root[subkey], key);
    if (answer) {
      return answer;
    }
  }
}

module.exports = RestQuery;