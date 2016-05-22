'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _MongoCollection = require('./MongoCollection');

var _MongoCollection2 = _interopRequireDefault(_MongoCollection);

var _MongoTransform = require('./MongoTransform');

var transform = _interopRequireWildcard(_MongoTransform);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function mongoFieldToParseSchemaField(type) {
  if (type[0] === '*') {
    return {
      type: 'Pointer',
      targetClass: type.slice(1)
    };
  }
  if (type.startsWith('relation<')) {
    return {
      type: 'Relation',
      targetClass: type.slice('relation<'.length, type.length - 1)
    };
  }
  switch (type) {
    case 'number':
      return { type: 'Number' };
    case 'string':
      return { type: 'String' };
    case 'boolean':
      return { type: 'Boolean' };
    case 'date':
      return { type: 'Date' };
    case 'map':
    case 'object':
      return { type: 'Object' };
    case 'array':
      return { type: 'Array' };
    case 'geopoint':
      return { type: 'GeoPoint' };
    case 'file':
      return { type: 'File' };
  }
}

var nonFieldSchemaKeys = ['_id', '_metadata', '_client_permissions'];
function mongoSchemaFieldsToParseSchemaFields(schema) {
  var fieldNames = Object.keys(schema).filter(function (key) {
    return nonFieldSchemaKeys.indexOf(key) === -1;
  });
  var response = fieldNames.reduce(function (obj, fieldName) {
    obj[fieldName] = mongoFieldToParseSchemaField(schema[fieldName]);
    return obj;
  }, {});
  response.ACL = { type: 'ACL' };
  response.createdAt = { type: 'Date' };
  response.updatedAt = { type: 'Date' };
  response.objectId = { type: 'String' };
  return response;
}

var defaultCLPS = Object.freeze({
  find: { '*': true },
  get: { '*': true },
  create: { '*': true },
  update: { '*': true },
  delete: { '*': true },
  addField: { '*': true }
});

function mongoSchemaToParseSchema(mongoSchema) {
  var clpsFromMongoObject = {};
  if (mongoSchema._metadata && mongoSchema._metadata.class_permissions) {
    clpsFromMongoObject = mongoSchema._metadata.class_permissions;
  }
  return {
    className: mongoSchema._id,
    fields: mongoSchemaFieldsToParseSchemaFields(mongoSchema),
    classLevelPermissions: _extends({}, defaultCLPS, clpsFromMongoObject)
  };
}

function _mongoSchemaQueryFromNameQuery(name, query) {
  return _mongoSchemaObjectFromNameFields(name, query);
}

function _mongoSchemaObjectFromNameFields(name, fields) {
  var object = { _id: name };
  if (fields) {
    Object.keys(fields).forEach(function (key) {
      object[key] = fields[key];
    });
  }
  return object;
}

// Returns a type suitable for inserting into mongo _SCHEMA collection.
// Does no validation. That is expected to be done in Parse Server.
function parseFieldTypeToMongoFieldType(_ref) {
  var type = _ref.type;
  var targetClass = _ref.targetClass;

  switch (type) {
    case 'Pointer':
      return '*' + targetClass;
    case 'Relation':
      return 'relation<' + targetClass + '>';
    case 'Number':
      return 'number';
    case 'String':
      return 'string';
    case 'Boolean':
      return 'boolean';
    case 'Date':
      return 'date';
    case 'Object':
      return 'object';
    case 'Array':
      return 'array';
    case 'GeoPoint':
      return 'geopoint';
    case 'File':
      return 'file';
  }
}

// Returns { code, error } if invalid, or { result }, an object
// suitable for inserting into _SCHEMA collection, otherwise.
function mongoSchemaFromFieldsAndClassNameAndCLP(fields, className, classLevelPermissions) {

  var mongoObject = {
    _id: className,
    objectId: 'string',
    updatedAt: 'string',
    createdAt: 'string'
  };

  for (var fieldName in fields) {
    mongoObject[fieldName] = parseFieldTypeToMongoFieldType(fields[fieldName]);
  }

  if (typeof classLevelPermissions !== 'undefined') {
    mongoObject._metadata = mongoObject._metadata || {};
    if (!classLevelPermissions) {
      delete mongoObject._metadata.class_permissions;
    } else {
      mongoObject._metadata.class_permissions = classLevelPermissions;
    }
  }

  return mongoObject;
}

