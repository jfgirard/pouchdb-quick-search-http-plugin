exports._searchHttp = function (opts, callback) {
  var self = this;
  if (opts.destroy) {
    return destroyHttpView(this, this.searchPluginSupport.genPersistedIndexName(opts));
  }
  return this._search(opts, function (err, result) {
    if (err) {
      if (err.status === 404) {
        var indexName = self.searchPluginSupport.genPersistedIndexName(opts),
          fieldBoosts = self.searchPluginSupport.toFieldBoosts(opts.fields);
        return createHttpView(self, indexName, opts.language, fieldBoosts, opts.filter, function (err) {
          if (err) {
            console.log('err create view', err);
            return callback(err);
          }
          console.log('success create view');
          return self._search(opts, callback);
        });
      } else {
        callback(err);
      }
    }
    callback(null, result);
  });
};

function destroyHttpView(db, name) {
  var docId = '_design/' + name;
  return db.get(docId).then(function (doc) {
    return db.remove(docId, doc._rev);
  });
}

//create the Couchdb view including the libs
function createHttpView(db, name, language, fieldBoosts, filter, callback) {
  var body = {
    language: 'javascript',
    views: {
      lib: {
        fieldBoosts: "var fb = " + JSON.stringify(fieldBoosts) +
          "; exports.fieldBoosts = fb;",
        getText: 'exports.getText = ' + db.searchPluginSupport.getText,
        dumbEmitter: 'exports.dumbEmitter = {emit: function(){}}',
        isFiltered: 'exports.isFiltered = ' + db.searchPluginSupport.isFiltered,
        filter: 'exports.filter = ' + filter
      }
    }
  };

  //libs stored in couchdb_libs folder
  var libFiles = [{
    file: __dirname + '/node_modules/lunr/lunr.min.js',
    saveAs: 'lunr'
  }];
  if (language && language !== 'en') {
    libFiles.push({
      file: __dirname + '/couchdb_libs/stemmerSupport.js',
      saveAs: 'stemmerSupport',
      prefix: 'var lunr = require("./lunr");\n'
    });
    libFiles.push({
      file: __dirname + '/couchdb_libs/lunr-' + language + '.js',
      saveAs: 'lunr_lang',
      prefix: 'var lunr = require("./lunr"); ' +
        'var stemmerSupport = require("./stemmerSupport");\n'
    });
    body.views.lib.getTokenStream = "var lunr = require('./lunr'); " +
      "require('./lunr_lang'); var index = lunr();  index.use(lunr." +
      language + "); " +
      "exports.getTokenStream = function(text) { " +
      "return index.pipeline.run(lunr.tokenizer(text)); }";
  } else {
    body.views.lib.getTokenStream =
      "var lunr = require('views/lib/lunr'); var index = lunr(); " +
      "exports.getTokenStream = " +
      "function(text) { return index.pipeline.run(lunr.tokenizer(text)); }";
  }

  //map function
  body.views[name] = {
    map: 'function (doc) {\n' +
      'var isFiltered = require("views/lib/isFiltered").isFiltered;\n' +
      'var filter = require("views/lib/filter").filter;\n' +
      'var dumbEmitter = require("views/lib/dumbEmitter").dumbEmitter;\n' +
      'if (isFiltered(doc, filter, dumbEmitter)) {\n' +
      '  return;\n' +
      '}\n' +
      'var TYPE_TOKEN_COUNT = "a";\n' +
      'var TYPE_DOC_INFO = "b";\n' +
      'var docInfo = [];\n' +
      'var fieldBoosts = require("views/lib/fieldBoosts").fieldBoosts;\n' +
      'var getText = require("views/lib/getText").getText;\n' +
      'var getTokenStream = require("views/lib/getTokenStream").getTokenStream;\n' +
      'for (var i = 0, len = fieldBoosts.length; i < len; i++) {\n' +
      '  var fieldBoost = fieldBoosts[i];\n' +
      '  var text = getText(fieldBoost, doc);\n' +
      '  var fieldLenNorm;\n' +
      '  if (text) {\n' +
      '    var terms = getTokenStream(text);\n' +
      '    for (var j = 0, jLen = terms.length; j < jLen; j++) {\n' +
      '      var term = terms[j];\n' +
      '      var value = fieldBoosts.length > 1 ? i : undefined;\n' +
      '      emit(TYPE_TOKEN_COUNT + term, value);\n' +
      '    }\n' +
      '    fieldLenNorm = Math.sqrt(terms.length);\n' +
      '  } else { \n' +
      '    fieldLenNorm = 0;\n' +
      '  }\n' +
      '  docInfo.push(fieldLenNorm);\n' +
      '}\n' +
      'emit(TYPE_DOC_INFO + doc._id, docInfo);\n' +
      '}'
  };
  //read libs from disk
  readLibFiles(libFiles, function (err, result) {
    if (err) {
      return callback(err);
    }
    for (var lib in result) {
      //append the file content to the view definition
      body.views.lib[lib] = result[lib];
    }
    addDesignDocument(db, body, name).then(function () {
      callback(null);
    }, callback);
  });
}

function addDesignDocument(db, doc, name) {
  //add the design document
  return db.request({
    method: 'PUT',
    url: '_design/' + name,
    body: doc
  });
}

function destroyHttpView(db, name) {
  var docId = '_design/' + name;
  return db.get(docId).then(function (doc) {
    return db.remove(docId, doc._rev);
  });
}

function readLibFiles(files, cb) {
  var fs = require('fs');
  if (!fs) {
    return cb({
      error: "fs is missing"
    });
  }
  var result = {};

  var iterFiles = function (i) {
    if (i < files.length) {
      var fileDesc = files[i];
      fs.readFile(fileDesc.file, {
        encoding: 'utf8'
      }, function (err, content) {
        if (err) {
          return cb(err);
        }
        result[fileDesc.saveAs] = fileDesc.prefix ? fileDesc.prefix + content : content;
        iterFiles(i + 1);
      });
    } else {
      cb(null, result);
    }
  };
  iterFiles(0);
}
