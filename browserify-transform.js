module.exports = transform

var through = require('through')
var jade = require('jade')

function transform(file) {
  if (!!/\.jade$/.test(file)) return transformJade(file)
  return through()
}

function transformJade(file) {
  var data = ''
  var opts = {filename:file, basedir: __dirname+'/../../views'}
  return through(write, end)
  function write(buf) {data += buf}
  function end() {
    var self = this
    var result
    try {
      result = jade.compileClientWithDependenciesTracked(data, opts)
    } catch(e) {
      return self.emit('error',e)
    }
    result.dependencies.forEach(function (dep){self.emit('file', dep)})
    var str = "var jade=require('jade/runtime');"
    str += "module.exports="+result.body+";"
    this.queue(str)
    this.queue(null)
  }
}
