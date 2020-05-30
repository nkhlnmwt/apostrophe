const mongodb = require('mongodb');
const URL = require('url').URL;

function omit(obj, keys) {
  const n = {};
  Object.keys(obj).forEach(function(key) {
    if (keys.indexOf(key) === -1) {
      n[key] = obj[key];
    }
  });
  return n;
}

function decorate(obj) {
  const tinsel = {
    __emulated: true
  };

  const neverDecorate = [
    'apply', 'call', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'arguments', 'caller', 'callee', 'super_', 'constructor', 'bind', 'pipesCount'
  ];

  // Other possible bad things to decorate, but I think I
  // got all the functions:
  //
  // 'length',               'name',
  // 'prototype',            'super_',
  // 'connect',              'arguments',
  // 'caller',               'constructor',
  // 'apply',                'bind',
  // 'call',                 'toString',
  // '__defineGetter__',     '__defineSetter__',
  // 'hasOwnProperty',       '__lookupGetter__',
  // '__lookupSetter__',     'isPrototypeOf',
  // 'propertyIsEnumerable', 'valueOf',
  // '__proto__',            'toLocaleString'

  const allProperties = getAllProperties(obj);

  for (const p of allProperties) {
    if (neverDecorate.indexOf(p) !== -1) {
      continue;
    }
    if ((typeof obj[p]) === 'function') {
      tinsel[p] = function() {
        const result = obj[p].apply(obj, arguments);
        if (result === obj) {
          // So that chained methods chain on the
          // decorated object, not the original
          return tinsel;
        } else {
          return result;
        }
      };
    }
  }
  return tinsel;

  // https://stackoverflow.com/questions/8024149/is-it-possible-to-get-the-non-enumerable-inherited-property-names-of-an-object
  function getAllProperties(obj) {
    const allProps = [];
    let curr = obj;
    do {
      const props = Object.getOwnPropertyNames(curr);
      props.forEach(function(prop) {
        if (allProps.indexOf(prop) === -1) {
          allProps.push(prop);
        }
      });
    } while ((curr = Object.getPrototypeOf(curr)));
    return allProps;
  }
}

module.exports = mongodb;

const OriginalClient = module.exports.MongoClient;
const MongoClient = decorate(OriginalClient);

// Convert (err, client) back to (err, db) in both callback driven
// and promisified flavors

const superConnect = OriginalClient.connect;
MongoClient.connect = function(uri, options, callback) {
  if ((!callback) && ((typeof options) === 'function')) {
    callback = options;
    options = {};
  }
  if (!options) {
    options = {};
  }
  if (options.useUnifiedTopology) {
    // Per warnings these three options have no meaning with the
    // unified topology. Swallow them so that apostrophe 2.x doesn't
    // need to directly understand a mongodb 3.x driver option
    options = omit(options, [ 'autoReconnect', 'reconnectTries', 'reconnectInterval' ]);
  }
  if ((typeof callback) === 'function') {
    return superConnect.call(OriginalClient, uri, options, function(err, client) {
      if (err) {
        return callback(err);
      }
      const parsed = parseUri(uri);
      try {
        return callback(null, decorateDb(client.db(parsed.pathname.substr(1)), client));
      } catch (e) {
        return callback(e);
      }
    });
  }
  return superConnect.call(OriginalClient, uri, options).then(function(client) {
    const parsed = parseUri(uri);
    return decorateDb(client.db(parsed.pathname.substr(1)), client);
  });
};

// TODO: also wrap legacy db.open? We never used it. See:
// See https://github.com/mongodb/node-mongodb-native/blob/3.0/CHANGES_3.0.0.md

module.exports.MongoClient = MongoClient;

function decorateDb(db, client) {
  const newDb = decorate(db);
  // Custom-wrap the "collection" method of db objects
  const superCollection = db.collection;
  newDb.collection = function(name, options, callback) {
    if (arguments.length === 1) {
      return decorateCollection(superCollection.call(db, name));
    }
    if (arguments.length === 2) {
      if ((typeof options) !== 'function') {
        return decorateCollection(superCollection.call(db, name, options));
      } else {
        callback = options;
        return superCollection.call(db, name, function(err, collection) {
          if (err) {
            return callback(err);
          }
          const decorated = decorateCollection(collection);
          return callback(null, decorated);
        });
      }
    }
    return superCollection.call(db, name, options, function(err, collection) {
      if (err) {
        return callback(err);
      }
      return callback(null, decorateCollection(collection));
    });
  };
  // Reintroduce the "db" method of db objects, for talking to a second
  // database via the same connection
  newDb.db = function(name) {
    return decorateDb(client.db(name), client);
  };
  // Reintroduce the "close" method of db objects, yes it closes
  // the entire client, did that before too
  newDb.close = function() {
    return client.close.apply(client, arguments);
  };
  return newDb;
}

