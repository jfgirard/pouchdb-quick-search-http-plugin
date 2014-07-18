var Pouchdb = require('pouchdb');
var QuickSearch = require('pouchdb-quick-search');
var HttpPlugin = require('./index.js');

QuickSearch.searchPlugin(HttpPlugin);
Pouchdb.plugin(QuickSearch);

var db = new Pouchdb('http://localhost:5984/test');

db.search({q: 'bar', fields: ['foo']}).then(function(json){
  console.log('res', json);
  db.search({q: 'bar', fields: ['foo'], destroy:true}).then(function(){
    console.log('destroyed');
  }, function(err){
    console.log('destroy err', err);
  });
}, function(err){
  console.log('error', err);
});
