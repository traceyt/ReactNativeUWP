'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _logger = require('../../../logger');

var _logger2 = _interopRequireDefault(_logger);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var mongodb = require('mongodb');
var Parse = require('parse/node').Parse;

// Transforms a key-value pair from REST API form to Mongo form.
// This is the main entry point for converting anything from REST form
// to Mongo form; no conversion should happen that doesn't pass
// through this function.
// Schema should already be loaded.
//
// There are several options that can help transform:
//
// update: true indicates that __op operators like Add and Delete
// in the value are converted to a mongo update form. Otherwise they are
// converted to static data.
//
// Returns an object with {key: key, value: value}.
function transformKeyValue(schema, className, restKey, restValue) {
  var _ref = arguments.length <= 4 || arguments[4] === undefined ? {} : arguments[4];

  var inArray = _ref.inArray;
  var inObject = _ref.inObject;
  var update = _ref.update;

  // Check if the schema is known since it's a built-in field.
  var key = restKey;
  var timeField = false;
  switch (key) {
    case 'objectId':
    case '_id':
      key = '_id';
      break;
    case 'createdAt':
    case '_created_at':
      key = '_created_at';
      timeField = true;
      break;
    case 'updatedAt':
    case '_updated_at':
      key = '_updated_at';
      timeField = true;
      break;
    case '_email_verify_token':
      key = "_email_verify_token";
      break;
    case '_perishable_token':
      key = "_perishable_token";
      break;
    case 'sessionToken':
    case '_session_token':
      key = '_session_token';
      break;
    case 'expiresAt':
    case '_expiresAt':
      key = 'expiresAt';
      timeField = true;
      break;
    case '_rperm':
    case '_wperm':
      return { key: key, value: restValue };
      break;
    case '$or':
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'you can only use $or in queries');
    case '$and':
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'you can only use $and in queries');
    default:
      // Other auth data
      var authDataMatch = key.match(/^authData\.([a-zA-Z0-9_]+)\.id$/);
      if (authDataMatch) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'can only query on ' + key);
      }
  }

  // Handle special schema key changes
  // TODO: it seems like this is likely to have edge cases where
  // pointer types are missed
  var expected = undefined;
  if (schema && schema.getExpectedType) {
    expected = schema.getExpectedType(className, key);
  }
  if (expected && expected.type == 'Pointer' || !expected && restValue && restValue.__type == 'Pointer') {
    key = '_p_' + key;
  }
  var expectedTypeIsArray = expected && expected.type === 'Array';

  // Handle atomic values
  var value = transformAtom(restValue, false, { inArray: inArray, inObject: inObject });
  if (value !== CannotTransform) {
    if (timeField && typeof value === 'string') {
      value = new Date(value);
    }
    return { key: key, value: value };
  }

  // ACLs are handled before this method is called
  // If an ACL key still exists here, something is wrong.
  if (key === 'ACL') {
    throw 'There was a problem transforming an ACL.';
  }

  // Handle arrays
  if (restValue instanceof Array) {
    value = restValue.map(function (restObj) {
      var out = transformKeyValue(schema, className, restKey, restObj, { inArray: true });
      return out.value;
    });
    return { key: key, value: value };
  }

  // Handle update operators
  value = transformUpdateOperator(restValue, !update);
  if (value !== CannotTransform) {
    return { key: key, value: value };
  }

  // Handle normal objects by recursing
  value = {};
  for (var subRestKey in restValue) {
    var subRestValue = restValue[subRestKey];
    var out = transformKeyValue(schema, className, subRestKey, subRestValue, { inObject: true });
    // For recursed objects, keep the keys in rest format
    value[subRestKey] = out.value;
  }
  return { key: key, value: value };
}

var valueAsDate = function valueAsDate(value) {
  if (typeof value === 'string') {
    return new Date(value);
  } else if (value instanceof Date) {
    return value;
  }
  return false;
};