function decorateCollection(collection) {
  const newCollection = decorate(collection);
  const superFind = collection.find;
  newCollection.find = function(criteria, projection) {
    const originalCursor = superFind.call(collection, criteria);
    const cursor = decorateCursor(originalCursor);
    if (projection) {
      return cursor.project(projection);
    } else {
      return cursor;
    }
  };

  // Before this module existed, Apostrophe patched this into
  // the mongodb collection prototype
  newCollection.findWithProjection = newCollection.find;

  const superFindOne = collection.findOne;
  newCollection.findOne = function(criteria, projection, callback) {
    if (projection && ((typeof projection) === 'object')) {
      if (callback) {
        return superFindOne.call(collection, criteria, { projection: projection }, callback);
      } else {
        return superFindOne.call(collection, criteria, { projection: projection });
      }
    } else {
      callback = projection;
      if (callback) {
        return superFindOne.call(collection, criteria, callback);
      } else {
        return superFindOne.call(collection, criteria);
      }
    }
  };
  const superAggregate = collection.aggregate;
  newCollection.aggregate = function(op1 /* , op2... */, callback) {
    const last = arguments.length && arguments[arguments.length - 1];
    // Bring back support for operations as a variable number of
    // parameters rather than as an array
    if (Array.isArray(op1)) {
      const options = arguments[1];
      if (options && ((typeof options) === 'object')) {
        if (options.cursor) {
          // Behaves 100% like 3.x, so pass straight through
          return superAggregate.apply(collection, Array.prototype.slice(arguments));
        }
      }
      // Normal: array of aggregate stages
      if ((typeof last) === 'function') {
        // 2.x driver took a callback or returned a promise for results directly,
        // 3.x driver always returns a cursor so convert back to results
        return superAggregate.call(collection, op1).toArray(last);
      } else {
        // Both 2.x and 3.x return a cursor in the absence of a callback,
        // despite documentation implying you must explicitly ask
        // for a cursor
        return superAggregate.call(collection, op1);
      }
    } else {
      // Positional arguments as aggregate stages (2.x supports, 3.x does not)
      if ((typeof last) === 'function') {
        // 2.x driver supported passing a callback rather than
        // returning a cursor, 3.x driver does not
        return superAggregate.call(collection, Array.prototype.slice.call(arguments, 0, arguments.length - 1)).toArray(last);
      } else {
        // Both 2.x and 3.x return a cursor in the absence of a callback,
        // despite documentation implying you must explicitly ask
        // for a cursor
        return superAggregate.call(collection, Array.prototype.slice.call(arguments));
      }
    }
  };

  // ensureIndex is deprecated but createIndex has exactly the
  // same behavior

  newCollection.ensureIndex = function(fieldOrSpec, options, callback) {
    return newCollection.createIndex.apply(newCollection, Array.prototype.slice.call(arguments));
  };

  newCollection.insert = function(docs, options, callback) {
    // Use undeprecated equivalents for the two use cases
    if (Array.isArray(docs)) {
      return newCollection.insertMany.apply(newCollection, Array.prototype.slice.call(arguments));
    } else {
      return newCollection.insertOne.apply(newCollection, Array.prototype.slice.call(arguments));
    }
  };

  newCollection.remove = function(selector, options, callback) {
    // Undeprecated equivalents
    if (options && ((typeof options) === 'object') && options.single) {
      arguments[1] = omit(arguments[1], [ 'single' ]);
      return newCollection.deleteOne.apply(newCollection, Array.prototype.slice.call(arguments));
    } else {
      return newCollection.deleteMany.apply(newCollection, Array.prototype.slice.call(arguments));
    }
  };

  newCollection.update = function(selector, doc, _options, callback) {
    var takesCallback = (typeof arguments[arguments.length - 1]) === 'function';
    var options = _options && ((typeof _options) === 'object') ? _options : {};
    var multi;
    var atomic;
    multi = options.multi;
    if (doc._id) {
      // Cannot match more than one, and would confuse our
      // don't-repeat-the-ids algorithm if we tried to use it
      multi = false;
    }
    var i;
    var keys = Object.keys(doc);
    var _ids;
    var nModified;
    for (i = 0; (i < keys.length); i++) {
      if (keys[i].substring(0, 1) === '$') {
        atomic = true;
        break;
      }
    }
    if (atomic) {
      // Undeprecated equivalents
      if (multi) {
        arguments[2] = omit(arguments[2], [ 'multi' ]);
        return newCollection.updateMany.apply(newCollection, Array.prototype.slice.call(arguments));
      } else {
        return newCollection.updateOne.apply(newCollection, Array.prototype.slice.call(arguments));
      }
    } else {

      if (multi) {

        arguments[2] = omit(arguments[2], [ 'multi' ]);

        // There is no replaceMany, so we have to do this repeatedly until
        // we run out of matching documents. We also have to get all of the
        // relevant _ids up front so we don't repeat them. It is a royal
        // pain in the tuckus.
        //
        // Fortunately it is rarely used.

        const promise = getIds().then(function(docs) {
          _ids = docs.map(function(doc) {
            return doc._id;
          });
          nModified = 0;
          return attemptMulti();
        }).then(function() {
          return completeMulti(null, {
            result: {
              nModified: nModified,
              ok: 1
            }
          });
        }).catch(completeMulti);

        if (takesCallback) {
          return null;
        } else {
          return promise;
        }

      } else {
        return newCollection.replaceOne.apply(newCollection, Array.prototype.slice.call(arguments));
      }
    }

    function getIds() {
      return newCollection.find(selector).project({ _id: 1 }).toArray();
    }

    function attemptMulti() {
      if (!_ids.length) {
        return null;
      }
      var _selector = Object.assign({}, selector, {
        _id: _ids.shift()
      });
      return newCollection.replaceOne(_selector, doc, options).then(function(status) {
        nModified += status.result.nModified;
        return attemptMulti();
      }).catch(function(err) {
        return completeMulti(err);
      });
    }

    function completeMulti(err, response) {
      if (takesCallback) {
        return callback(err, response);
      } else {
        if (err) {
          throw err;
        } else {
          return response;
        }
      }
    }

  };

  newCollection.count = function(query, options, callback) {
    if (arguments.length === 2) {
      if ((typeof options) === 'function') {
        callback = options;
        options = {};
      }
    } else if (arguments.length === 1) {
      if ((typeof query) === 'function') {
        callback = query;
        options = {};
        query = {};
      } else {
        options = {};
      }
    } else if (!arguments.length) {
      options = {};
      query = {};
    }
    if (hasNestedProperties(query, [ '$where', '$near', '$nearSphere' ])) {
      // Queries not supported by countDocuments must be turned into a
      // find() that actually fetches the ids (minimum projection)
      // and returns the number of documents
      const cursor = collection.find(query);
      if (options.limit !== undefined) {
        cursor.limit(options.limit);
      }
      if (options.skip !== undefined) {
        cursor.skip(options.skip);
      }
      if (options.hint !== undefined) {
        cursor.hint(options.hint);
      }
      const p = cursor.project({ _id: 1 }).toArray().then(function(objects) {
        if (callback) {
          callback(null, objects.length);
          return null;
        } else {
          return objects.length;
        }
      }).catch(function(e) {
        if (callback) {
          callback(e);
          return null;
        } else {
          throw e;
        }
      });
      if (!callback) {
        return p;
      }
    } else {
      const p = newCollection.countDocuments(query, options).then(function(count) {
        if (callback) {
          callback(null, count);
          return null;
        } else {
          return count;
        }
      }).catch(function(e) {
        if (callback) {
          callback(e);
          return null;
        } else {
          throw e;
        }
      });
      if (!callback) {
        return p;
      }
    }
  };

  return newCollection;
}

