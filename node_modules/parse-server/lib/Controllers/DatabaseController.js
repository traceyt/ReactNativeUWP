'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _intersect = require('intersect');

var _intersect2 = _interopRequireDefault(_intersect);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } } // A database adapter that works with data exported from the hosted
// Parse database.

var mongodb = require('mongodb');
var Parse = require('parse/node').Parse;

var SchemaController = require('../Controllers/SchemaController');
var deepcopy = require('deepcopy');

function addWriteACL(query, acl) {
  var newQuery = _lodash2.default.cloneDeep(query);
  //Can't be any existing '_wperm' query, we don't allow client queries on that, no need to $and
  newQuery._wperm = { "$in": [null].concat(_toConsumableArray(acl)) };
  return newQuery;
}

function addReadACL(query, acl) {
  var newQuery = _lodash2.default.cloneDeep(query);
  //Can't be any existing '_rperm' query, we don't allow client queries on that, no need to $and
  newQuery._rperm = { "$in": [null, "*"].concat(_toConsumableArray(acl)) };
  return newQuery;
}

function DatabaseController(adapter) {
  var _ref = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

  var skipValidation = _ref.skipValidation;

  this.adapter = adapter;

  // We don't want a mutable this.schema, because then you could have
  // one request that uses different schemas for different parts of
  // it. Instead, use loadSchema to get a schema.
  this.schemaPromise = null;
  this.skipValidation = !!skipValidation;
  this.connect();

  Object.defineProperty(this, 'transform', {
    get: function get() {
      return adapter.transform;
    }
  });
}

DatabaseController.prototype.WithoutValidation = function () {
  return new DatabaseController(this.adapter, { collectionPrefix: this.collectionPrefix, skipValidation: true });
};

// Connects to the database. Returns a promise that resolves when the
// connection is successful.
DatabaseController.prototype.connect = function () {
  return this.adapter.connect();
};

DatabaseController.prototype.schemaCollection = function () {
  return this.adapter.schemaCollection();
};

DatabaseController.prototype.collectionExists = function (className) {
  return this.adapter.collectionExists(className);
};

DatabaseController.prototype.validateClassName = function (className) {
  if (this.skipValidation) {
    return Promise.resolve();
  }
  if (!SchemaController.classNameIsValid(className)) {
    var error = new Parse.Error(Parse.Error.INVALID_CLASS_NAME, 'invalid className: ' + className);
    return Promise.reject(error);
  }
  return Promise.resolve();
};

// Returns a promise for a schema object.
// If we are provided a acceptor, then we run it on the schema.
// If the schema isn't accepted, we reload it at most once.
DatabaseController.prototype.loadSchema = function () {
  var _this = this;

  if (!this.schemaPromise) {
    this.schemaPromise = this.schemaCollection().then(function (collection) {
      delete _this.schemaPromise;
      return SchemaController.load(collection, _this.adapter);
    });
  }
  return this.schemaPromise;
};

// Returns a promise for the classname that is related to the given
// classname through the key.
// TODO: make this not in the DatabaseController interface
DatabaseController.prototype.redirectClassNameForKey = function (className, key) {
  return this.loadSchema().then(function (schema) {
    var t = schema.getExpectedType(className, key);
    if (t.type == 'Relation') {
      return t.targetClass;
    } else {
      return className;
    }
  });
};

// Uses the schema to validate the object (REST API format).
// Returns a promise that resolves to the new schema.
// This does not update this.schema, because in a situation like a
// batch request, that could confuse other users of the schema.
DatabaseController.prototype.validateObject = function (className, object, query, _ref2) {
  var _this2 = this;

  var acl = _ref2.acl;

  var schema = void 0;
  var isMaster = acl === undefined;
  var aclGroup = acl || [];
  return this.loadSchema().then(function (s) {
    schema = s;
    if (isMaster) {
      return Promise.resolve();
    }
    return _this2.canAddField(schema, className, object, aclGroup);
  }).then(function () {
    return schema.validateObject(className, object, query);
  });
};

// Like transform.untransformObject but you need to provide a className.
// Filters out any data that shouldn't be on this REST-formatted object.
DatabaseController.prototype.untransformObject = function (schema, isMaster, aclGroup, className, mongoObject) {
  var object = this.transform.untransformObject(schema, className, mongoObject);

  if (className !== '_User') {
    return object;
  }

  delete object.sessionToken;

  if (isMaster || aclGroup.indexOf(object.objectId) > -1) {
    return object;
  }

  delete object.authData;

  return object;
};