function transformQueryKeyValue(className, key, value) {
  var _ref2 = arguments.length <= 3 || arguments[3] === undefined ? {} : arguments[3];

  var validate = _ref2.validate;
  var schema = arguments[4];

  switch (key) {
    case 'createdAt':
      if (valueAsDate(value)) {
        return { key: '_created_at', value: valueAsDate(value) };
      }
      key = '_created_at';
      break;
    case 'updatedAt':
      if (valueAsDate(value)) {
        return { key: '_updated_at', value: valueAsDate(value) };
      }
      key = '_updated_at';
      break;
    case 'expiresAt':
      if (valueAsDate(value)) {
        return { key: 'expiresAt', value: valueAsDate(value) };
      }
      break;
    case 'objectId':
      return { key: '_id', value: value };
    case 'sessionToken':
      return { key: '_session_token', value: value };
    case '_rperm':
    case '_wperm':
    case '_perishable_token':
    case '_email_verify_token':
      return { key: key, value: value };
    case '$or':
      if (!(value instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_QUERY, 'bad $or format - use an array value');
      }
      return { key: '$or', value: value.map(function (subQuery) {
          return transformWhere(className, subQuery, {}, schema);
        }) };
    case '$and':
      if (!(value instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_QUERY, 'bad $and format - use an array value');
      }
      return { key: '$and', value: value.map(function (subQuery) {
          return transformWhere(className, subQuery, {}, schema);
        }) };
    default:
      // Other auth data
      var authDataMatch = key.match(/^authData\.([a-zA-Z0-9_]+)\.id$/);
      if (authDataMatch) {
        var provider = authDataMatch[1];
        // Special-case auth data.
        return { key: '_auth_data_' + provider + '.id', value: value };
      }
      if (validate && !key.match(/^[a-zA-Z][a-zA-Z0-9_\.]*$/)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'invalid key name: ' + key);
      }
  }

  var expectedTypeIsArray = schema && schema.fields[key] && schema.fields[key].type === 'Array';

  var expectedTypeIsPointer = schema && schema.fields[key] && schema.fields[key].type === 'Pointer';

  if (expectedTypeIsPointer || !schema && value && value.__type === 'Pointer') {
    key = '_p_' + key;
  }

  // Handle query constraints
  if (transformConstraint(value, expectedTypeIsArray) !== CannotTransform) {
    return { key: key, value: transformConstraint(value, expectedTypeIsArray) };
  }

  if (expectedTypeIsArray && !(value instanceof Array)) {
    return { key: key, value: { '$all': [value] } };
  }

  // Handle atomic values
  if (transformAtom(value, false) !== CannotTransform) {
    return { key: key, value: transformAtom(value, false) };
  } else {
    throw new Parse.Error(Parse.Error.INVALID_JSON, 'You cannot use ' + value + ' as a query parameter.');
  }
}

// Main exposed method to help run queries.
// restWhere is the "where" clause in REST API form.
// Returns the mongo form of the query.
// Throws a Parse.Error if the input query is invalid.
function transformWhere(className, restWhere) {
  var _ref3 = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

  var _ref3$validate = _ref3.validate;
  var validate = _ref3$validate === undefined ? true : _ref3$validate;
  var schema = arguments[3];

  var mongoWhere = {};
  if (restWhere['ACL']) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Cannot query on ACL.');
  }
  for (var restKey in restWhere) {
    var out = transformQueryKeyValue(className, restKey, restWhere[restKey], { validate: validate }, schema);
    mongoWhere[out.key] = out.value;
  }
  return mongoWhere;
}