var MongoSchemaCollection = function () {
  function MongoSchemaCollection(collection) {
    _classCallCheck(this, MongoSchemaCollection);

    this._collection = collection;
  }

  _createClass(MongoSchemaCollection, [{
    key: '_fetchAllSchemasFrom_SCHEMA',
    value: function _fetchAllSchemasFrom_SCHEMA() {
      return this._collection._rawFind({}).then(function (schemas) {
        return schemas.map(mongoSchemaToParseSchema);
      });
    }
  }, {
    key: '_fechOneSchemaFrom_SCHEMA',
    value: function _fechOneSchemaFrom_SCHEMA(name) {
      return this._collection._rawFind(_mongoSchemaQueryFromNameQuery(name), { limit: 1 }).then(function (results) {
        if (results.length === 1) {
          return mongoSchemaToParseSchema(results[0]);
        } else {
          return Promise.reject();
        }
      });
    }

    // Atomically find and delete an object based on query.
    // The result is the promise with an object that was in the database before deleting.
    // Postgres Note: Translates directly to `DELETE * FROM ... RETURNING *`, which will return data after delete is done.

  }, {
    key: 'findAndDeleteSchema',
    value: function findAndDeleteSchema(name) {
      // arguments: query, sort
      return this._collection._mongoCollection.findAndRemove(_mongoSchemaQueryFromNameQuery(name), []).then(function (document) {
        // Value is the object where mongo returns multiple fields.
        return document.value;
      });
    }

    // Add a collection. Currently the input is in mongo format, but that will change to Parse format in a
    // later PR. Returns a promise that is expected to resolve with the newly created schema, in Parse format.
    // If the class already exists, returns a promise that rejects with undefined as the reason. If the collection
    // can't be added for a reason other than it already existing, requirements for rejection reason are TBD.

  }, {
    key: 'addSchema',
    value: function addSchema(name, fields, classLevelPermissions) {
      var mongoSchema = mongoSchemaFromFieldsAndClassNameAndCLP(fields, name, classLevelPermissions);
      var mongoObject = _mongoSchemaObjectFromNameFields(name, mongoSchema);
      return this._collection.insertOne(mongoObject).then(function (result) {
        return mongoSchemaToParseSchema(result.ops[0]);
      }).catch(function (error) {
        if (error.code === 11000) {
          //Mongo's duplicate key error
          return Promise.reject();
        }
        return Promise.reject(error);
      });
    }
  }, {
    key: 'updateSchema',
    value: function updateSchema(name, update) {
      return this._collection.updateOne(_mongoSchemaQueryFromNameQuery(name), update);
    }
  }, {
    key: 'upsertSchema',
    value: function upsertSchema(name, query, update) {
      return this._collection.upsertOne(_mongoSchemaQueryFromNameQuery(name, query), update);
    }

    // Add a field to the schema. If database does not support the field
    // type (e.g. mongo doesn't support more than one GeoPoint in a class) reject with an "Incorrect Type"
    // Parse error with a desciptive message. If the field already exists, this function must
    // not modify the schema, and must reject with an error. Exact error format is TBD. If this function
    // is called for a class that doesn't exist, this function must create that class.

    // TODO: throw an error if an unsupported field type is passed. Deciding whether a type is supported
    // should be the job of the adapter. Some adapters may not support GeoPoint at all. Others may
    // Support additional types that Mongo doesn't, like Money, or something.

    // TODO: don't spend an extra query on finding the schema if the type we are trying to add isn't a GeoPoint.

  }, {
    key: 'addFieldIfNotExists',
    value: function addFieldIfNotExists(className, fieldName, type) {
      var _this = this;

      return this._fechOneSchemaFrom_SCHEMA(className).then(function (schema) {
        // The schema exists. Check for existing GeoPoints.
        if (type.type === 'GeoPoint') {
          // Make sure there are not other geopoint fields
          if (Object.keys(schema.fields).some(function (existingField) {
            return schema.fields[existingField].type === 'GeoPoint';
          })) {
            return Promise.reject(new Parse.Error(Parse.Error.INCORRECT_TYPE, 'MongoDB only supports one GeoPoint field in a class.'));
          }
        }
        return Promise.resolve();
      }, function (error) {
        // If error is undefined, the schema doesn't exist, and we can create the schema with the field.
        // If some other error, reject with it.
        if (error === undefined) {
          return Promise.resolve();
        }
        throw Promise.reject(error);
      }).then(function () {
        // We use $exists and $set to avoid overwriting the field type if it
        // already exists. (it could have added inbetween the last query and the update)
        return _this.upsertSchema(className, _defineProperty({}, fieldName, { '$exists': false }), { '$set': _defineProperty({}, fieldName, parseFieldTypeToMongoFieldType(type)) });
      });
    }
  }, {
    key: 'transform',
    get: function get() {
      return transform;
    }
  }]);

  return MongoSchemaCollection;
}();

// Exported for testing reasons and because we haven't moved all mongo schema format
// related logic into the database adapter yet.


MongoSchemaCollection._TESTmongoSchemaToParseSchema = mongoSchemaToParseSchema;

exports.default = MongoSchemaCollection;