// Runs an update on the database.
// Returns a promise for an object with the new values for field
// modifications that don't know their results ahead of time, like
// 'increment'.
// Options:
//   acl:  a list of strings. If the object to be updated has an ACL,
//         one of the provided strings must provide the caller with
//         write permissions.
DatabaseController.prototype.update = function (className, query, update) {
  var _this3 = this;

  var _ref3 = arguments.length <= 3 || arguments[3] === undefined ? {} : arguments[3];

  var acl = _ref3.acl;
  var many = _ref3.many;
  var upsert = _ref3.upsert;


  var originalUpdate = update;
  // Make a copy of the object, so we don't mutate the incoming data.
  update = deepcopy(update);

  var isMaster = acl === undefined;
  var aclGroup = acl || [];
  var mongoUpdate;
  return this.loadSchema().then(function (schemaController) {
    return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'update')).then(function () {
      return _this3.handleRelationUpdates(className, query.objectId, update);
    }).then(function () {
      return _this3.adapter.adaptiveCollection(className);
    }).then(function (collection) {
      if (!isMaster) {
        query = _this3.addPointerPermissions(schemaController, className, 'update', query, aclGroup);
      }
      if (!query) {
        return Promise.resolve();
      }
      if (acl) {
        query = addWriteACL(query, acl);
      }
      return schemaController.getOneSchema(className).catch(function (error) {
        // If the schema doesn't exist, pretend it exists with no fields. This behaviour
        // will likely need revisiting.
        if (error === undefined) {
          return { fields: {} };
        }
        throw error;
      }).then(function (parseFormatSchema) {
        var mongoWhere = _this3.transform.transformWhere(className, query, { validate: !_this3.skipValidation }, parseFormatSchema);
        mongoUpdate = _this3.transform.transformUpdate(schemaController, className, update, { validate: !_this3.skipValidation });
        if (many) {
          return collection.updateMany(mongoWhere, mongoUpdate);
        } else if (upsert) {
          return collection.upsertOne(mongoWhere, mongoUpdate);
        } else {
          return collection.findOneAndUpdate(mongoWhere, mongoUpdate);
        }
      });
    }).then(function (result) {
      if (!result) {
        return Promise.reject(new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.'));
      }
      if (_this3.skipValidation) {
        return Promise.resolve(result);
      }
      return sanitizeDatabaseResult(originalUpdate, result);
    });
  });
};

function sanitizeDatabaseResult(originalObject, result) {
  var response = {};
  if (!result) {
    return Promise.resolve(response);
  }
  Object.keys(originalObject).forEach(function (key) {
    var keyUpdate = originalObject[key];
    // determine if that was an op
    if (keyUpdate && (typeof keyUpdate === 'undefined' ? 'undefined' : _typeof(keyUpdate)) === 'object' && keyUpdate.__op && ['Add', 'AddUnique', 'Remove', 'Increment'].indexOf(keyUpdate.__op) > -1) {
      // only valid ops that produce an actionable result
      response[key] = result[key];
    }
  });
  return Promise.resolve(response);
}