var parseObjectKeyValueToMongoObjectKeyValue = function parseObjectKeyValueToMongoObjectKeyValue(schema, className, restKey, restValue, parseFormatSchema) {
  // Check if the schema is known since it's a built-in field.
  var transformedValue = void 0;
  var coercedToDate = void 0;
  switch (restKey) {
    case 'objectId':
      return { key: '_id', value: restValue };
    case 'createdAt':
      transformedValue = transformAtom(restValue, false);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_created_at', value: coercedToDate };
    case 'updatedAt':
      transformedValue = transformAtom(restValue, false);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_updated_at', value: coercedToDate };
    case 'expiresAt':
      transformedValue = transformAtom(restValue, false);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: 'expiresAt', value: coercedToDate };
    case '_rperm':
    case '_wperm':
    case '_email_verify_token':
    case '_hashed_password':
    case '_perishable_token':
      return { key: restKey, value: restValue };
    case 'sessionToken':
      return { key: '_session_token', value: restValue };
    default:
      // Auth data should have been transformed already
      if (restKey.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'can only query on ' + restKey);
      }
      // Trust that the auth data has been transformed and save it directly
      if (restKey.match(/^_auth_data_[a-zA-Z0-9_]+$/)) {
        return { key: restKey, value: restValue };
      }
  }
  //skip straight to transformAtom for Bytes, they don't show up in the schema for some reason
  if (restValue && restValue.__type !== 'Bytes') {
    //Note: We may not know the type of a field here, as the user could be saving (null) to a field
    //That never existed before, meaning we can't infer the type.
    if (parseFormatSchema.fields[restKey] && parseFormatSchema.fields[restKey].type == 'Pointer' || restValue.__type == 'Pointer') {
      restKey = '_p_' + restKey;
    }
  }

  // Handle atomic values
  var value = transformAtom(restValue, false, { inArray: false, inObject: false });
  if (value !== CannotTransform) {
    return { key: restKey, value: value };
  }

  // ACLs are handled before this method is called
  // If an ACL key still exists here, something is wrong.
  if (restKey === 'ACL') {
    throw 'There was a problem transforming an ACL.';
  }

  // Handle arrays
  if (restValue instanceof Array) {
    value = restValue.map(function (restObj) {
      var out = transformKeyValue(schema, className, restKey, restObj, { inArray: true });
      return out.value;
    });
    return { key: restKey, value: value };
  }

  // Handle update operators. TODO: handle within Parse Server. DB adapter shouldn't see update operators in creates.
  value = transformUpdateOperator(restValue, true);
  if (value !== CannotTransform) {
    return { key: restKey, value: value };
  }

  // Handle normal objects by recursing
  value = {};
  for (var subRestKey in restValue) {
    var subRestValue = restValue[subRestKey];
    var out = transformKeyValue(schema, className, subRestKey, subRestValue, { inObject: true });
    // For recursed objects, keep the keys in rest format
    value[subRestKey] = out.value;
  }
  return { key: restKey, value: value };
};

// Main exposed method to create new objects.
// restCreate is the "create" clause in REST API form.
function parseObjectToMongoObjectForCreate(schema, className, restCreate, parseFormatSchema) {
  if (className == '_User') {
    restCreate = transformAuthData(restCreate);
  }
  var mongoCreate = transformACL(restCreate);
  for (var restKey in restCreate) {
    var _parseObjectKeyValueT = parseObjectKeyValueToMongoObjectKeyValue(schema, className, restKey, restCreate[restKey], parseFormatSchema);

    var key = _parseObjectKeyValueT.key;
    var value = _parseObjectKeyValueT.value;

    if (value !== undefined) {
      mongoCreate[key] = value;
    }
  }
  return mongoCreate;
}

