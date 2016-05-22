'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MongoStorageAdapter = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _MongoCollection = require('./MongoCollection');

var _MongoCollection2 = _interopRequireDefault(_MongoCollection);

var _MongoSchemaCollection = require('./MongoSchemaCollection');

var _MongoSchemaCollection2 = _interopRequireDefault(_MongoSchemaCollection);

var _mongodbUrl = require('../../../vendor/mongodbUrl');

var _MongoTransform = require('./MongoTransform');

var transform = _interopRequireWildcard(_MongoTransform);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var mongodb = require('mongodb');
var MongoClient = mongodb.MongoClient;

var MongoSchemaCollectionName = '_SCHEMA';
var DefaultMongoURI = 'mongodb://localhost:27017/parse';

var storageAdapterAllCollections = function storageAdapterAllCollections(mongoAdapter) {
  return mongoAdapter.connect().then(function () {
    return mongoAdapter.database.collections();
  }).then(function (collections) {
    return collections.filter(function (collection) {
      if (collection.namespace.match(/\.system\./)) {
        return false;
      }
      // TODO: If you have one app with a collection prefix that happens to be a prefix of another
      // apps prefix, this will go very very badly. We should fix that somehow.
      return collection.collectionName.indexOf(mongoAdapter._collectionPrefix) == 0;
    });
  });
};