function decorateCursor(cursor) {
  const newCursor = decorate(cursor);
  newCursor.nextObject = newCursor.next;
  return newCursor;
}

function parseUri(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (e) {
    // MongoDB driver tolerates URIs that the WHATWG parser will not,
    // deal with the common cases
    // eslint-disable-next-line no-useless-escape
    const matches = uri.match(/mongodb:\/\/(([^:]+):([^@]+)@)?([^\/]+)(\/([^?]+))?(\?(.*))?$/);
    const newUri = 'mongodb://' + (matches[1] ? (reencode(matches[2]) + ':' + reencode(matches[3]) + '@') : '') + reencode(matches[4]) + (matches[5] ? ('/' + matches[6]) : '') + (matches[7] ? ('?' + matches[8]) : '');
    parsed = new URL(newUri);
  }
  return parsed;
}

function reencode(s) {
  return encodeURIComponent(decodeURIComponent(s));
}

function hasNestedProperties(object, properties) {
  for (const key of Object.keys(object)) {
    if (properties.indexOf(key) !== -1) {
      return true;
    }
    if (object[key] && ((typeof object[key]) === 'object')) {
      if (hasNestedProperties(object[key], properties)) {
        return true;
      }
    }
  }
  return false;
}

// TODO: https://github.com/mongodb/node-mongodb-native/blob/master/CHANGES_3.0.0.md#bulkwriteresult--bulkwriteerror (we don't use it)
// https://github.com/mongodb/node-mongodb-native/blob/master/CHANGES_3.0.0.md#mapreduce-inlined-results (we don't use it)
// See others on that page