// Main exposed method to help update old objects.
function transformUpdate(schema, className, restUpdate) {
  if (!restUpdate) {
    throw 'got empty restUpdate';
  }
  if (className == '_User') {
    restUpdate = transformAuthData(restUpdate);
  }

  var mongoUpdate = {};
  var acl = transformACL(restUpdate);
  if (acl._rperm || acl._wperm || acl._acl) {
    mongoUpdate['$set'] = {};
    if (acl._rperm) {
      mongoUpdate['$set']['_rperm'] = acl._rperm;
    }
    if (acl._wperm) {
      mongoUpdate['$set']['_wperm'] = acl._wperm;
    }
    if (acl._acl) {
      mongoUpdate['$set']['_acl'] = acl._acl;
    }
  }

  for (var restKey in restUpdate) {
    var out = transformKeyValue(schema, className, restKey, restUpdate[restKey], { update: true });

    // If the output value is an object with any $ keys, it's an
    // operator that needs to be lifted onto the top level update
    // object.
    if (_typeof(out.value) === 'object' && out.value !== null && out.value.__op) {
      mongoUpdate[out.value.__op] = mongoUpdate[out.value.__op] || {};
      mongoUpdate[out.value.__op][out.key] = out.value.arg;
    } else {
      mongoUpdate['$set'] = mongoUpdate['$set'] || {};
      mongoUpdate['$set'][out.key] = out.value;
    }
  }

  return mongoUpdate;
}

function transformAuthData(restObject) {
  if (restObject.authData) {
    Object.keys(restObject.authData).forEach(function (provider) {
      var providerData = restObject.authData[provider];
      if (providerData == null) {
        restObject['_auth_data_' + provider] = {
          __op: 'Delete'
        };
      } else {
        restObject['_auth_data_' + provider] = providerData;
      }
    });
    delete restObject.authData;
  }
  return restObject;
}

// Transforms a REST API formatted ACL object to our two-field mongo format.
// This mutates the restObject passed in to remove the ACL key.
function transformACL(restObject) {
  var output = {};
  if (!restObject['ACL']) {
    return output;
  }
  var acl = restObject['ACL'];
  var rperm = [];
  var wperm = [];
  var _acl = {}; // old format

  for (var entry in acl) {
    if (acl[entry].read) {
      rperm.push(entry);
      _acl[entry] = _acl[entry] || {};
      _acl[entry]['r'] = true;
    }
    if (acl[entry].write) {
      wperm.push(entry);
      _acl[entry] = _acl[entry] || {};
      _acl[entry]['w'] = true;
    }
  }
  output._rperm = rperm;
  output._wperm = wperm;
  output._acl = _acl;
  delete restObject.ACL;
  return output;
}

// Transforms a mongo format ACL to a REST API format ACL key
// This mutates the mongoObject passed in to remove the _rperm/_wperm keys
function untransformACL(mongoObject) {
  var output = {};
  if (!mongoObject['_rperm'] && !mongoObject['_wperm']) {
    return output;
  }
  var acl = {};
  var rperm = mongoObject['_rperm'] || [];
  var wperm = mongoObject['_wperm'] || [];
  rperm.map(function (entry) {
    if (!acl[entry]) {
      acl[entry] = { read: true };
    } else {
      acl[entry]['read'] = true;
    }
  });
  wperm.map(function (entry) {
    if (!acl[entry]) {
      acl[entry] = { write: true };
    } else {
      acl[entry]['write'] = true;
    }
  });
  output['ACL'] = acl;
  delete mongoObject._rperm;
  delete mongoObject._wperm;
  return output;
}

// A sentinel value that helper transformations return when they
// cannot perform a transformation
function CannotTransform() {}