var MongoStorageAdapter = exports.MongoStorageAdapter = function () {
  // Public

  function MongoStorageAdapter(_ref) {
    var _ref$uri = _ref.uri;
    var uri = _ref$uri === undefined ? DefaultMongoURI : _ref$uri;
    var _ref$collectionPrefix = _ref.collectionPrefix;
    var collectionPrefix = _ref$collectionPrefix === undefined ? '' : _ref$collectionPrefix;
    var _ref$mongoOptions = _ref.mongoOptions;
    var mongoOptions = _ref$mongoOptions === undefined ? {} : _ref$mongoOptions;

    _classCallCheck(this, MongoStorageAdapter);

    this._uri = uri;
    this._collectionPrefix = collectionPrefix;
    this._mongoOptions = mongoOptions;
  }
  // Private


  _createClass(MongoStorageAdapter, [{
    key: 'connect',
    value: function connect() {
      var _this = this;

      if (this.connectionPromise) {
        return this.connectionPromise;
      }

      // parsing and re-formatting causes the auth value (if there) to get URI
      // encoded
      var encodedUri = (0, _mongodbUrl.format)((0, _mongodbUrl.parse)(this._uri));

      this.connectionPromise = MongoClient.connect(encodedUri, this._mongoOptions).then(function (database) {
        _this.database = database;
      });
      return this.connectionPromise;
    }
  }, {
    key: 'collection',
    value: function collection(name) {
      var _this2 = this;

      return this.connect().then(function () {
        return _this2.database.collection(name);
      });
    }
  }, {
    key: 'adaptiveCollection',
    value: function adaptiveCollection(name) {
      var _this3 = this;

      return this.connect().then(function () {
        return _this3.database.collection(_this3._collectionPrefix + name);
      }).then(function (rawCollection) {
        return new _MongoCollection2.default(rawCollection);
      });
    }
  }, {
    key: 'schemaCollection',
    value: function schemaCollection() {
      var _this4 = this;

      return this.connect().then(function () {
        return _this4.adaptiveCollection(MongoSchemaCollectionName);
      }).then(function (collection) {
        return new _MongoSchemaCollection2.default(collection);
      });
    }
  }, {
    key: 'collectionExists',
    value: function collectionExists(name) {
      var _this5 = this;

      return this.connect().then(function () {
        return _this5.database.listCollections({ name: _this5._collectionPrefix + name }).toArray();
      }).then(function (collections) {
        return collections.length > 0;
      });
    }

    // Deletes a schema. Resolve if successful. If the schema doesn't
    // exist, resolve with undefined. If schema exists, but can't be deleted for some other reason,
    // reject with INTERNAL_SERVER_ERROR.

  }, {
    key: 'deleteOneSchema',
    value: function deleteOneSchema(className) {
      return this.collection(this._collectionPrefix + className).then(function (collection) {
        return collection.drop();
      }).catch(function (error) {
        // 'ns not found' means collection was already gone. Ignore deletion attempt.
        if (error.message == 'ns not found') {
          return Promise.resolve();
        }
        return Promise.reject(error);
      });
    }

    // Delete all data known to this adatper. Used for testing.

  }, {
    key: 'deleteAllSchemas',
    value: function deleteAllSchemas() {
      return storageAdapterAllCollections(this).then(function (collections) {
        return Promise.all(collections.map(function (collection) {
          return collection.drop();
        }));
      });
    }

    // Remove the column and all the data. For Relations, the _Join collection is handled
    // specially, this function does not delete _Join columns. It should, however, indicate
    // that the relation fields does not exist anymore. In mongo, this means removing it from
    // the _SCHEMA collection.  There should be no actual data in the collection under the same name
    // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
    // deleted do not exist, this function should return successfully anyways. Checking for
    // attempts to delete non-existent fields is the responsibility of Parse Server.

    // Pointer field names are passed for legacy reasons: the original mongo
    // format stored pointer field names differently in the database, and therefore
    // needed to know the type of the field before it could delete it. Future database
    // adatpers should ignore the pointerFieldNames argument. All the field names are in
    // fieldNames, they show up additionally in the pointerFieldNames database for use
    // by the mongo adapter, which deals with the legacy mongo format.

    // This function is not obligated to delete fields atomically. It is given the field
    // names in a list so that databases that are capable of deleting fields atomically
    // may do so.

    // Returns a Promise.

  }, {
    key: 'deleteFields',
    value: function deleteFields(className, fieldNames, pointerFieldNames) {
      var _this6 = this;

      var nonPointerFieldNames = _lodash2.default.difference(fieldNames, pointerFieldNames);
      var mongoFormatNames = nonPointerFieldNames.concat(pointerFieldNames.map(function (name) {
        return '_p_' + name;
      }));
      var collectionUpdate = { '$unset': {} };
      mongoFormatNames.forEach(function (name) {
        collectionUpdate['$unset'][name] = null;
      });

      var schemaUpdate = { '$unset': {} };
      fieldNames.forEach(function (name) {
        schemaUpdate['$unset'][name] = null;
      });

      return this.adaptiveCollection(className).then(function (collection) {
        return collection.updateMany({}, collectionUpdate);
      }).then(function (updateResult) {
        return _this6.schemaCollection();
      }).then(function (schemaCollection) {
        return schemaCollection.updateSchema(className, schemaUpdate);
      });
    }

    // Return a promise for all schemas known to this adapter, in Parse format. In case the
    // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
    // rejection reason are TBD.

  }, {
    key: 'getAllSchemas',
    value: function getAllSchemas() {
      return this.schemaCollection().then(function (schemasCollection) {
        return schemasCollection._fetchAllSchemasFrom_SCHEMA();
      });
    }

    // Return a promise for the schema with the given name, in Parse format. If
    // this adapter doesn't know about the schema, return a promise that rejects with
    // undefined as the reason.

  }, {
    key: 'getOneSchema',
    value: function getOneSchema(className) {
      return this.schemaCollection().then(function (schemasCollection) {
        return schemasCollection._fechOneSchemaFrom_SCHEMA(className);
      });
    }

    // TODO: As yet not particularly well specified. Creates an object. Shouldn't need the
    // schemaController, but MongoTransform still needs it :( maybe shouldn't even need the schema,
    // and should infer from the type. Or maybe does need the schema for validations. Or maybe needs
    // the schem only for the legacy mongo format. We'll figure that out later.

  }, {
    key: 'createObject',
    value: function createObject(className, object, schemaController, parseFormatSchema) {
      var mongoObject = transform.parseObjectToMongoObjectForCreate(schemaController, className, object, parseFormatSchema);
      return this.adaptiveCollection(className).then(function (collection) {
        return collection.insertOne(mongoObject);
      }).catch(function (error) {
        if (error.code === 11000) {
          // Duplicate value
          throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        }
        return Promise.reject(error);
      });
    }

    // Remove all objects that match the given parse query. Parse Query should be in Parse Format.
    // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
    // If there is some other error, reject with INTERNAL_SERVER_ERROR.

    // Currently accepts validate for legacy reasons. Currently accepts the schema, that may not actually be necessary.

  }, {
    key: 'deleteObjectsByQuery',
    value: function deleteObjectsByQuery(className, query, validate, schema) {
      return this.adaptiveCollection(className).then(function (collection) {
        var mongoWhere = transform.transformWhere(className, query, { validate: validate }, schema);
        return collection.deleteMany(mongoWhere);
      }).then(function (_ref2) {
        var result = _ref2.result;

        if (result.n === 0) {
          throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
        }
        return Promise.resolve();
      }, function (error) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Database adapter error');
      });
    }
  }, {
    key: 'transform',
    get: function get() {
      return transform;
    }
  }]);

  return MongoStorageAdapter;
}();

exports.default = MongoStorageAdapter;

module.exports = MongoStorageAdapter; // Required for tests