// Processes relation-updating operations from a REST-format update.
// Returns a promise that resolves successfully when these are
// processed.
// This mutates update.
DatabaseController.prototype.handleRelationUpdates = function (className, objectId, update) {
  var _this4 = this;

  var pending = [];
  var deleteMe = [];
  objectId = update.objectId || objectId;

  var process = function process(op, key) {
    if (!op) {
      return;
    }
    if (op.__op == 'AddRelation') {
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = op.objects[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var object = _step.value;

          pending.push(_this4.addRelation(key, className, objectId, object.objectId));
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

      deleteMe.push(key);
    }

    if (op.__op == 'RemoveRelation') {
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = op.objects[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          var object = _step2.value;

          pending.push(_this4.removeRelation(key, className, objectId, object.objectId));
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

      deleteMe.push(key);
    }

    if (op.__op == 'Batch') {
      var _iteratorNormalCompletion3 = true;
      var _didIteratorError3 = false;
      var _iteratorError3 = undefined;

      try {
        for (var _iterator3 = op.ops[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
          var x = _step3.value;

          process(x, key);
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
  };

  for (var key in update) {
    process(update[key], key);
  }
  var _iteratorNormalCompletion4 = true;
  var _didIteratorError4 = false;
  var _iteratorError4 = undefined;

  try {
    for (var _iterator4 = deleteMe[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
      var key = _step4.value;

      delete update[key];
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

  return Promise.all(pending);
};

// Adds a relation.
// Returns a promise that resolves successfully iff the add was successful.
DatabaseController.prototype.addRelation = function (key, fromClassName, fromId, toId) {
  var doc = {
    relatedId: toId,
    owningId: fromId
  };
  var className = '_Join:' + key + ':' + fromClassName;
  return this.adapter.adaptiveCollection(className).then(function (coll) {
    return coll.upsertOne(doc, doc);
  });
};

// Removes a relation.
// Returns a promise that resolves successfully iff the remove was
// successful.
DatabaseController.prototype.removeRelation = function (key, fromClassName, fromId, toId) {
  var doc = {
    relatedId: toId,
    owningId: fromId
  };
  var className = '_Join:' + key + ':' + fromClassName;
  return this.adapter.adaptiveCollection(className).then(function (coll) {
    return coll.deleteOne(doc);
  });
};

// Removes objects matches this query from the database.
// Returns a promise that resolves successfully iff the object was
// deleted.
// Options:
//   acl:  a list of strings. If the object to be updated has an ACL,
//         one of the provided strings must provide the caller with
//         write permissions.
DatabaseController.prototype.destroy = function (className, query) {
  var _this5 = this;

  var _ref4 = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

  var acl = _ref4.acl;

  var isMaster = acl === undefined;
  var aclGroup = acl || [];

  return this.loadSchema().then(function (schemaController) {
    return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'delete')).then(function () {
      if (!isMaster) {
        query = _this5.addPointerPermissions(schemaController, className, 'delete', query, aclGroup);
        if (!query) {
          throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
        }
      }
      // delete by query
      if (acl) {
        query = addWriteACL(query, acl);
      }
      return schemaController.getOneSchema(className).catch(function (error) {
        // If the schema doesn't exist, pretend it exists with no fields. This behaviour
        // will likely need revisiting.
        if (error === undefined) {
          return { fields: {} };
        }
        throw error;
      }).then(function (parseFormatSchema) {
        return _this5.adapter.deleteObjectsByQuery(className, query, !_this5.skipValidation, parseFormatSchema);
      }).catch(function (error) {
        // When deleting sessions while changing passwords, don't throw an error if they don't have any sessions.
        if (className === "_Session" && error.code === Parse.Error.OBJECT_NOT_FOUND) {
          return Promise.resolve({});
        }
        throw error;
      });
    });
  });
};

// Inserts an object into the database.
// Returns a promise that resolves successfully iff the object saved.
DatabaseController.prototype.create = function (className, object) {
  var _this6 = this;

  var _ref5 = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

  var acl = _ref5.acl;

  // Make a copy of the object, so we don't mutate the incoming data.
  var originalObject = object;
  object = deepcopy(object);

  var isMaster = acl === undefined;
  var aclGroup = acl || [];

  return this.validateClassName(className).then(function () {
    return _this6.loadSchema();
  }).then(function (schemaController) {
    return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'create')).then(function () {
      return _this6.handleRelationUpdates(className, null, object);
    }).then(function () {
      return schemaController.enforceClassExists(className);
    }).then(function () {
      return schemaController.getOneSchema(className, true);
    }).then(function (schema) {
      return _this6.adapter.createObject(className, object, schemaController, schema);
    }).then(function (result) {
      return sanitizeDatabaseResult(originalObject, result.ops[0]);
    });
  });
};

DatabaseController.prototype.canAddField = function (schema, className, object, aclGroup) {
  var classSchema = schema.data[className];
  if (!classSchema) {
    return Promise.resolve();
  }
  var fields = Object.keys(object);
  var schemaFields = Object.keys(classSchema);
  var newKeys = fields.filter(function (field) {
    return schemaFields.indexOf(field) < 0;
  });
  if (newKeys.length > 0) {
    return schema.validatePermission(className, aclGroup, 'addField');
  }
  return Promise.resolve();
};

// Runs a mongo query on the database.
// This should only be used for testing - use 'find' for normal code
// to avoid Mongo-format dependencies.
// Returns a promise that resolves to a list of items.
DatabaseController.prototype.mongoFind = function (className, query) {
  var options = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

  return this.adapter.adaptiveCollection(className).then(function (collection) {
    return collection.find(query, options);
  });
};

// Deletes everything in the database matching the current collectionPrefix
// Won't delete collections in the system namespace
// Returns a promise.
DatabaseController.prototype.deleteEverything = function () {
  this.schemaPromise = null;
  return this.adapter.deleteAllSchemas();
};

// Finds the keys in a query. Returns a Set. REST format only
function keysForQuery(query) {
  var sublist = query['$and'] || query['$or'];
  if (sublist) {
    var answer = sublist.reduce(function (memo, subquery) {
      return memo.concat(keysForQuery(subquery));
    }, []);

    return new Set(answer);
  }

  return new Set(Object.keys(query));
}

// Returns a promise for a list of related ids given an owning id.
// className here is the owning className.
DatabaseController.prototype.relatedIds = function (className, key, owningId) {
  return this.adapter.adaptiveCollection(joinTableName(className, key)).then(function (coll) {
    return coll.find({ owningId: owningId });
  }).then(function (results) {
    return results.map(function (r) {
      return r.relatedId;
    });
  });
};

// Returns a promise for a list of owning ids given some related ids.
// className here is the owning className.
DatabaseController.prototype.owningIds = function (className, key, relatedIds) {
  return this.adapter.adaptiveCollection(joinTableName(className, key)).then(function (coll) {
    return coll.find({ relatedId: { '$in': relatedIds } });
  }).then(function (results) {
    return results.map(function (r) {
      return r.owningId;
    });
  });
};

// Modifies query so that it no longer has $in on relation fields, or
// equal-to-pointer constraints on relation fields.
// Returns a promise that resolves when query is mutated
DatabaseController.prototype.reduceInRelation = function (className, query, schema) {
  var _this7 = this;

  // Search for an in-relation or equal-to-relation
  // Make it sequential for now, not sure of paralleization side effects
  if (query['$or']) {
    var ors = query['$or'];
    return Promise.all(ors.map(function (aQuery, index) {
      return _this7.reduceInRelation(className, aQuery, schema).then(function (aQuery) {
        query['$or'][index] = aQuery;
      });
    }));
  }

  var promises = Object.keys(query).map(function (key) {
    if (query[key] && (query[key]['$in'] || query[key]['$ne'] || query[key]['$nin'] || query[key].__type == 'Pointer')) {
      var t = schema.getExpectedType(className, key);
      if (!t || t.type !== 'Relation') {
        return Promise.resolve(query);
      }
      var relatedClassName = t.targetClass;
      // Build the list of queries
      var queries = Object.keys(query[key]).map(function (constraintKey) {
        var relatedIds = void 0;
        var isNegation = false;
        if (constraintKey === 'objectId') {
          relatedIds = [query[key].objectId];
        } else if (constraintKey == '$in') {
          relatedIds = query[key]['$in'].map(function (r) {
            return r.objectId;
          });
        } else if (constraintKey == '$nin') {
          isNegation = true;
          relatedIds = query[key]['$nin'].map(function (r) {
            return r.objectId;
          });
        } else if (constraintKey == '$ne') {
          isNegation = true;
          relatedIds = [query[key]['$ne'].objectId];
        } else {
          return;
        }
        return {
          isNegation: isNegation,
          relatedIds: relatedIds
        };
      });

      // remove the current queryKey as we don,t need it anymore
      delete query[key];
      // execute each query independnently to build the list of
      // $in / $nin
      var _promises = queries.map(function (q) {
        if (!q) {
          return Promise.resolve();
        }
        return _this7.owningIds(className, key, q.relatedIds).then(function (ids) {
          if (q.isNegation) {
            _this7.addNotInObjectIdsIds(ids, query);
          } else {
            _this7.addInObjectIdsIds(ids, query);
          }
          return Promise.resolve();
        });
      });

      return Promise.all(_promises).then(function () {
        return Promise.resolve();
      });
    }
    return Promise.resolve();
  });

  return Promise.all(promises).then(function () {
    return Promise.resolve(query);
  });
};

// Modifies query so that it no longer has $relatedTo
// Returns a promise that resolves when query is mutated
DatabaseController.prototype.reduceRelationKeys = function (className, query) {
  var _this8 = this;

  if (query['$or']) {
    return Promise.all(query['$or'].map(function (aQuery) {
      return _this8.reduceRelationKeys(className, aQuery);
    }));
  }

  var relatedTo = query['$relatedTo'];
  if (relatedTo) {
    return this.relatedIds(relatedTo.object.className, relatedTo.key, relatedTo.object.objectId).then(function (ids) {
      delete query['$relatedTo'];
      _this8.addInObjectIdsIds(ids, query);
      return _this8.reduceRelationKeys(className, query);
    });
  }
};

DatabaseController.prototype.addInObjectIdsIds = function () {
  var ids = arguments.length <= 0 || arguments[0] === undefined ? null : arguments[0];
  var query = arguments[1];

  var idsFromString = typeof query.objectId === 'string' ? [query.objectId] : null;
  var idsFromEq = query.objectId && query.objectId['$eq'] ? [query.objectId['$eq']] : null;
  var idsFromIn = query.objectId && query.objectId['$in'] ? query.objectId['$in'] : null;

  var allIds = [idsFromString, idsFromEq, idsFromIn, ids].filter(function (list) {
    return list !== null;
  });
  var totalLength = allIds.reduce(function (memo, list) {
    return memo + list.length;
  }, 0);

  var idsIntersection = [];
  if (totalLength > 125) {
    idsIntersection = _intersect2.default.big(allIds);
  } else {
    idsIntersection = (0, _intersect2.default)(allIds);
  }

  // Need to make sure we don't clobber existing $lt or other constraints on objectId.
  // Clobbering $eq, $in and shorthand $eq (query.objectId === 'string') constraints
  // is expected though.
  if (!('objectId' in query) || typeof query.objectId === 'string') {
    query.objectId = {};
  }
  query.objectId['$in'] = idsIntersection;

  return query;
};

DatabaseController.prototype.addNotInObjectIdsIds = function () {
  var ids = arguments.length <= 0 || arguments[0] === undefined ? null : arguments[0];
  var query = arguments[1];

  var idsFromNin = query.objectId && query.objectId['$nin'] ? query.objectId['$nin'] : null;
  var allIds = [idsFromNin, ids].filter(function (list) {
    return list !== null;
  });
  var totalLength = allIds.reduce(function (memo, list) {
    return memo + list.length;
  }, 0);

  var idsIntersection = [];
  if (totalLength > 125) {
    idsIntersection = _intersect2.default.big(allIds);
  } else {
    idsIntersection = (0, _intersect2.default)(allIds);
  }

  // Need to make sure we don't clobber existing $lt or other constraints on objectId.
  // Clobbering $eq, $in and shorthand $eq (query.objectId === 'string') constraints
  // is expected though.
  if (!('objectId' in query) || typeof query.objectId === 'string') {
    query.objectId = {};
  }
  query.objectId['$nin'] = idsIntersection;

  return query;
};

// Runs a query on the database.
// Returns a promise that resolves to a list of items.
// Options:
//   skip    number of results to skip.
//   limit   limit to this number of results.
//   sort    an object where keys are the fields to sort by.
//           the value is +1 for ascending, -1 for descending.
//   count   run a count instead of returning results.
//   acl     restrict this operation with an ACL for the provided array
//           of user objectIds and roles. acl: null means no user.
//           when this field is not present, don't do anything regarding ACLs.
// TODO: make userIds not needed here. The db adapter shouldn't know
// anything about users, ideally. Then, improve the format of the ACL
// arg to work like the others.
DatabaseController.prototype.find = function (className, query) {
  var _this9 = this;

  var _ref6 = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

  var skip = _ref6.skip;
  var limit = _ref6.limit;
  var acl = _ref6.acl;
  var sort = _ref6.sort;
  var count = _ref6.count;

  var mongoOptions = {};
  if (skip) {
    mongoOptions.skip = skip;
  }
  if (limit) {
    mongoOptions.limit = limit;
  }
  var isMaster = acl === undefined;
  var aclGroup = acl || [];
  var op = typeof query.objectId == 'string' && Object.keys(query).length === 1 ? 'get' : 'find';
  return this.loadSchema().then(function (schemaController) {
    if (sort) {
      mongoOptions.sort = {};
      for (var fieldName in sort) {
        // Parse.com treats queries on _created_at and _updated_at as if they were queries on createdAt and updatedAt,
        // so duplicate that behaviour here.
        if (fieldName === '_created_at') {
          fieldName = 'createdAt';
          sort['createdAt'] = sort['_created_at'];
        } else if (fieldName === '_updated_at') {
          fieldName = 'updatedAt';
          sort['updatedAt'] = sort['_updated_at'];
        }

        if (!SchemaController.fieldNameIsValid(fieldName)) {
          throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Invalid field name: ' + fieldName + '.');
        }
        var mongoKey = _this9.transform.transformKeyValue(schemaController, className, fieldName, null).key;
        mongoOptions.sort[mongoKey] = sort[fieldName];
      }
    }
    return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, op)).then(function () {
      return _this9.reduceRelationKeys(className, query);
    }).then(function () {
      return _this9.reduceInRelation(className, query, schemaController);
    }).then(function () {
      return _this9.adapter.adaptiveCollection(className);
    }).then(function (collection) {
      if (!isMaster) {
        query = _this9.addPointerPermissions(schemaController, className, op, query, aclGroup);
      }
      if (!query) {
        if (op == 'get') {
          return Promise.reject(new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.'));
        } else {
          return Promise.resolve([]);
        }
      }
      if (!isMaster) {
        query = addReadACL(query, aclGroup);
      }
      return schemaController.getOneSchema(className).catch(function (error) {
        // If the schema doesn't exist, pretend it exists with no fields. This behaviour
        // will likely need revisiting.
        if (error === undefined) {
          return { fields: {} };
        }
        throw error;
      }).then(function (parseFormatSchema) {
        var mongoWhere = _this9.transform.transformWhere(className, query, {}, parseFormatSchema);
        if (count) {
          delete mongoOptions.limit;
          return collection.count(mongoWhere, mongoOptions);
        } else {
          return collection.find(mongoWhere, mongoOptions).then(function (mongoResults) {
            return mongoResults.map(function (r) {
              return _this9.untransformObject(schemaController, isMaster, aclGroup, className, r);
            });
          });
        }
      });
    });
  });
};

DatabaseController.prototype.deleteSchema = function (className) {
  var _this10 = this;

  return this.collectionExists(className).then(function (exist) {
    if (!exist) {
      return Promise.resolve();
    }
    return _this10.adapter.adaptiveCollection(className).then(function (collection) {
      return collection.count();
    }).then(function (count) {
      if (count > 0) {
        throw new Parse.Error(255, 'Class ' + className + ' is not empty, contains ' + count + ' objects, cannot drop schema.');
      }
      return _this10.adapter.deleteOneSchema(className);
    });
  });
};

DatabaseController.prototype.addPointerPermissions = function (schema, className, operation, query) {
  var aclGroup = arguments.length <= 4 || arguments[4] === undefined ? [] : arguments[4];

  var perms = schema.perms[className];
  var field = ['get', 'find'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields';
  var userACL = aclGroup.filter(function (acl) {
    return acl.indexOf('role:') != 0 && acl != '*';
  });
  // the ACL should have exactly 1 user
  if (perms && perms[field] && perms[field].length > 0) {
    var _ret = function () {
      // No user set return undefined
      if (userACL.length != 1) {
        return {
          v: void 0
        };
      }
      var userId = userACL[0];
      var userPointer = {
        "__type": "Pointer",
        "className": "_User",
        "objectId": userId
      };

      var constraints = {};
      var permFields = perms[field];
      var ors = permFields.map(function (key) {
        var q = _defineProperty({}, key, userPointer);
        return { '$and': [q, query] };
      });
      if (ors.length > 1) {
        return {
          v: { '$or': ors }
        };
      }
      return {
        v: ors[0]
      };
    }();

    if ((typeof _ret === 'undefined' ? 'undefined' : _typeof(_ret)) === "object") return _ret.v;
  } else {
    return query;
  }
};

function joinTableName(className, key) {
  return '_Join:' + key + ':' + className;
}

module.exports = DatabaseController;