// Helper function to transform an atom from REST format to Mongo format.
// An atom is anything that can't contain other expressions. So it
// includes things where objects are used to represent other
// datatypes, like pointers and dates, but it does not include objects
// or arrays with generic stuff inside.
// If options.inArray is true, we'll leave it in REST format.
// If options.inObject is true, we'll leave files in REST format.
// Raises an error if this cannot possibly be valid REST format.
// Returns CannotTransform if it's just not an atom, or if force is
// true, throws an error.
function transformAtom(atom, force) {
  var _ref4 = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

  var inArray = _ref4.inArray;
  var inObject = _ref4.inObject;

  switch (typeof atom === 'undefined' ? 'undefined' : _typeof(atom)) {
    case 'string':
    case 'number':
    case 'boolean':
      return atom;
    case 'undefined':
      return atom;
    case 'symbol':
    case 'function':
      throw new Parse.Error(Parse.Error.INVALID_JSON, 'cannot transform value: ' + atom);
    case 'object':
      if (atom instanceof Date) {
        // Technically dates are not rest format, but, it seems pretty
        // clear what they should be transformed to, so let's just do it.
        return atom;
      }

      if (atom === null) {
        return atom;
      }

      // TODO: check validity harder for the __type-defined types
      if (atom.__type == 'Pointer') {
        if (!inArray && !inObject) {
          return atom.className + '$' + atom.objectId;
        }
        return {
          __type: 'Pointer',
          className: atom.className,
          objectId: atom.objectId
        };
      }
      if (DateCoder.isValidJSON(atom)) {
        return DateCoder.JSONToDatabase(atom);
      }
      if (BytesCoder.isValidJSON(atom)) {
        return BytesCoder.JSONToDatabase(atom);
      }
      if (GeoPointCoder.isValidJSON(atom)) {
        return inArray || inObject ? atom : GeoPointCoder.JSONToDatabase(atom);
      }
      if (FileCoder.isValidJSON(atom)) {
        return inArray || inObject ? atom : FileCoder.JSONToDatabase(atom);
      }
      if (inArray || inObject) {
        return atom;
      }

      if (force) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad atom: ' + atom);
      }
      return CannotTransform;

    default:
      // I don't think typeof can ever let us get here
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'really did not expect value: ' + atom);
  }
}

// Transforms a query constraint from REST API format to Mongo format.
// A constraint is something with fields like $lt.
// If it is not a valid constraint but it could be a valid something
// else, return CannotTransform.
// inArray is whether this is an array field.
function transformConstraint(constraint, inArray) {
  if ((typeof constraint === 'undefined' ? 'undefined' : _typeof(constraint)) !== 'object' || !constraint) {
    return CannotTransform;
  }

  // keys is the constraints in reverse alphabetical order.
  // This is a hack so that:
  //   $regex is handled before $options
  //   $nearSphere is handled before $maxDistance
  var keys = Object.keys(constraint).sort().reverse();
  var answer = {};
  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;

  try {
    for (var _iterator = keys[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var key = _step.value;

      switch (key) {
        case '$lt':
        case '$lte':
        case '$gt':
        case '$gte':
        case '$exists':
        case '$ne':
        case '$eq':
          answer[key] = transformAtom(constraint[key], true, { inArray: inArray });
          break;

        case '$in':
        case '$nin':
          var arr = constraint[key];
          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }
          answer[key] = arr.map(function (v) {
            return transformAtom(v, true, { inArray: inArray });
          });
          break;

        case '$all':
          var arr = constraint[key];
          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }
          answer[key] = arr.map(function (v) {
            return transformAtom(v, true, { inArray: true });
          });
          break;

        case '$regex':
          var s = constraint[key];
          if (typeof s !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad regex: ' + s);
          }
          answer[key] = s;
          break;

        case '$options':
          var options = constraint[key];
          if (!answer['$regex'] || typeof options !== 'string' || !options.match(/^[imxs]+$/)) {
            throw new Parse.Error(Parse.Error.INVALID_QUERY, 'got a bad $options');
          }
          answer[key] = options;
          break;

        case '$nearSphere':
          var point = constraint[key];
          answer[key] = [point.longitude, point.latitude];
          break;

        case '$maxDistance':
          answer[key] = constraint[key];
          break;

        // The SDKs don't seem to use these but they are documented in the
        // REST API docs.
        case '$maxDistanceInRadians':
          answer['$maxDistance'] = constraint[key];
          break;
        case '$maxDistanceInMiles':
          answer['$maxDistance'] = constraint[key] / 3959;
          break;
        case '$maxDistanceInKilometers':
          answer['$maxDistance'] = constraint[key] / 6371;
          break;

        case '$select':
        case '$dontSelect':
          throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, 'the ' + key + ' constraint is not supported yet');

        case '$within':
          var box = constraint[key]['$box'];
          if (!box || box.length != 2) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'malformatted $within arg');
          }
          answer[key] = {
            '$box': [[box[0].longitude, box[0].latitude], [box[1].longitude, box[1].latitude]]
          };
          break;

        default:
          if (key.match(/^\$+/)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad constraint: ' + key);
          }
          return CannotTransform;
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

  return answer;
}

// Transforms an update operator from REST format to mongo format.
// To be transformed, the input should have an __op field.
// If flatten is true, this will flatten operators to their static
// data format. For example, an increment of 2 would simply become a
// 2.
// The output for a non-flattened operator is a hash with __op being
// the mongo op, and arg being the argument.
// The output for a flattened operator is just a value.
// Returns CannotTransform if this cannot transform it.
// Returns undefined if this should be a no-op.
function transformUpdateOperator(operator, flatten) {
  if ((typeof operator === 'undefined' ? 'undefined' : _typeof(operator)) !== 'object' || !operator.__op) {
    return CannotTransform;
  }

  switch (operator.__op) {
    case 'Delete':
      if (flatten) {
        return undefined;
      } else {
        return { __op: '$unset', arg: '' };
      }

    case 'Increment':
      if (typeof operator.amount !== 'number') {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'incrementing must provide a number');
      }
      if (flatten) {
        return operator.amount;
      } else {
        return { __op: '$inc', arg: operator.amount };
      }

    case 'Add':
    case 'AddUnique':
      if (!(operator.objects instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to add must be an array');
      }
      var toAdd = operator.objects.map(function (obj) {
        return transformAtom(obj, true, { inArray: true });
      });
      if (flatten) {
        return toAdd;
      } else {
        var mongoOp = {
          Add: '$push',
          AddUnique: '$addToSet'
        }[operator.__op];
        return { __op: mongoOp, arg: { '$each': toAdd } };
      }

    case 'Remove':
      if (!(operator.objects instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to remove must be an array');
      }
      var toRemove = operator.objects.map(function (obj) {
        return transformAtom(obj, true, { inArray: true });
      });
      if (flatten) {
        return [];
      } else {
        return { __op: '$pullAll', arg: toRemove };
      }

    default:
      throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, 'the ' + operator.__op + ' op is not supported yet');
  }
}

var specialKeysForUntransform = ['_id', '_hashed_password', '_acl', '_email_verify_token', '_perishable_token', '_tombstone', '_session_token', 'updatedAt', '_updated_at', 'createdAt', '_created_at', 'expiresAt', '_expiresAt'];

// Converts from a mongo-format object to a REST-format object.
// Does not strip out anything based on a lack of authentication.
function untransformObject(schema, className, mongoObject) {
  var isNestedObject = arguments.length <= 3 || arguments[3] === undefined ? false : arguments[3];

  switch (typeof mongoObject === 'undefined' ? 'undefined' : _typeof(mongoObject)) {
    case 'string':
    case 'number':
    case 'boolean':
      return mongoObject;
    case 'undefined':
    case 'symbol':
    case 'function':
      throw 'bad value in untransformObject';
    case 'object':
      if (mongoObject === null) {
        return null;
      }
      if (mongoObject instanceof Array) {
        return mongoObject.map(function (arrayEntry) {
          return untransformObject(schema, className, arrayEntry, true);
        });
      }

      if (mongoObject instanceof Date) {
        return Parse._encode(mongoObject);
      }

      if (mongoObject instanceof mongodb.Long) {
        return mongoObject.toNumber();
      }

      if (mongoObject instanceof mongodb.Double) {
        return mongoObject.value;
      }

      if (BytesCoder.isValidDatabaseObject(mongoObject)) {
        return BytesCoder.databaseToJSON(mongoObject);
      }

      var restObject = untransformACL(mongoObject);
      for (var key in mongoObject) {
        if (isNestedObject && _lodash2.default.includes(specialKeysForUntransform, key)) {
          restObject[key] = untransformObject(schema, className, mongoObject[key], true);
          continue;
        }
        switch (key) {
          case '_id':
            restObject['objectId'] = '' + mongoObject[key];
            break;
          case '_hashed_password':
            restObject['password'] = mongoObject[key];
            break;
          case '_acl':
          case '_email_verify_token':
          case '_perishable_token':
          case '_tombstone':
            break;
          case '_session_token':
            restObject['sessionToken'] = mongoObject[key];
            break;
          case 'updatedAt':
          case '_updated_at':
            restObject['updatedAt'] = Parse._encode(new Date(mongoObject[key])).iso;
            break;
          case 'createdAt':
          case '_created_at':
            restObject['createdAt'] = Parse._encode(new Date(mongoObject[key])).iso;
            break;
          case 'expiresAt':
          case '_expiresAt':
            restObject['expiresAt'] = Parse._encode(new Date(mongoObject[key]));
            break;
          default:
            // Check other auth data keys
            var authDataMatch = key.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
            if (authDataMatch) {
              var provider = authDataMatch[1];
              restObject['authData'] = restObject['authData'] || {};
              restObject['authData'][provider] = mongoObject[key];
              break;
            }

            if (key.indexOf('_p_') == 0) {
              var newKey = key.substring(3);
              var expected;
              if (schema && schema.getExpectedType) {
                expected = schema.getExpectedType(className, newKey);
              }
              if (!expected) {
                _logger2.default.info('transform.js', 'Found a pointer column not in the schema, dropping it.', className, newKey);
                break;
              }
              if (expected && expected.type !== 'Pointer') {
                _logger2.default.info('transform.js', 'Found a pointer in a non-pointer column, dropping it.', className, key);
                break;
              }
              if (mongoObject[key] === null) {
                break;
              }
              var objData = mongoObject[key].split('$');
              var newClass = expected ? expected.targetClass : objData[0];
              if (objData[0] !== newClass) {
                throw 'pointer to incorrect className';
              }
              restObject[newKey] = {
                __type: 'Pointer',
                className: objData[0],
                objectId: objData[1]
              };
              break;
            } else if (!isNestedObject && key[0] == '_' && key != '__type') {
              throw 'bad key in untransform: ' + key;
            } else {
              var expectedType = schema.getExpectedType(className, key);
              var value = mongoObject[key];
              if (expectedType && expectedType.type === 'File' && FileCoder.isValidDatabaseObject(value)) {
                restObject[key] = FileCoder.databaseToJSON(value);
                break;
              }
              if (expectedType && expectedType.type === 'GeoPoint' && GeoPointCoder.isValidDatabaseObject(value)) {
                restObject[key] = GeoPointCoder.databaseToJSON(value);
                break;
              }
            }
            restObject[key] = untransformObject(schema, className, mongoObject[key], true);
        }
      }

      if (!isNestedObject) {
        var relationFields = schema.getRelationFields(className);
        Object.assign(restObject, relationFields);
      }
      return restObject;
    default:
      throw 'unknown js type';
  }
}

function transformSelect(selectObject, key, objects) {
  var values = [];
  var _iteratorNormalCompletion2 = true;
  var _didIteratorError2 = false;
  var _iteratorError2 = undefined;

  try {
    for (var _iterator2 = objects[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
      var result = _step2.value;

      values.push(result[key]);
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

  delete selectObject['$select'];
  if (Array.isArray(selectObject['$in'])) {
    selectObject['$in'] = selectObject['$in'].concat(values);
  } else {
    selectObject['$in'] = values;
  }
}

function transformDontSelect(dontSelectObject, key, objects) {
  var values = [];
  var _iteratorNormalCompletion3 = true;
  var _didIteratorError3 = false;
  var _iteratorError3 = undefined;

  try {
    for (var _iterator3 = objects[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
      var result = _step3.value;

      values.push(result[key]);
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

  delete dontSelectObject['$dontSelect'];
  if (Array.isArray(dontSelectObject['$nin'])) {
    dontSelectObject['$nin'] = dontSelectObject['$nin'].concat(values);
  } else {
    dontSelectObject['$nin'] = values;
  }
}

function transformInQuery(inQueryObject, className, results) {
  var values = [];
  var _iteratorNormalCompletion4 = true;
  var _didIteratorError4 = false;
  var _iteratorError4 = undefined;

  try {
    for (var _iterator4 = results[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
      var result = _step4.value;

      values.push({
        __type: 'Pointer',
        className: className,
        objectId: result.objectId
      });
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

  delete inQueryObject['$inQuery'];
  if (Array.isArray(inQueryObject['$in'])) {
    inQueryObject['$in'] = inQueryObject['$in'].concat(values);
  } else {
    inQueryObject['$in'] = values;
  }
}

function transformNotInQuery(notInQueryObject, className, results) {
  var values = [];
  var _iteratorNormalCompletion5 = true;
  var _didIteratorError5 = false;
  var _iteratorError5 = undefined;

  try {
    for (var _iterator5 = results[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
      var result = _step5.value;

      values.push({
        __type: 'Pointer',
        className: className,
        objectId: result.objectId
      });
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

  delete notInQueryObject['$notInQuery'];
  if (Array.isArray(notInQueryObject['$nin'])) {
    notInQueryObject['$nin'] = notInQueryObject['$nin'].concat(values);
  } else {
    notInQueryObject['$nin'] = values;
  }
}

var DateCoder = {
  JSONToDatabase: function JSONToDatabase(json) {
    return new Date(json.iso);
  },
  isValidJSON: function isValidJSON(value) {
    return (typeof value === 'undefined' ? 'undefined' : _typeof(value)) === 'object' && value !== null && value.__type === 'Date';
  }
};

var BytesCoder = {
  databaseToJSON: function databaseToJSON(object) {
    return {
      __type: 'Bytes',
      base64: object.buffer.toString('base64')
    };
  },
  isValidDatabaseObject: function isValidDatabaseObject(object) {
    return object instanceof mongodb.Binary;
  },
  JSONToDatabase: function JSONToDatabase(json) {
    return new mongodb.Binary(new Buffer(json.base64, 'base64'));
  },
  isValidJSON: function isValidJSON(value) {
    return (typeof value === 'undefined' ? 'undefined' : _typeof(value)) === 'object' && value !== null && value.__type === 'Bytes';
  }
};

var GeoPointCoder = {
  databaseToJSON: function databaseToJSON(object) {
    return {
      __type: 'GeoPoint',
      latitude: object[1],
      longitude: object[0]
    };
  },
  isValidDatabaseObject: function isValidDatabaseObject(object) {
    return object instanceof Array && object.length == 2;
  },
  JSONToDatabase: function JSONToDatabase(json) {
    return [json.longitude, json.latitude];
  },
  isValidJSON: function isValidJSON(value) {
    return (typeof value === 'undefined' ? 'undefined' : _typeof(value)) === 'object' && value !== null && value.__type === 'GeoPoint';
  }
};

var FileCoder = {
  databaseToJSON: function databaseToJSON(object) {
    return {
      __type: 'File',
      name: object
    };
  },
  isValidDatabaseObject: function isValidDatabaseObject(object) {
    return typeof object === 'string';
  },
  JSONToDatabase: function JSONToDatabase(json) {
    return json.name;
  },
  isValidJSON: function isValidJSON(value) {
    return (typeof value === 'undefined' ? 'undefined' : _typeof(value)) === 'object' && value !== null && value.__type === 'File';
  }
};

module.exports = {
  transformKeyValue: transformKeyValue,
  parseObjectToMongoObjectForCreate: parseObjectToMongoObjectForCreate,
  transformUpdate: transformUpdate,
  transformWhere: transformWhere,
  transformSelect: transformSelect,
  transformDontSelect: transformDontSelect,
  transformInQuery: transformInQuery,
  transformNotInQuery: transformNotInQuery,
  untransformObject: untransformObject
};